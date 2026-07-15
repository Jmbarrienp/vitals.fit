# Nutrition Vision V3.2 — Nutrition Label OCR

**Estado:** implementado en `feature/nutrition-state-2a2` (sobre V3.1) — local, NO comiteado, NO pusheado, NO mergeado, NO desplegado. Esperando autorización explícita.
**Migración:** **NINGUNA.** Cero cambios de schema.
**Feature flag:** `EXPO_PUBLIC_LABEL_OCR_ENABLED` — nueva e independiente de las otras dos modalidades. Off por defecto.
**Gobernado por:** `docs/nutrition-vision-strategy.md` §1.1 y §5 (roadmap ítem V5 "OCR de etiqueta"), adelantado sobre el orden sugerido por decisión de producto.

---

## 1. Auditoría de arquitectura (antes de escribir código)

| Hallazgo | Consecuencia de diseño |
|---|---|
| **`LogsService.resolveItem` ya acepta macros del caller** en su rama one-off (`if (it.customName)` → `calories: it.calories, proteinG: round1(it.proteinG ?? 0)…`). Su propio docstring lo declara: *"manual: { customName, quantity?, calories, proteinG, carbsG, fatG }"*. | **Cero cambios a LogsService, cero write path nuevo.** Los macros de una etiqueta viajan por el camino one-off que existe desde Fase 1 y que el smoke de V0 ya cubría ("unmatched candidate still confirms as a one-off item"). |
| **`VisionScan.source` es columna `String`** con union TS (lección 2B.1, ya pagada en producción). | Añadir `LABEL_OCR` es **solo TypeScript**. Cero migración. |
| **`VisionScan.proposal` es `Json?`**. | El `NutritionLabel` persiste **dentro** de la propuesta. Cero columnas nuevas, cero tablas nuevas — respuesta directa a *"Avoid schema changes unless absolutely necessary"*. |
| **Trampa crítica:** si el candidato llevara `foodItemId` de catálogo, `resolveItem` recalcularía los macros desde `caloriesPer100g * grams/100` y **descartaría silenciosamente los números impresos**. | El candidato primario es **siempre one-off** (`foodItemId: null`). El catálogo se ofrece como `alternates` (swap deliberado del usuario), nunca como default. |
| El lifecycle de `VisionScan` sigue siendo agnóstico a la fuente (probado ya por V3.1). | `confirmScan/rejectScan/markFallbackManual/getScan/sweepExpired`: **cero cambios por tercera vez consecutiva.** |
| `ScanSource` tenía `MENU_OCR` y `RECEIPT_OCR`, pero una tabla nutricional no es ni un menú ni un recibo. | Miembro nuevo `LABEL_OCR` — documentos distintos, propósitos distintos. |

### 1.1 La pregunta epistemológica (y por qué NO viola la estrategia)

La regla vigente (estrategia §6.3, y memoria) dice:

> *"`RecognitionResult` transporta percepción, NUNCA nutrición. El día que un vendor devuelva calorías, el parser las tira."*

OCR parece violarla. No lo hace, y la distinción es la tesis del slice:

| | Foto de comida | Etiqueta nutricional |
|---|---|---|
| Pregunta al modelo | "¿cuántas calorías tiene este plato?" | "¿qué dice este número impreso?" |
| Origen del dato | **Inventado** desde la apariencia | **Impreso por el fabricante**, dentro de la imagen |
| Modo de fallo | Alucinación plausible e indetectable | Dígito mal leído — detectable por aritmética |
| Contrato | `RecognitionResult` — sin campos de macros, y sigue así | `NutritionLabel` — contrato **separado** |

`Detection` y `parseDetections` quedan **intactos**: siguen sin tener dónde poner una caloría. La regla se sostiene sin excepción para la modalidad que la motivó. OCR obtiene su propio contrato porque hace un trabajo epistemológicamente distinto: **transcribe, no infiere**. Y aun así los números pasan por validación determinista, se muestran editables, y el usuario confirma antes de que nada se registre.

`VisionScanProposal.label?` es aditivo y opcional (regla de evolución de contrato §6.1: "Aditivo-solo, campos nuevos opcionales"); ninguna modalidad existente lo emite ni lo lee.

---

## 2. Arquitectura implementada

```
Cámara (foto de la etiqueta, quality 0.8 — OCR lee letra chica)
    │
    ▼
POST /vision/scans/label   { imageBase64, imageMimeType }
    │
    ▼
VisionScanService.createLabelScan()
    │
    ├─ 1. VisionImageStore.put() → ref opaco        (seam de V2, reutilizado)
    │
    ├─ 2. OCRProviderRegistry.active().extract(ref) → LabelExtraction
    │       └─ el provider TRANSCRIBE verbatim a slots de STRING. No convierte, no calcula.
    │
    ├─ 3. parseLabel(fields)  ← PURO. Toda la normalización del mundo real:
    │       comas decimales, separadores de miles, kJ→kcal, "2/3 cup (55g)", basis per-100g→per-serving
    │
    ├─ 4. validateNutritionLabel(label)  ← PURO. Gate determinista:
    │       ├─ HARD reject: negativos, porción ≤0, macros > masa de la porción, valores > caps del DTO
    │       └─ SOFT signal: plausibilidad Atwater (0..1) → baja la confianza, nunca rechaza
    │
    ├─ 5. FoodService.search(productName)  ← matcher REUTILIZADO → alternates (nunca override)
    │
    └─ 6. buildLabelCandidate()  ← PURO. Reutiliza scoreCandidate/bandFor sin cambios
              │
              ▼
    (idéntico a las otras dos modalidades desde aquí — CERO cambios)
    confirmScan() → LogsService.logMeal() (rama one-off) → meal.logged → toda la plataforma
```

### 2.1 El puerto — `OCRProvider`

```ts
interface OCRProvider {
  readonly id: string;
  extract(req: { imageRef: string; hints?: { userId?: string } }): Promise<LabelExtraction>;
}
```

Tercer puerto hermano, tercer registry (`OCR_PROVIDER`). Providers: `FixtureOCRProvider` (determinista; casos US/LATAM/EU/parcial/imposible/ilegible) y `ClaudeOCRProvider` (real, patrón V2 completo: `hasKey`, image store, structured outputs, timeout, contención de vendor).

Default = `fixture`, como Vision y **a diferencia de Barcode**: una llamada real de OCR cuesta dinero y requiere key, así que producción se despliega inerte.

### 2.2 La decisión de diseño central: strings verbatim, no números

`LabelExtraction.fields` son **strings**, no números. El modelo copia `"2,3 g"` tal cual; el parser de la plataforma lo convierte a `2.3`. Tres razones:

1. **Determinismo en la frontera.** El proveedor es probabilístico; el parser es puro. La misma transcripción siempre produce los mismos números — verificado por assertion.
2. **Un parser para todos los proveedores.** Un OCR on-device (que solo devuelve texto y no razona) encaja en el mismo puerto sin lógica propia.
3. **Aritmética verificable.** Una conversión kJ→kcal hecha por un modelo es inauditable; hecha por `label-parser.ts` está cubierta por tests.

Es también lo que hace *enforzable* la regla "nunca inventes un macro": un modelo que solo copia no puede alucinar, y un slot vacío se queda vacío en vez de convertirse en un número plausible.

---

## 3. Parsing — el mundo real, no el happy path

| Caso | Manejo | Verificado |
|---|---|---|
| Punto decimal (US) | `"3.5 g"` → 3.5 | ✅ |
| Coma decimal (LATAM/EU) | `"2,3 g"` → 2.3 | ✅ |
| Separador de miles vs decimal | Separador seguido de **exactamente 3 dígitos** = miles; cualquier otra cosa = decimal. Resuelve `"8,5"`→8.5 y `"1,234"`→1234 **sin conocer el locale**. | ✅ |
| Ambos separadores | El de más a la derecha es el decimal: `"1.234,5"`→1234.5, `"1,234.5"`→1234.5 | ✅ |
| kJ + kcal impresos | Gana el kcal, sin convertir: `"1046 kJ / 250 kcal"`→250 | ✅ |
| Solo kJ | Convertido (÷4.184) determinísticamente | ✅ |
| Porción volumétrica US | Gana el gramaje entre paréntesis: `"2/3 cup (55g)"`→55 g | ✅ |
| Porción contable | `"1 barra"`→`{size:1, unit:'unit'}` — **nunca fingido como gramos** | ✅ |
| Basis per-100g (EU) | Convertido a per-serving con la porción: 250 kcal/100g × 40g → 100 kcal | ✅ |
| Nutriente ilegible | → `missingFields`, valor 0, campo **vacío** en la UI (un 0 prellenado se leería como "la etiqueta dice cero") | ✅ |
| Etiqueta ilegible completa | Todos los campos missing, porción 0 → rechazada → manual | ✅ |

---

## 4. Validación — nunca confiar en OCR a ciegas

**Hard rejects** (la etiqueta no se propone; degrada a manual):
- Macro negativo, porción ≤ 0
- **Conservación de masa**: `protein+carbs+fat > servingSize × 1.05` (solo cuando la unidad es `g`; `ml` se excluye a propósito — la densidad no es 1 para todo líquido, y un rechazo falso es peor que uno omitido)
- **Valores por encima de los caps de `ConfirmScanItemDto`** — sin esta alineación la plataforma podría proponer una etiqueta que su propio endpoint de confirmación rechazaría con un 400: un callejón sin salida en el último paso

**Señal suave** (baja la confianza, nunca rechaza):
- **Plausibilidad Atwater**: `4·prot + 4·carb + 9·fat ≈ calorías`. Es el mejor detector disponible de un dígito mal leído. Pero etiquetas reales se desvían legítimamente (fibra, polioles, redondeo, alcohol), así que empuja al usuario a REVIEW en vez de descartar una etiqueta válida.

> **Hallazgo del smoke:** el caso de prueba original (`protein: 50` en vez de `5`) resultó capturado por **dos** validadores independientes — Atwater lo marcó implausible (0.36) *y* la conservación de masa lo rechazó (99.5 g de macros en una porción de 55 g). El test se dividió para aislar cada señal: un macro mal leído se rechaza por masa; una **caloría** mal leída (`"840"` por `"240"`) es legal en masa y solo Atwater la ve → plausibilidad 0.37, sigue válida, el usuario revisa.

Esto es verificación de **exactitud de transcripción**, no inteligencia nutricional: pregunta *"¿leímos bien la etiqueta?"*, nunca *"¿esta comida te conviene?"*. Scoring, planning y coaching siguen íntegramente fuera del dominio de visión.

---

## 5. Confianza — qué significa cada señal aquí

`scoreCandidate`/`bandFor` reutilizados **sin cambios** (umbrales en un solo lugar para las tres modalidades). La semántica se documenta por modalidad en cada sitio:

| Señal | Foto | Barcode | **Etiqueta** |
|---|---|---|---|
| `recognition` | ¿es pollo? | 1 (exacto) | **confianza de transcripción × completitud × plausibilidad** |
| `match` | fuzzy vs catálogo | 1 (identidad exacta) | **1 — la etiqueta identifica su propio producto** |
| `portion` | estimada por el modelo | serving del producto | **la porción impresa** (única incertidumbre real) |

---

## 6. Matching — reutilizado, nunca duplicado

`FoodService.search(productName)` (el mismo que usa la modalidad foto) provee `alternates`. El candidato primario permanece one-off por la razón del §1: enlazar catálogo descartaría los números impresos. El orden de búsqueda de 6 niveles vive **dentro** de `FoodService` (favoritos +25, comunes +12, elegibilidad de custom foods) — no se reimplementa en vision.

---

## 7. Migración y despliegue

**Cero migración.** El único slice de Vision con impacto de schema nulo:
- `LABEL_OCR` → union TS sobre columna String
- `NutritionLabel` → dentro de `VisionScan.proposal` (Json)
- Macros → por la ruta one-off preexistente de `LogsService`

**Despliegue:** `OCR_PROVIDER` default `fixture` → producción queda inerte aunque se despliegue el código. El botón está detrás de `EXPO_PUBLIC_LABEL_OCR_ENABLED=false`. Activar el OCR real requiere **tres** cosas simultáneas: `ANTHROPIC_API_KEY` + `OCR_PROVIDER=claude` + el flag mobile.

---

## 8. Evaluación de riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| **Un macro mal transcrito llega al registro del usuario** | **Alta** — es el riesgo central de la modalidad | Cuatro capas: prompt que prohíbe inventar; validación dura (masa/negativos/caps); señal Atwater que baja confianza; y **el usuario edita cada número antes de confirmar**. Ninguna capa es suficiente sola. |
| Coste por scan (una foto de etiqueta es una llamada de visión completa) | Media | Default `fixture`; `OCR_MODEL` independiente de `VISION_MODEL` (transcribir puede justificar un tier más barato que reconocer); prompt cacheado; una sola llamada por scan. |
| Ambigüedad miles/decimal en un locale desconocido | Media | Regla de 3 dígitos, locale-agnóstica, cubierta por 6 assertions. Residual: un `"1,500"` que signifique 1.5 se leería 1500 — mitigado porque el usuario ve y edita el valor. |
| `ml` vs `g` (densidad ≠ 1) | Baja | La conservación de masa **no** se aplica a `ml` a propósito; `LogsService` ya asume densidad 1 para líquidos (comportamiento preexistente, no introducido aquí). |
| Etiqueta per-100g **sin** porción legible | Baja | No se convierte (convertir sin porción sería adivinar); la porción faltante ya colapsa la confianza y manda a revisión. |
| Deriva del prompt entre versiones de modelo | Media | `OCR_PROMPT_VERSION` viaja en `providerVersion` y se estampa por scan → toda métrica futura es cortable por versión de prompt. |

---

## 9. Smoke tests

`npm run smoke:vision` — extendido de 119 a **196 assertions**, todas verdes. Secciones nuevas:

- **Number parsing (9)**: punto/coma decimal, miles vs decimal en ambos estilos, ambos separadores, unidades/prefijos, y campo ilegible → `null` (nunca un número adivinado).
- **Energy/serving/basis (10)**: kcal desnudo, kcal explícito, wording español, kJ+kcal → gana kcal, kJ-only → convertido, porción volumétrica US, ml, contable → `unit`, detección de basis.
- **Normalización (10)**: US/LATAM/EU normalizan al mismo contrato; per-100g→per-serving; campo ilegible reportado no inventado; completitud; **determinismo byte-idéntico** sobre un proveedor probabilístico.
- **Validación (10)**: negativos, porción 0, masa imposible, caps alineados con el DTO de confirmación, Atwater como señal suave aislada de la conservación de masa.
- **Candidate (6)**: siempre one-off, porción, HIGH limpio, parcial fuera de HIGH, plausibilidad baja arrastra confianza, porción inconvertible no finge gramos.
- **Registry/prompt (11)**: swap por config, default fixture, fallo ruidoso, `hasKey=false`, sin key/imagen → falla antes de gastar llamada, schema cerrado, prompt prohíbe conversión, extraction parser mantiene strings verbatim.
- **Integración (20)**: lifecycle completo, label dentro del JSON de la propuesta, alternates del matcher reutilizado sin override, degradaciones (parcial→editable, imposible→FAILED, ilegible→manual, provider caído→manual), y **convergencia: los macros de la etiqueta se registran verbatim por la ruta one-off, `confirmScan` sin un solo cambio**.

---

## 10. Reporte de verificación

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` (backend) | ✅ limpio |
| `npm run build` (backend) | ✅ limpio |
| `npm run smoke:vision` | ✅ **196/196** (119 → +77) |
| `smoke:1c/state/rec/ledger/review/contract/coach/planner/mealplan` | ✅ 9/9 sin regresión |
| `npx tsc --noEmit` (mobile) | ✅ limpio |
| Migraciones nuevas | ✅ ninguna |
| Cambios a LogsService / meal.logged / matching | ✅ ninguno |
