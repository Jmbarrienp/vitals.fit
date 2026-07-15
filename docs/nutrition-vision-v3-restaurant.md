# Nutrition Vision V3.4 — Reconocimiento de Restaurante y Borrador Contextual

**Fecha:** 2026-07-15 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado, no desplegado

---

## 1. Qué resuelve este slice

Las comidas de restaurante son el punto ciego clásico del registro nutricional: sin etiqueta (V3.2), sin código de barras (V3.1), y con porciones y preparaciones que no están en la cocina del usuario. V3.4 hace que una comida de restaurante sea registrable con la misma simplicidad que una casera: la foto detecta el **contexto** (restaurante, nombre si es legible, tipo de cocina), el contexto viaja por el ciclo de vida existente, y —cuando hay una fuente de menú configurada— la propuesta ofrece platos del menú con su nutrición **publicada**. Todo converge en `LogsService.logMeal()`.

**El contexto es una señal, nunca una fuente de verdad nueva.**

---

## 2. Auditoría (qué existía, qué se reutilizó, qué no se tocó)

### 2.1 La percepción de escena cabía en el puerto existente

`RecognitionResult` ya es la respuesta del proveedor a *"¿qué ves en esta foto?"*. El contexto de restaurante es **más percepción de la misma foto** — no una modalidad nueva. Un campo aditivo `scene?` sobre el contrato existente evita: (a) una segunda llamada al vendor por scan (coste ×2), (b) un puerto de "detección de escena" redundante, y (c) tocar el ciclo de vida. `Detection.attributes` ya contemplaba `'packaged' | 'homemade'` desde V0 — la escena es la versión scan-level de esa misma idea, prevista por el diseño original.

### 2.2 El conocimiento de menús SÍ es una fuente externa nueva

Un menú no se percibe: se **consulta**. Eso es exactamente lo que los puertos existen para aislar → `RestaurantMenuProvider` (cuarto registry, patrón idéntico a Vision/Barcode/OCR). Se construye con fixture primero — el mismo movimiento que V0 hizo con Vision antes de que existiera key alguna.

### 2.3 Lo que NO se tocó

| Superficie | Cambios |
|---|---|
| `LogsService` / write path / `meal.logged` | **cero** — el plato de menú entra por la rama one-off que existe desde Fase 1 (`resolveItem` con `customName`, que ya coalesce macros ausentes a 0 — convención de la plataforma, no de este slice) |
| Ciclo de vida del scan (`confirmScan`/`rejectScan`/`getScan`/`sweepExpired`) | **cero** (quinta vez consecutiva) |
| Motor de porciones (V3.3) | **cero** — regla explícita del task; verificado en smoke que la explicación V3.3 sigue intacta en un scan de restaurante |
| Barcode (V3.1) / OCR (V3.2) | **cero** |
| Matching (`FoodService.search`) | **cero** — las detecciones de un scan de restaurante se matchean por el MISMO pipeline |
| Schema de base de datos | **cero migraciones** — el contexto persiste dentro de `VisionScan.proposal` (Json), patrón V3.2 |

---

## 3. Arquitectura

```
                  foto ──► VisionProvider (UNA llamada, igual que antes)
                              │
                              ▼
              RecognitionResult { detections, scene? }   ← scene: aditivo, opcional
                              │
              response-validator (puerta V0, extendida):
                escena malformada → SE ELIMINA (la pista es prescindible,
                el scan no) · detecciones malformadas → FAILED como siempre
                              │
                              ▼
     pipeline normal V0–V3.3 (search → priors → candidates → confianza)   [INTACTO]
                              │
     deriveRestaurantContext (PURO — pipeline/restaurant-context.ts)
       · umbral 0.5: por debajo NO hay contexto (la ausencia ES el fallback)
       · si califica → lookup de menú vía RestaurantMenuProviderRegistry
         (timeout 8s, fail-soft: una caída cuesta los candidatos, jamás el scan)
       · sanitización: platos sin nombre fuera; números implausibles → null
         (se DESCARTAN, nunca se reparan — reparar sería inventar nutrición)
                              │
                              ▼
              proposal.restaurant? { nombre, categoría, confianza, menuCandidates }
                              │
     mobile: banner + platos del menú (tappables SOLO con calorías publicadas)
                              │
     confirmación → LogsService.logMeal() → meal.logged        [write path intacto]
```

### 3.1 Epistemología (tercera aplicación de la regla V3.2)

Un candidato de menú lleva macros **solo si la fuente los publica** (transcripción, como una etiqueta) — jamás derivados de la apariencia. Un plato sin datos publicados es una **pista de nombre**, no algo registrable: en mobile ni siquiera es tappable. El proveedor de visión tiene prohibido adivinar el nombre del restaurante por el estilo de la comida — solo puede reportarlo si es **literalmente legible** en la imagen (letrero, menú, servilleta, empaque).

### 3.2 Política de defaults del registry (tercera filosofía, argumentada)

- Vision/OCR → default `fixture` (una llamada real cuesta dinero).
- Barcode → default real (`openfoodfacts` es gratis y sin key).
- **Menú → default `none`** (null object que siempre responde not-found): hoy no existe una API de menús gratuita y sin key, y un fixture contestando menús enlatados en producción sería peor que no contestar nada. El contexto de restaurante funciona igual con él — solo faltan los candidatos de menú. Producción queda inerte hasta configurar una fuente real deliberadamente.

### 3.3 La puerta de validación distingue lo esencial de lo accesorio

Detecciones malformadas → scan FAILED (igual que V0: sin ellas no hay propuesta). Escena malformada → **se elimina y el scan procede**: degradar un scan completo por una pista opcional daría al usuario una experiencia peor que la entrada manual, violando la regla de fallback. Nada malformado pasa la puerta en ningún caso.

### 3.4 Claude sigue siendo consumidor

El prompt/schema del adapter (v1.1.0) pide el bloque `scene` con centinelas obligatorios (`""`, `UNKNOWN`, 0) porque structured outputs exige todos los slots; `parseScene` (puro, total) convierte centinelas en nulls — nada aguas abajo ve jamás un centinela de vendor. El fixture emite escenas para refs con `restaurant` (y `faint` para señal débil) sin alterar ningún ref existente.

---

## 4. Archivos

**Nuevos (backend):** `types/restaurant-contract.ts`, `restaurant/restaurant-menu.port.ts`, `restaurant/restaurant-menu.registry.ts`, `restaurant/null-restaurant-menu.provider.ts`, `restaurant/fixture-restaurant-menu.provider.ts`, `pipeline/restaurant-context.ts`.

**Modificados (backend):** `types/vision-contract.ts` (SceneContext + `RecognitionResult.scene?` + `proposal.restaurant?`), `providers/response-validator.ts` (validación/strip de escena), `providers/fixture.provider.ts` (refs restaurant), `providers/claude-vision.prompt.ts` (+`parseScene`, schema, v1.1.0), `providers/claude-vision.provider.ts` (una línea), `vision-scan.service.ts` (derivación + lookup fail-soft en el path de foto), `vision.module.ts`, `.env.example`.

**Mobile:** `types/vision.ts` (espejo), `scan.tsx` (banner + platos de menú seleccionables que entran como one-off al confirmar — solo números publicados; los null no se envían y aplica la convención one-off del backend).

---

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo adivina el nombre del restaurante por el estilo de comida | Prohibición explícita en el prompt ("SOLO si es literalmente legible"); nombre es `string|null`, null es válido y esperado |
| Escena falsa-positiva (casa detectada como restaurante) | Umbral 0.5 server-side; el banner dice "confírmalo tú"; el contexto no cambia macros de nada — solo añade opciones |
| Fuente de menú caída/lenta degrada scans | Timeout 8s + fail-soft verificado: contexto sin candidatos, scan intacto |
| Datos de menú corruptos llegan al usuario | Sanitización pura: sin nombre → fuera; número implausible → null; tope 6 candidatos; techos espejo de `ConfirmScanItemDto` |
| Doble conteo (candidato de plato + platos del menú) | El usuario compone su confirmación explícitamente (checkboxes independientes); nada se auto-selecciona |
| Deriva de scope hacia "cerebro de restaurantes" | El contexto vive solo en el proposal Json; cero tablas, cero columnas, cero lógica nutricional nueva |

---

## 6. Despliegue

- **Cero migraciones.** Deploy de código solamente.
- Defaults de producción: `VISION_PROVIDER=fixture` (sin escenas reales) y `RESTAURANT_MENU_PROVIDER=none` → el slice queda **doblemente inerte** hasta activar `VISION_PROVIDER=claude` (las escenas empiezan a llegar) y, opcionalmente, una fuente de menú real (los candidatos empiezan a llegar).
- Mobile: sin flag nuevo — el banner solo aparece si el backend envía `restaurant`, y el backend solo lo envía con señal confiable. Los clientes viejos ignoran el campo (aditivo).

---

## 7. Verificación

| Check | Resultado |
|---|---|
| `smoke:vision` | ✅ **285/285** (246 → +39) |
| Detección de contexto (fixture, ref `restaurant`) | ✅ nombre + categoría + confianza en el proposal |
| Umbral (señal 0.3) | ✅ contexto omitido, scan ordinario con sus candidatos |
| Regresión foto casera | ✅ sin campo `restaurant`, comportamiento pre-V3.4 |
| Fail-soft de fuente de menú (outage/timeout) | ✅ contexto sin candidatos, scan PROPOSED |
| Default `none` | ✅ contexto presente, candidatos vacíos |
| Confirmación (plato de catálogo + plato de menú one-off) | ✅ mismo write path, provenance vision, macros publicados verbatim |
| Confirm/reject sin cambios | ✅ quinta modalidad, cero cambios de ciclo de vida |
| No-bypass | ✅ invariante intacto |
| Determinismo | ✅ mismo ref → contexto idéntico |
| Swap de proveedor de menú (`none`/`fixture`/desconocido) | ✅ registrado, falla-fuerte si está mal configurado |
| Otros 9 smokes (1c, state, rec, ledger, review, contract, coach, planner, mealplan) | ✅ todos verdes |
| Backend build + tsc, mobile tsc | ✅ limpios |
