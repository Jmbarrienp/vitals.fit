# Nutrition Vision V3.6 — Auto-Accept Graduation & Provider Promotion

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado, no desplegado, **producción inerte por defecto**

---

## 1. Qué hace este slice

V3.5 hizo que la plataforma **midiera**. V3.6 la hace **actuar sobre lo medido** — y decidir cuándo puede confiar en sí misma.

La primera vez que escaneas pollo a la plancha, confirmas. La segunda, revisas. A la sexta, la plataforma ya sabe cómo comes tú ese alimento y lo registra sola. Siempre puedes deshacerlo — y si lo deshaces, deja de hacerlo hasta volver a ganárselo.

Ningún proveedor se vuelve confiable por intuición. Nada se auto-acepta sin evidencia del propio usuario.

---

## 2. Auditoría

| Pregunta | Hallazgo |
|---|---|
| ¿Qué información ya soporta auto-accept? | **`deriveUxMode(band, fallback, candidateCount)`** — la costura de política runtime que V1 construyó y que ya decide qué UX recibe el usuario. **`ScanUxMode`** para extender. **`modeCopy(m) ?? FALLBACK`** en mobile: un modo desconocido degrada seguro (compat probada por diseño). V3.5: `CalibrationCurve`, `calibrate()`, `PromotionDecision`. V3.3: priors por (user, food). `VisionFeedback`: el corpus etiquetado desde V0, con `action` como columna String (vocabulario ampliable sin migración). |
| ¿Qué faltaba? | Sin acción `UNDONE` (`REMOVED` estaba declarada en el schema desde V0 y **nunca se produjo** — vocabulario muerto). Sin persistencia de auditoría de confianza. Sin endpoint de undo. Sin índice `(userId, confirmedFoodItemId)`. |
| ¿Qué políticas ya computan? | **`decidePromotion()` está completa desde V3.5** — gates, z-test y todo. El "Promotion Executor" de V3.6 **no la recomputa**: la envuelve con riesgo, impacto y checklist. |
| ¿Qué costura debe dueñar la confianza runtime? | `deriveUxMode`. Extenderla (parámetro opcional) en vez de crear un segundo camino de decisión paralelo. |
| **Bug preexistente encontrado** | **`LogsService.deleteMeal` no emitía ningún evento**, pero `meal.logged` es lo que marca `UserNutritionState` como stale. Borrar una comida dejaba sus calorías en el estado derivado (y por tanto en ledger/coach/planner) hasta que expirara el TTL. El gap **precede a Vision entero**; salió a la luz porque undo convierte el borrado en una acción frecuente y de primera clase. |

---

## 3. Decisiones arquitectónicas

1. **Auto-accept NO es un bypass de la confirmación — es su graduación.** El scan sigue recorriendo `PROPOSED → CONFIRMED → LOGGED` a través del **mismo `confirmScan` → `LogsService.logMeal`**. La plataforma ejecuta la confirmación que el usuario ya le enseñó, con undo siempre disponible. Cero caminos de escritura nuevos; `meal.logged` sigue disparando igual.

2. **La plataforma decide Y ejecuta.** Si el cliente tuviera que auto-aceptar, la decisión viviría en el cliente. `createScan` computa la confianza y, si está ganada, se auto-confirma a sí mismo. Un cliente viejo que ignore `AUTO_ACCEPT` cae en el copy de FALLBACK (degradado, nunca roto), y `confirmScan` rechaza un segundo confirm porque el scan ya no está `PROPOSED` — el invariante V0 protege contra doble registro.

3. **Modo sombra como default de producción** (`AUTO_ACCEPT_ENABLED=false`, la disciplina de todo slice Vision). Con el flag apagado el motor **igual computa, persiste y reporta** cada decisión. La política se valida contra tráfico real (`shadowOnly` en las estadísticas) **antes** de que actúe nunca. Con el flag apagado la experiencia es exactamente la de V3.5.

4. **Dos puertas, dos preguntas distintas — descubierto al escribir los tests.** La versión inicial hacía que el *nivel* de confianza y el *mínimo* de graduación midieran lo mismo (cantidad de evidencia): con eso, 5 confirmaciones daban MEDIUM (la narrativa del objetivo fallaba) y barcode (mínimo 2) **jamás** podría graduar. Separadas:
   - **score** (`trust.ts`) = ¿es el historial **limpio y vigente**? → `evidencia × limpieza × recencia`
   - **`GRADUATION_MINIMUMS`** (`auto-accept.ts`) = ¿hay **suficiente**? → y solo esta puerta conoce modalidades.

5. **La calibración es por PROVEEDOR (plataforma); la confianza es por USUARIO.** Dos puertas independientes: el tráfico de todos calibra al proveedor ("¿su 0.8 significa 0.8?"); las confirmaciones de uno graduan su alimento. Un proveedor sin calibrar **jamás** auto-acepta, por mucho que un usuario haya confirmado. Corolario verificado: **la confianza es provider-independiente** — vive en `VisionFeedback`, así que un cambio de proveedor conserva el moat.

6. **Fix del bug preexistente:** `meal.deleted` emitido por `LogsService` (el write path dueña sus eventos, así Vision nunca invade otro dominio) + listener en nutrition-state. Aditivo y retrocompatible; arregla también el borrado manual.

---

## 4. Los cuatro subsistemas

```
Subsystem 1 · RUNTIME TRUST ENGINE      trust.engine.ts + pipeline/trust.ts (puro)
  consume: TrustEvidence (VisionFeedback, read-only) · CalibrationCurve (V3.5)
           · FoodCandidate · UserHistory/FoodHistory
  produce: TrustDecision { level, score, signals, reasons, evidence, calibrated }
  política: cumulativa · decae (vida media 45d) · asimétrica (corrección = 2
           confirmaciones, undo = 5) · un undo reciente la anula al instante (14d)

Subsystem 2 · AUTO ACCEPTANCE POLICY    pipeline/auto-accept.ts (puro)
  MANUAL_REVIEW / REVIEW_REQUIRED / AUTO_ACCEPT + undoWindow + reason + signals
  graduación por modalidad:  BARCODE 2  ·  LABEL_OCR 3  ·  PHOTO 5  ·  RESTAURANT 8
  (identidad exacta → hechos impresos → inferencia → cocina ajena)

Subsystem 3 · PROMOTION EXECUTOR        promotion.executor.ts
  consume: PromotionDecision (V3.5, sin recomputar) + registry + config (read-only)
  produce: recomendación · explicación · evidencia · riesgo · impacto · checklist
  NUNCA cambia producción. Aprobación humana obligatoria.

Subsystem 4 · TRUST AUDIT               trust-audit.service.ts + VisionTrustDecision
  append-only: por qué · cuándo · qué evidencia · qué calibración · qué proveedor
  · qué versión de política · si actuó (executed) o solo decidió (sombra)
```

**Precedencia (verificada):** la degradación y la banda LOW siguen ganando primero — ninguna cantidad de confianza auto-acepta un scan del que la plataforma misma no está segura. Un plato vale lo que su alimento menos conocido: **todos** los candidatos deben estar graduados.

---

## 5. Archivos

**Nuevos (backend):** `learning/types/trust-contract.ts`, `learning/pipeline/trust.ts`, `learning/pipeline/auto-accept.ts`, `learning/trust-evidence.reader.ts`, `learning/trust.engine.ts`, `learning/trust-audit.service.ts`, `learning/promotion.executor.ts`, migración `20260716090000_nutrition_vision_v3_6_trust`.

**Modificados (backend):** `types/vision-contract.ts` (`AUTO_ACCEPT`, `UNDONE`, `proposal.trust?`), `pipeline/confidence.ts` (`deriveUxMode` +param opcional), `vision-scan.service.ts` (`applyTrust` + `undoScan`), `vision.controller.ts` (`POST /:id/undo`), `learning/learning.controller.ts` (6 endpoints read-only), `vision.module.ts`, `schema.prisma`, `.env.example`, `scripts/smoke-vision.ts`, `scripts/smoke-learning.ts`.

**Modificados (fix preexistente):** `orchestrator/events/meal.event.ts` (`MealDeletedEvent`), `logs/logs.service.ts` (emite `meal.deleted`), `nutrition-state/nutrition-state.listener.ts` (lo escucha).

**Mobile:** `types/vision.ts`, `lib/vision.ts` (copy `AUTO_ACCEPT`), `api/vision.ts` (`undo`), `hooks/useVisionCapture.ts` (estado `auto_accepted` + `undo`), `app/scan.tsx` (pantalla de auto-aceptado con Deshacer).

---

## 6. Endpoints admin (todos read-only)

`GET /vision/learning/trust` (el propio, graduados + pendientes) · `trust/scan/:scanId` (explicabilidad, ownership-checked) · `trust/statistics` (agregado, incluye `shadowOnly`) · `promotion` (recomendación + riesgo + checklist) · `calibration/health` (`autoAcceptCapable`) · más los V3.5 (`summary`, `scorecard`, `calibration`, `comparison`, `replay`).

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Auto-aceptar algo equivocado | Modo sombra por defecto; 5 puertas independientes (evidencia, limpieza, recencia, calibración, no-degradación); undo siempre; todo candidato debe graduar |
| El usuario no nota que se registró solo | La pantalla lidera con "Registrado automáticamente", explica por qué y pone Deshacer primero |
| Confianza permanente / stale | Decae con vida media de 45d; 180d de inactividad → NONE; un undo reciente la anula al instante |
| Undo ignorado | Es ground truth: escribe `UNDONE` en el mismo corpus que V3.5 aprende, y bloquea 14 días |
| Cliente viejo con `AUTO_ACCEPT` | `modeCopy` degrada a FALLBACK; `confirmScan` rechaza re-confirmar un scan ya LOGGED (sin doble registro) |
| Promoción automática de proveedor | Imposible por construcción: el executor no tiene acceso de escritura a config |
| Auditoría reescribible | Append-only; sin update ni delete; versión de política en cada fila |
| Curva de calibración cacheada (TTL 10 min) | Las curvas cambian lento; documentado. Detectado al escribir los tests (un engine de larga vida cachea una curva vacía) |

---

## 8. Despliegue

- **Una migración**: tabla `VisionTrustDecision` (nueva, append-only) + índice aditivo en `VisionFeedback`. Sin backfill, sin cambio de datos.
- **Producción inerte doble**: `AUTO_ACCEPT_ENABLED=false` (default) → todo se decide y persiste, nada se auto-acepta. Y `VISION_PROVIDER=fixture` sigue significando que no hay escenas reales.
- **Rollout recomendado**: desplegar → dejar acumular decisiones en sombra → revisar `GET /vision/learning/trust/statistics` (`shadowOnly`, `byTrustLevel`) y `calibration/health` → recién ahí `AUTO_ACCEPT_ENABLED=true`.
- Render Free: `npx prisma migrate deploy` manual.

## 9. Verificación

| Check | Resultado |
|---|---|
| `smoke:vision` | ✅ **310/310** (288 → +22) |
| `smoke:learning` | ✅ **117/117** (52 → +65) |
| Narrativa del objetivo, end-to-end | ✅ 1º confirma → 2º-5º revisa → 6º **auto-acepta** por el mismo write path |
| Undo | ✅ borra vía LogsService, escribe 3 `UNDONE`, scan UNDONE, y el siguiente scan **deja de auto-aceptar al instante** |
| Modo sombra | ✅ misma evidencia, misma calibración, solo cambia el flag: decide AUTO_ACCEPT, `executed=false`, status PROPOSED |
| Trust puro | ✅ nuevo usuario, 1 sighting, 5ª limpia, barcode al mínimo, corrección, undo catastrófico, decay exacto en la vida media, 180d → NONE, clock-skew |
| Modalidades | ✅ barcode 2 grad. / photo con 2 no / restaurant 5 de 8 / OCR 3 |
| Promotion executor | ✅ recomienda, no actúa; challenger no registrado nunca se recomienda; riesgo por calibración/coste/latencia; deriva de incumbente |
| Read-only | ✅ pasada completa de evaluación = 0 filas cambiadas |
| Determinismo | ✅ trust, política y recomendación byte-idénticas |
| Otros 9 smokes + build + tsc ×2 | ✅ todos verdes |

---

## 10. Por qué esto convierte a Vision en una plataforma de registro autónoma y confiable

Hasta V3.5, Vision era un escáner inteligente: proponía, y el usuario decidía — cada vez, para siempre, sin importar cuántas veces hubiera dicho que sí a lo mismo. La inteligencia no se acumulaba en la *experiencia*, solo en los informes.

V3.6 cierra el lazo. La plataforma ahora sabe **qué sabe** (evidencia por usuario y alimento), **qué tan honesto es su proveedor** (calibración), **cuándo eso dejó de ser cierto** (decay), y **cuándo se equivocó** (undo). Con eso puede hacer algo que un escáner no puede: **actuar sola, y explicar por qué, y dejar de hacerlo cuando se equivoca**.

Y lo hace sin mover ni un milímetro la frontera de verdad. El proveedor sigue generando hipótesis. El usuario sigue creando la verdad. La plataforma decide — con funciones puras, versionadas y auditables — si una hipótesis se ganó el derecho a no preguntar. La confianza no se otorga: se gana, decae, y se pierde de golpe cuando se traiciona. Eso no es un modelo más listo; es una plataforma en la que se puede confiar.
