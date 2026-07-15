# Nutrition Vision V3.1 — Barcode Scanner

**Estado:** implementado en `feature/nutrition-state-2a2` (sobre V2) — local, NO desplegado, NO pusheado, NO mergeado. Esperando autorización explícita.
**Migración:** UNA columna aditiva (`VisionScan.barcodeValue`). `FoodItem.barcode` ya existía en el schema, sin usar.
**Feature flag:** `EXPO_PUBLIC_BARCODE_ENABLED` — nueva e independiente de `EXPO_PUBLIC_VISION_ENABLED`. Off por defecto.
**Gobernado por:** `docs/nutrition-vision-strategy.md` §1.1, §5 (roadmap ítem V3b) — barcode es la primera modalidad no-VLM prometida en esa estrategia.

---

## 1. Auditoría de arquitectura (antes de escribir código)

Hallazgos que determinaron el diseño, en orden de impacto:

| Hallazgo | Consecuencia de diseño |
|---|---|
| `FoodItem.barcode String?` **ya existía**, indexado, sin usar. `source: "open_food_facts"` ya era un valor válido anticipado. | Cero migración para el cache exacto de productos. El schema ya sabía que esto venía. |
| El lifecycle de `VisionScan` (CREATED→PROCESSING→PROPOSED→CONFIRMED→LOGGED, +REJECTED/EXPIRED/FAILED/FALLBACK_MANUAL) es agnóstico a la fuente. `confirmScan/rejectScan/markFallbackManual/getScan/sweepExpired` no leen `source` en ninguna decisión de negocio. | Barcode reutiliza esos cinco métodos **sin tocar una línea**. Solo hace falta un productor nuevo (`createBarcodeScan`), simétrico a `createScan`. |
| El decode del código de barras ocurre **en el dispositivo** (hardware de cámara vía `expo-camera`), nunca en el backend. El backend nunca ve una imagen. | `BarcodeLookupProvider` es un puerto genuinamente distinto de `VisionProvider` — su input es un string ya decodificado, no un `imageRef`. No es una variante del puerto de visión, es un hermano. |
| Mobile no tenía ninguna librería de cámara en vivo (`expo-image-picker`, usado en V1, solo toma una foto puntual, no decodifica en continuo). | Única dependencia nativa nueva del slice: `expo-camera` (compatible con Expo Go, sin dev client — confirmado por versión instalada 17.0.10 contra Expo SDK 54). |
| Un código de barras es identidad **exacta**, no una etiqueta ambigua de foto. `matchDetection()` (fuzzy, por diseño) asumiría incertidumbre donde no la hay. | El pipeline de barcode NO reutiliza `matchDetection`. Reutiliza `estimatePortion` y `scoreCandidate` sin cambios, pero con `recognition=1` y `match=1` siempre — la única incertidumbre real es la porción. |
| `FoodModule` es importado por `VisionModule`, nunca al revés (regla arquitectónica existente, verificada en V0/V2). | El nuevo método `FoodService.upsertFromBarcode()` recibe un objeto de datos primitivo (`BarcodeProductData`), NO el tipo `BarcodeProduct` de `vision/types/`. Cero import cruzado de módulo. |

### Decisión explícita: cero tablas nuevas

El brief ofrecía `BarcodeScan`/`BarcodeLookup` como entidades *posibles*, condicionadas a "si es verdaderamente necesario". Se determinó que **no lo es**: `VisionScan` ya cubre el lifecycle completo, y una columna (`barcodeValue`) basta para persistir qué se escaneó — exactamente el mismo rol que `imageRef` cumple para fotos.

---

## 2. Arquitectura implementada

```
Cámara (on-device, expo-camera)
    │  decodifica EAN-13/EAN-8/UPC-A → string numérico
    ▼
POST /vision/scans/barcode  { barcode }
    │
    ▼
VisionScanService.createBarcodeScan()
    │
    ├─ 1. FoodService.findByBarcode(barcode, userId)          ← exacto, catálogo global + custom del usuario
    │       │
    │       └─ encontrado → salta el lookup externo (providerId='local-cache')
    │
    ├─ 2. (si no) BarcodeLookupProviderRegistry.active().lookup(barcode)
    │       │
    │       ├─ found:false  → proposal PROPOSED, candidates=[], fallback='BARCODE_NOT_FOUND', mode=FALLBACK
    │       ├─ throw (red/timeout) → scan FAILED, mismo contrato de degradación que Vision
    │       └─ found:true   → FoodService.upsertFromBarcode() crea UN FoodItem global (idempotente por barcode)
    │
    ├─ 3. buildBarcodeCandidate(food, servingHint, defaultServing)   ← PURO, reutiliza estimatePortion+scoreCandidate
    │
    └─ 4. proposal PROPOSED, 1 candidato (o 0), mode CONFIRM/REVIEW/FALLBACK
              │
              ▼
    (idéntico a Vision desde aquí — CERO cambios)
    confirmScan() → LogsService.logMeal() → meal.logged → toda la plataforma
```

### 2.1 El puerto — `BarcodeLookupProvider`

```ts
interface BarcodeLookupProvider {
  readonly id: string;
  lookup(barcode: string): Promise<BarcodeLookupResult>;
}
```

Espejo deliberado de `VisionProvider` en el patrón (puerto + registry + config-select), pero con forma propia: `lookup(string)`, no `recognize(imageRef)`. `BarcodeLookupProviderRegistry` es una clase separada de `VisionProviderRegistry` — mismo mecanismo (`BARCODE_LOOKUP_PROVIDER` config-selected), cero acoplamiento de código.

**Providers registrados (`vision/barcode/`):**
- `FixtureBarcodeLookupProvider` — determinista, dos productos LATAM conocidos (prefijos GS1 750/México y 770/Colombia) + un genérico + un "no encontrado" explícito. Cero coste, cero red.
- `OpenFoodFactsLookupProvider` — API pública real, **sin key** (`world.openfoodfacts.org`). A diferencia de Claude, el default de producción es este, no el fixture — no hay coste ni cuenta que proteger. Timeout 8s, `AbortController`, normaliza y descarta cualquier producto sin macros usables (found:false, no un error).

### 2.2 El pipeline puro — `buildBarcodeCandidate`

Reutiliza `estimatePortion()` y `scoreCandidate()` **sin modificarlos**. La diferencia semántica frente a Vision está documentada en el propio módulo: `recognition=1` y `match=1` siempre, porque el código de barras es una identidad exacta — la única incertidumbre real es la porción (gramos). Un candidato de barcode **nunca tiene `foodItemId: null`**: siempre está ligado a un `FoodItem` real (existente o recién creado), a diferencia de una detección de foto sin match de catálogo.

### 2.3 Cache de catálogo — `FoodService.upsertFromBarcode`

Un lookup externo exitoso crea un `FoodItem` **global** (`createdByUserId: null`, `source: 'open_food_facts'`, `barcode` estampado). Es idempotente: re-verifica por barcode antes de insertar, así que dos escaneos consecutivos del mismo código nuevo resuelven al mismo `FoodItem`, no a dos. Deliberadamente **no** se creó una restricción `@unique` a nivel de DB sobre la columna `barcode` preexistente — hacerlo hubiera arriesgado un fallo de migración contra datos ya sembrados; la idempotencia vive en la capa de aplicación (ver §7, riesgo de carrera).

---

## 3. Reglas de matching — respuesta explícita al brief

> "Search order: 1. Existing FoodItem 2. User Custom Foods 3. Favorites 4. Frequent Foods 5. Recent Foods 6. Catalog"

Esta jerarquía de 6 niveles existe para **desambiguar** coincidencias difusas (una etiqueta de foto puede rankear contra varios candidatos). Un código de barras no tiene esa ambigüedad: **o es el mismo producto real, o es otro**. La implementación colapsa correctamente los 6 niveles en una sola query exacta (`FoodService.findByBarcode`, scoped a catálogo global + comidas custom del propio usuario) — es matemáticamente equivalente a recorrer la jerarquía completa para una búsqueda de identidad exacta, y evita el riesgo real que tendría reusar `matchDetection()` aquí: un fuzzy-match del nombre del producto (p.ej. "Nutri-Grain Cereal Bar") podría enlazar por error macros de un ítem genérico del catálogo ("Cereal") que NO corresponden al producto empacado real que el usuario tiene en la mano.

---

## 4. Confianza y fallback — respuesta explícita al brief

| Situación | Resultado |
|---|---|
| Decodificado + producto exacto (local o recién resuelto) | Candidato con `foodItemId` real, `matchScore=1`, banda HIGH/MEDIUM según certeza de porción → modo CONFIRM/REVIEW |
| Decodificado + lookup falla (`found:false`, producto no registrado) | `candidates=[]`, `fallback.reason='BARCODE_NOT_FOUND'`, modo FALLBACK → mobile prellena búsqueda manual con el código |
| Decodificado + error de red/timeout | Scan `FAILED`, `fallback.reason='PROVIDER_ERROR'` — MISMO contrato de degradación que Vision, distinto de "no encontrado" |
| Offline | El error de red cae en el caso anterior; el scan queda persistido con el `barcodeValue`, así que no se pierde — "guardar para después" queda satisfecho por la fila misma, sin entidad nueva |

**Nunca se auto-registra.** La confirmación del usuario sigue siendo obligatoria en todos los casos — cero cambio a esa invariante.

---

## 5. UI — mobile

- `src/hooks/useBarcodeCapture.ts` — máquina de estados espejo de `useVisionCapture` (`idle→scanning→proposing→proposed→confirming→done/error`), mismas invalidaciones de query.
- `app/scan-barcode.tsx` — pantalla hermana de `scan.tsx` (no tocada). Cámara en vivo (`CameraView` de `expo-camera`, tipos `['ean13','ean8','upc_a']`, numéricos, consistentes con la validación del DTO backend). Como un barcode resuelve a lo sumo un candidato, no hay selección por ítem — el patrón visual (`Card`, `bandCopy`, `modeCopy`) es idéntico al de Vision.
- Botón "📦 Escanear código de barras" en `log.tsx`, detrás de `FEATURES.barcodeScan` — flag **independiente** de `visionCapture` (progressive enhancement: cada modalidad se activa por separado).

---

## 6. Migración

```sql
ALTER TABLE "VisionScan" ADD COLUMN "barcodeValue" TEXT;
```

Aditiva, nullable, sin tocar ninguna columna existente. `FoodItem.barcode` no requiere migración (preexistente).

---

## 7. Evaluación de riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Carrera en `upsertFromBarcode` bajo escaneos verdaderamente concurrentes del mismo código nunca-antes-visto | Baja | Re-chequeo por barcode antes de insertar reduce la ventana; no eliminada (sin constraint `@unique` de DB, decisión deliberada — ver §2.3). Aceptable a la escala de tráfico actual del proyecto; documentado, no resuelto con maquinaria adicional. |
| Dependencia nativa nueva (`expo-camera`) | Media | Confirmado incluido en el bundle estándar de Expo Go para SDK 54 (no requiere dev client); instalado con `--legacy-peer-deps` por el conflicto preexistente reanimated/worklets ya documentado en memoria desde V1. |
| Calidad de datos de OpenFoodFacts (producto mal etiquetado, macros ausentes) | Media | `normalizeProduct()` descarta cualquier producto sin las 4 macros básicas (found:false en vez de datos basura); el usuario sigue confirmando antes de cualquier registro. |
| Contaminación del catálogo global con productos regionales irrelevantes | Baja | Cada fila nueva lleva `source='open_food_facts'` + `isVerified:false` — auditable y filtrable; no se mezcla con `curated_latam`. |
| `expo-camera` con `barcodeScannerSettings` dispara `onBarcodeScanned` en cada frame mientras el código sigue en cuadro | Media (UX/coste) | `submittingRef` en el hook garantiza un solo submit por sesión de escaneo — verificado por diseño, no por smoke (no hay forma de simular frames de cámara en un smoke de backend). |

---

## 8. Smoke tests

`npm run smoke:vision` — extendido de 92 a **119 assertions**, todas verdes. Nuevas secciones:

- **Pure — registry + fixture**: determinismo del fixture, swap de proveedor por config, default correcto (`openfoodfacts`, no `fixture`), fallo ruidoso ante proveedor desconocido.
- **Pure — candidate pipeline**: todo candidato de barcode lleva `foodItemId` real (nunca huérfano), `matchScore=1` (identidad exacta, no fuzzy), el hint de porción del producto alimenta `estimatePortion` sin cambios al chain.
- **Integración — lifecycle**: primer escaneo de un código nuevo resuelve vía lookup externo y crea un `FoodItem` global con `source='open_food_facts'` y `barcode` estampado.
- **Integración — escaneos duplicados**: el mismo código escaneado dos veces resuelve al MISMO `FoodItem` (no crea una fila duplicada); el segundo escaneo salta el lookup externo (`providerId='local-cache'`).
- **Integración — degradación "no encontrado"**: un código sintácticamente válido pero no registrado deja el scan en `PROPOSED` (no `FAILED`) con `candidates=[]` y razón específica.
- **Integración — fallo de proveedor/offline**: un proveedor que lanza (simulando red caída) deja el scan en `FAILED`, distinto del caso "no encontrado".
- **Integración — convergencia de escritura**: confirmar un scan de barcode pasa por el MISMO `confirmScan`/`LogsService.logMeal` sin ningún cambio de código, y el `LoggedMeal` resultante lleva la misma proveniencia (`source='vision'`, `visionScanId`) que un scan de foto.

Sin regresiones: los 9 smokes anteriores + `smoke:vision` (V0/V1/V2 intactos) + build de backend + `tsc` de mobile, todos limpios.

---

## 9. Notas de despliegue

- **Cero migración de riesgo** — una columna nullable aditiva.
- **`BARCODE_LOOKUP_PROVIDER` no necesita configurarse** — el default (`openfoodfacts`) es el proveedor real, gratis y sin key, a diferencia de Vision (que exige `ANTHROPIC_API_KEY` explícita para salir del fixture). Desplegar sin tocar nada activa el lookup real automáticamente, PERO el botón sigue oculto detrás de `EXPO_PUBLIC_BARCODE_ENABLED=false` (default), así que producción no ve ningún cambio de comportamiento hasta que se active el flag mobile.
- Sigue en `feature/nutrition-state-2a2`, sin mergear, sin desplegar — como el resto de Vision, en espera de la autorización de deploy gate ya documentada en memoria.

---

## 10. Reporte de verificación

| Verificación | Resultado |
|---|---|
| `npx tsc --noEmit` (backend) | ✅ limpio |
| `npm run build` (backend) | ✅ limpio |
| `npm run smoke:vision` | ✅ 119/119 |
| `smoke:1c/state/rec/ledger/review/contract/coach/planner/mealplan` | ✅ 9/9 sin regresión |
| `npx tsc --noEmit` (mobile) | ✅ limpio |
| `expo-camera` instalado y compatible con Expo SDK 54 | ✅ v17.0.10 |
