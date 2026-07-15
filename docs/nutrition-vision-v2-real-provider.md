# Nutrition Vision V2 — First Real Provider

**Estado:** implementado en `feature/nutrition-state-2a2` (sobre V1) — local, NO desplegado.
**Migración:** NINGUNA. V0 ya trae `VisionScan` + `VisionFeedback` + `LoggedMeal.source/visionScanId`.
**Feature flag:** sin cambios — sigue `EXPO_PUBLIC_VISION_ENABLED` (off por defecto).

V2 reemplaza el fixture por un proveedor de reconocimiento REAL sin tocar un solo
contrato. El objetivo no era añadir IA: era demostrar que la infraestructura
provider-agnostic de V0 aguanta un vendor real con un cambio de una línea.

---

## 1. Selección de proveedor — la evidencia, y sus límites

Se comparó Claude Vision vs GPT Vision vs Gemini Vision. **Elegido: Claude.**

| Eje | Evidencia |
|---|---|
| **Structured outputs** | `output_config.format` + `json_schema` restringe la decodificación a la forma del contrato. Ataca directamente el modo de fallo para el que existe `response-validator.ts`: una respuesta malformada pasa de ser el caso común a ser una rareza. Verificado presente en el SDK instalado (`@anthropic-ai/sdk@0.98.0`). |
| **Coste de integración** | El SDK **ya es dependencia y ya está en uso**; `ANTHROPIC_API_KEY` ya es la variable documentada en `.env.example`. GPT y Gemini cuestan cada uno un SDK nuevo + un secreto nuevo en Render. |
| **Precedente de degradación** | El patrón `hasKey=false` ya está probado **en producción en este mismo código** (Weekly Coach). Vision lo reutiliza literalmente en vez de inventar uno. |
| **Bounding boxes** | Opus 4.7+/Sonnet 5 hacen visión de alta resolución (2576px lado largo) con coordenadas 1:1 a píxeles. Nuestro contrato lleva `boundingBox` desde V0. |
| **Precio** | Opus 4.8 $5/$25 por 1M · Sonnet 5 $3/$15 · Haiku 4.5 $1/$5 — tres niveles detrás de `VISION_MODEL`, sin tocar código. |

### Lo que esta decisión NO afirma

**No hay API key de ninguno de los tres proveedores en el entorno.** El eval harness
no pudo ejecutarse contra un vendor real, así que **no se midió calidad de
reconocimiento ni latencia real**, y afirmar que Claude ganó en esos ejes sería
inventar datos. La elección se tomó sobre los ejes decidibles hoy (garantía de
structured outputs, coste de integración, camino de degradación, superficie de
dependencias, precio).

Los ejes restantes los arbitra `compareProviders()` (añadido en V2) cuando existan
claves. El riesgo de lock-in está acotado por diseño: un adapter rival es aditivo
— implementa el mismo puerto y se registra en la misma línea del módulo.

---

## 2. El problema real de V2: transporte de imagen

**Hallazgo que define el slice:** V1 mandaba `imageRef = shot.assets[0].fileName`
— un **nombre de archivo**. El fixture funcionaba porque busca keywords en el ref.
Un proveedor real no puede reconocer una comida desde un nombre de archivo. V2 no
era "llamar a un vendor": era construir el transporte de píxeles sin romper el puerto.

**Restricción dura:** `VisionProvider.recognize({ imageRef, source, hints })` no
podía cambiar. Meter bytes en el puerto habría acoplado el contrato de
reconocimiento a un detalle de infraestructura.

**Solución — `VisionImageStore` (`vision/images/`):** el `imageRef` sigue siendo
opaco; resolverlo a bytes es infraestructura del adapter, no parte del contrato.

```
mobile (base64) → POST /vision/scans → ImageStore.put() → ref
                                       ↓
                          VisionScan.imageRef = ref (NUNCA bytes)
                                       ↓
                     provider.recognize({ imageRef: ref })
                                       ↓
                          ImageStore.resolve(ref) → bytes → vendor
```

- **`EphemeralImageStore` (default):** los bytes viven en proceso sólo el instante
  que dura el reconocimiento, y se liberan en `finally`. Es honesto, no un
  placeholder: el reconocimiento es **síncrono** dentro de `createScan`, así que el
  único consumidor de los píxeles es la llamada al provider unas líneas después.
  Pasado PROPOSED nadie vuelve a leer la imagen — candidatos, porciones, confianza
  y el LoggedMeal final son todos datos derivados.
- **Acotado en dos ejes** (TTL 5 min + tope de 32 entradas): un `discard()` perdido
  degrada a evicción, no a fuga. Render Free es pobre en memoria.
- **Dónde entra el storage durable:** un `SupabaseImageStore` implementa el mismo
  puerto y se cambia en una línea del módulo, igual que un provider. Se difiere a
  propósito: no hay consumidor todavía para un corpus de imágenes (el primero
  obvio será un eval corpus de Vision), y traerlo ahora significaba bucket +
  credenciales + lifecycle + RLS sin usuario.

**Invariante preservada de V0:** los bytes crudos nunca llegan a la base de datos.
`VisionScan.imageRef` sólo guarda el string que devuelve el store. El smoke lo
asserta.

---

## 3. El adapter (`claude-vision.provider.ts`)

Único archivo de la plataforma que sabe que existe un vendor.

- **Contención del vendor:** la respuesta cruda nunca sale de la clase. Prompts y
  schema viven en `claude-vision.prompt.ts` y no se devuelven. `raw` lleva sólo
  tokens de uso (auditoría), nunca el prompt ni el texto. `model` viaja en el
  contrato interno para atribución de eval; `VisionScanProposal` (lo que ve mobile)
  no tiene ese campo → **ningún identificador de modelo llega a un cliente**.
- **Separación de conocimiento:** el modelo sólo percibe (label, bbox, gramos,
  confianza). No calcula calorías ni macros. El matching sigue por
  `FoodService.search` y los macros los computa `LogsService.logMeal` server-side.
  Un modelo que alucinara calorías no podría llegar al usuario: nadie downstream
  lee una caloría de él.
- **Porciones sin inventar:** el prompt instruye devolver `portionGrams: 0` cuando
  no se puede estimar. Eso deja la chain existente `estimatePortion` caer a
  `SERVING_DEFAULT`, con el método siempre registrado — una porción supuesta nunca
  se presenta como medición. La incertidumbre alta baja `portionConfidence` →
  `scoreCandidate` → banda → `deriveUxMode` → REVIEW/FALLBACK. **La política de
  confianza ya vivía en la plataforma; el adapter sólo la alimenta.**
- **Degradación:** sin key, imagen irresoluble, timeout, refusal, truncado, JSON
  malformado o error de red → todos lanzan → `VisionScanService` marca FAILED y
  entrega el flujo manual prellenado. El reconocimiento puede fallar; el registro no.
- **Prompt caching:** el system prompt es byte-idéntico en cada scan y la imagen es
  lo único volátil, así que el prefijo cachea limpio.

### Timeout — corrección deliberada

El guard de V0 era 10s, dimensionado para el fixture. Una llamada de visión real
con imagen completa lo habría superado siempre → todo scan degradado a manual. Se
subió a **30s**, manteniéndolo **más flojo** que el timeout interno del adapter
(25s): un guard exterior más estricto dispararía primero y sustituiría el error
específico del adapter por uno genérico.

### Body limit — bug latente encontrado

`main.ts` no fijaba límite de body → Express default **100kb** → toda foto real
habría dado 413 antes de llegar a Vision. Se subió a 8mb (5MB decodificado + sobre
JSON). Sin esto V2 no funciona en absoluto.

---

## 4. Eval harness — extendido, no rediseñado

- **`probeDeterminism` (default `true`):** el harness llamaba `recognize()` dos
  veces por caso para medir determinismo. Gratis contra el fixture; dinero real
  contra un vendor. El default preserva el comportamiento de CI; apagarlo evalúa un
  proveedor de pago a 1x coste.
- **`allDeterministic: boolean | null`** — `null` = "no medido". Nunca un aprobado
  ni un suspenso falsos. Un resultado no determinista de un modelo real es un
  **hallazgo**, no un fallo: la garantía de determinismo de la plataforma vive en
  las etapas puras posteriores al provider, que es exactamente por qué se
  construyeron puras.
- **`compareProviders(providers[], cases)`** — mismos casos, mismo puerto, misma
  validación de contrato para cada proveedor. Es el mecanismo para elegir
  proveedor por evidencia y no por lealtad a vendor, y es lo que queda pendiente de
  ejecutar cuando haya claves.

---

## 5. Configuración

| Variable | Default | Qué hace |
|---|---|---|
| `VISION_PROVIDER` | `fixture` | `claude` activa el proveedor real. Sin tocarla, nada cambia. |
| `VISION_MODEL` | `claude-opus-4-8` | `claude-sonnet-5` / `claude-haiku-4-5` son niveles más baratos. |
| `ANTHROPIC_API_KEY` | (ausente) | Ya existente (Weekly Coach). Sin ella → `hasKey=false` → degradación a manual. |

**Producción hoy:** sin `ANTHROPIC_API_KEY` y con `VISION_PROVIDER` sin fijar,
V2 se despliega **completamente inerte**. Activarlo es configuración, no código.

---

## 6. Verificación

`smoke:vision` **92/92** (V0+V1: 64 → V2: +28). Nunca toca producción ni llama a
un vendor: el adapter se ejercita sólo en caminos que cortocircuitan antes de la
red (sin key, imagen irresoluble) y por su superficie pura (prompt/schema/parser).

Cubre en V2: el store (put/resolve/discard, mime y tamaño rechazados en el borde,
refs ajenas → null sin excepción), el adapter (`hasKey=false`, puerto intacto,
fallo antes de gastar llamada, registro junto al fixture), contención de
prompt/schema, el parser (total ante basura, clamps, `portionGrams: 0` → chain a
SERVING_DEFAULT, output válido ante el gate), las extensiones del harness, y el
camino de subida real (proposal normal, ref del store persistido, **bytes nunca en
DB**, bytes liberados, camino reference-only intacto, imagen rechazada = bad
request sin fila huérfana).

**Sin regresiones:** los 10 smokes verdes (`vision, mealplan, planner, coach,
contract, review, ledger, state, rec, 1c`), `nest build` limpio, `tsc` mobile limpio.

---

## 7. Definition of done

| Criterio | Estado |
|---|---|
| Proveedor real integrado | ✅ `ClaudeVisionProvider` |
| Abstracción de proveedor intacta | ✅ `VisionProvider` sin cambios; registro = 1 línea |
| LogsService sigue siendo el único productor | ✅ smoke asserta no-bypass |
| Eval harness soporta el proveedor | ✅ sin modificar; + `probeDeterminism` y `compareProviders` |
| Fixture sigue funcionando | ✅ default; camino reference-only intacto |
| Fallback manual sigue funcionando | ✅ toda falla degrada |
| Mobile sin cambios salvo recibir propuestas reales | ✅ sólo `base64: true` + payload |
| Backend build / Mobile build / Smokes | ✅ / ✅ / ✅ 10 suites |
| Sin regresiones en Nutrición | ✅ ningún módulo de nutrición tocado |

---

## 8. Pendiente / diferido a propósito

- **Ejecutar el eval real** (`compareProviders` con claves de los 3) — es el único
  modo honesto de decidir calidad de reconocimiento. La elección actual es
  reversible por diseño.
- **Storage durable** (`SupabaseImageStore`) — el puerto ya existe; entra cuando
  haya un consumidor (eval corpus / re-lectura de scans viejos).
- **Auto-accept graduation** (V4) — sigue bloqueado tras precisión medida en
  `VisionFeedback` ≥95%. El usuario sigue siendo el quality gate: confirmación
  obligatoria, sin excepción.
- **Barcode / OCR / receipts / video** — nuevos adapters tras el mismo puerto; el
  adapter Claude declara `barcode: false` a propósito (un decoder dedicado le gana
  a un VLM ahí).
