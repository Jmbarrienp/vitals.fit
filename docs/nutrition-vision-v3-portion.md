# Nutrition Vision V3.3 — Motor de Estimación de Porciones Adaptativo

**Fecha:** 2026-07-15 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado, no desplegado

---

## 1. Qué resuelve este slice

El reconocimiento ya está resuelto (V2). El problema restante es **cuánto** está comiendo el usuario. V3.3 introduce el **Portion Estimation Engine**: un motor determinista que combina la estimación del modelo de visión con la historia real del usuario, y que hace que la plataforma sea progresivamente mejor para cada usuario individual — sin retraining, sin embeddings, sin memoria en el LLM.

**Después de este slice:**
- El reconocimiento identifica el alimento (Claude propone).
- **La plataforma determina la porción** (el motor decide).
- El usuario puede corregirla (supervisión).
- La corrección mejora las predicciones futuras (aprendizaje determinista).
- Claude se vuelve progresivamente menos importante; la historia del usuario, más.

---

## 2. Auditoría (qué existía, qué se reutilizó, qué no se tocó)

### 2.1 El corpus de supervisión ya existía — y nadie lo leía

`VisionFeedback` se captura desde V0 en **cada** confirmación: `proposedGrams` vs `confirmedGrams`, acción (`ACCEPTED`/`EDITED_PORTION`/`SWAPPED`), indexado por `[userId, createdAt]`. Antes de V3.3 había exactamente **una** referencia en todo el backend: el `createMany` que escribe. El "diseña un motor de corrección" del task resultó ser en gran parte "lee el corpus que V0 ya venía acumulando".

### 2.2 El corpus de priors también existía

`LoggedMealItem.amountG` son los gramos **resueltos por el backend** — output validado de plataforma (lo que el usuario confirmó o tecleó), nunca un número crudo del proveedor. Está indexado por `foodItemId`, lleva `mealType` vía `LoggedMeal`, y cubre TODAS las fuentes (manual, foto, barcode, etiqueta). Cada corrección del usuario ya termina ahí: el prior y la corrección convergen en el mismo corpus.

### 2.3 El punto de extensión estaba prometido desde V0

`estimatePortion` fue documentado en V0 como *"a strategy chain — future strategies plug into this same chain without touching callers"*. V3.3 cobra esa promesa: el motor se acopla en `buildCandidates` (composición pura) con un parámetro **aditivo y opcional**; el I/O de priors vive en el servicio orquestador, exactamente donde V0 puso el I/O de búsqueda.

### 2.4 Lo que NO se tocó

| Superficie | Cambios |
|---|---|
| `LogsService` / write path / `meal.logged` | **cero** |
| Planner (decisiones), CoachingContext, Recommendation Engine, Weekly Review, Ledger | **cero** — `PlannedMealItem` se lee, jamás se escribe |
| `confirmScan`/`rejectScan`/`getScan`/`sweepExpired` | **cero** (cuarta vez consecutiva que el ciclo de vida resulta agnóstico) |
| Fórmula de confianza (`scoreCandidate`) | **cero** — el motor solo alimenta mejor el slot `portion` que ya existía |
| Proveedores (fixture, Claude) | **cero** — el motor es invisible para el puerto `VisionProvider` |

---

## 3. Riesgo arquitectónico detectado: sesgo de medición

El task pedía combinar la **meta** del usuario en la estimación. Hacerlo de forma directa sería un error grave: escalar los gramos *percibidos* hacia la meta sesga la **medición** hacia la **prescripción**. Un usuario en déficit vería porciones sistemáticamente subestimadas, su adherencia se vería mejor de lo real, y todo Phase 2 (UserNutritionState, ledger, coach, planner adaptativo) consumiría datos corruptos.

**Decisión:** la meta entra **solo** vía la señal PLANNER (las cantidades planificadas ya la codifican), con peso fijo y bajo (0.15), y jamás como multiplicador directo de la percepción. El plan dice lo que *debería* haber en el plato; la cámara y la historia dicen lo que *hay*.

---

## 4. Arquitectura

```
                       Claude (propone UNA señal, nada más)
                              │ portionHint.grams
                              ▼
  estimatePortion (V0, intacto) ──► PortionEstimate base
                              │
   PortionPriorReader (único I/O) ─┐
   ├─ LoggedMealItem.amountG       │  observaciones validadas (user, food, mealType)
   ├─ VisionFeedback (corregido)   │  ratios confirmado/propuesto (solo PROVIDER_ESTIMATE)
   └─ PlannedMealItem.amountG      │  expectativa del plan ACTIVO (solo lectura)
                              ▼    ▼
              resolvePortion (PURO — pipeline/portion-engine.ts)
              1. corrige la señal de visión con el bias aprendido
              2. deriva el prior (mediana + MAD, subset por mealType si n≥3)
              3. pondera: wHistoria = min(n,12)/(min(n,12)+3) · wVisión = confianza base · wPlan = 0.15
              4. gramos finales = media ponderada, clamp 10–600 (límites compartidos con V0)
              5. confianza: tier del prior + bonus si visión e historia CONCUERDAN
              6. método: USER_PRIOR si la historia domina, BLENDED si no
              7. explicación estructurada (PortionSignal[]) — persiste en el proposal Json
                              ▼
              FoodCandidate.portion + portionExplanation
                              ▼
     confirmación → LogsService.logMeal() → meal.logged   (write path intacto)
                              ▼
     captureFeedback ahora graba proposedMethod → el corpus de corrección queda atribuido
```

### 4.1 Aprendizaje determinista sin tabla nueva

Deliberadamente **no** hay tabla `PortionPrior` materializada. El prior se **deriva en lectura**: mediana + MAD de las últimas 20 observaciones indexadas. Cero estado duplicado, cero riesgo de desincronización, y "aprender" = la siguiente query ve una fila más. Misma filosofía que UserNutritionState (derivar, no acumular). Misma historia → mismo prior → misma estimación: determinismo por construcción.

### 4.2 Confianza progresiva (el dial del moat)

`w = min(n,12)/(min(n,12)+3)` — a 3 registros la historia del usuario ya pesa tanto como todo lo demás junto; a 12, domina (~0.8, tope). El prior usa el subset del mealType cuando tiene ≥3 observaciones (el mismo usuario come 200g de arroz en almuerzo y 80g en cena), si no, todos los logs del alimento, si no (n<2), no hay prior y el comportamiento es **idéntico** al pre-V3.3.

MAD en vez de desviación estándar: un log absurdo no puede inflar la dispersión (verificado en smoke: `mad([160,165,170,165,900]) === 5`).

### 4.3 Motor de corrección

Cada edición de gramos es supervisión. `captureFeedback` ahora graba `proposedMethod` (única migración: columna nullable), y el lector filtra `proposedMethod='PROVIDER_ESTIMATE'` — sin esa atribución, editar un default de catálogo se aprendería como error del modelo. El bias = mediana de los ratios confirmado/propuesto (las filas ACCEPTED aportan ratio 1.0 y regularizan hacia "sin corrección"), mínimo 5 muestras, clamp [0.5, 2.0]. Se aplica **solo** a la señal de visión, nunca a la historia ni al plan, y siempre queda explicado (`"ajustada ×0.80 según tus correcciones previas"`). Filas pre-V3.3 tienen `proposedMethod` null y quedan excluidas por construcción.

### 4.4 Por qué Claude no puede ser la memoria

El proveedor sigue devolviendo exactamente lo mismo que en V2: detecciones con un `portionHint` opcional. No sabe que el motor existe. No recibe historia del usuario en el prompt (sería no-determinista, caro, y convertiría al vendor en dueño del conocimiento del usuario). El conocimiento vive en Postgres, la aritmética en funciones puras, y cambiar de proveedor mañana conserva todo lo aprendido — eso es el moat.

---

## 5. Archivos

**Nuevos (backend):** `pipeline/portion-priors.ts` (estadística pura), `pipeline/portion-engine.ts` (blend puro), `priors/portion-prior.reader.ts` (único I/O), migración `20260715120000_nutrition_vision_v3_3_portion_method`.

**Modificados (backend):** `pipeline/portion.ts` (exporta `clampGrams` — límites compartidos), `pipeline/build-candidates.ts` (parámetro aditivo opcional), `types/vision-contract.ts` (`USER_PRIOR`/`BLENDED`, `PortionSignal`, `portionExplanation?`), `vision-scan.service.ts` (fetch de priors en el path de foto; `proposedMethod` en feedback), `vision.module.ts` (registra el reader), `schema.prisma` (una columna nullable).

**Mobile:** `types/vision.ts` (espejo del contrato), `scan.tsx` (hint "según tu historial" / "ajustado a tu historial" cuando el método lo indica — la plataforma decide, mobile solo lo muestra).

**Alcance deliberado:** el motor opera en el path de **foto** (donde la porción es el problema). Barcode y etiqueta usan porciones de empaque/porción impresa — su incertidumbre es otra. Los candidatos sin match de catálogo (`foodItemId` null) no tienen clave estable de prior y pasan sin cambios.

---

## 6. Migración y despliegue

- **Una** migración aditiva: `ALTER TABLE "VisionFeedback" ADD COLUMN "proposedMethod" TEXT;` — nullable, sin backfill, sin riesgo de lock. String, nunca enum de Postgres (lección 2B.1).
- Sin flags nuevos: el motor sin datos es matemáticamente idéntico al comportamiento anterior (verificado), así que está siempre activo y se enciende solo a medida que cada usuario acumula historia.
- Render Free = migración manual (patrón establecido): `npx prisma migrate deploy` tras el deploy del código.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Prior aprende de un período atípico (vacaciones) | Ventana de 20 observaciones más recientes; la mediana se recupera al ritmo del usuario |
| Usuario cambia su porción habitual deliberadamente | Sus ediciones son supervisión: 2–3 correcciones mueven la mediana de la ventana |
| Query extra por scan (priors) | 1 fetch de bias por scan + 2 queries indexadas por candidato matcheado; falla-soft (un prior jamás tumba un scan — verificado) |
| Bias mal atribuido | `proposedMethod` filtra; filas históricas null quedan fuera por construcción |
| Sesgo de medición por meta | La meta jamás multiplica la percepción; solo entra vía PLANNER con peso 0.15 (§3) |
| Explosión del proposal Json | `portionExplanation` son ≤3 señales pequeñas y deterministas por candidato |

---

## 8. Verificación

| Check | Resultado |
|---|---|
| `smoke:vision` | ✅ **246/246** (196 → +50) |
| Loop de aprendizaje end-to-end | ✅ 180g (modelo) → 209g (3 logs, BLENDED) → 216g (8 logs, USER_PRIOR) — aritmética exacta predicha en diseño |
| Confianza progresiva | ✅ 0.7 (proveedor) → 0.85 (plataforma conoce al usuario) |
| Usuario nuevo = comportamiento pre-V3.3 | ✅ byte-idéntico (guard de regresión explícito) |
| Determinismo | ✅ misma historia → decisión idéntica (JSON igual) |
| Otros 9 smokes (1c, state, rec, ledger, review, contract, coach, planner, mealplan) | ✅ todos verdes |
| Backend `npm run build` + `tsc --noEmit` | ✅ limpio |
| Mobile `tsc --noEmit` | ✅ limpio |
| Write path / planner / coaching / ledger tocados | ✅ cero |
