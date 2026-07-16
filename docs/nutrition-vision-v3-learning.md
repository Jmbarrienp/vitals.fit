# Nutrition Vision V3.5 — Continuous Learning & Evaluation Engine

**Fecha:** 2026-07-15 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado, no desplegado

---

## 1. Qué es este slice

El subsistema permanente que convierte cada confirmación de usuario en conocimiento medible de plataforma. A partir de V3.5, la plataforma puede responder — **sin tocar código de producción** — preguntas como: ¿qué proveedor es mejor? ¿para qué alimentos? ¿para qué cocinas? ¿en qué rangos de confianza? ¿para qué usuarios? ¿a qué latencia y costo?

**El proveedor es temporal. Los datos acumulados son permanentes.** Ese es el moat, y este slice es su contador, su árbitro y su memoria.

---

## 2. Auditoría (Layer 0 — qué había, qué se perdía)

| Pregunta | Hallazgo |
|---|---|
| ¿Qué se recolecta ya? | `VisionFeedback` (identidad y gramos propuestos vs confirmados, acción, `proposedMethod` desde V3.3) — etiquetado desde V0. `VisionScan` (provider/model/version, detecciones crudas, proposal completo, status terminal, failureReason, confianza). |
| ¿Qué se descartaba? | **`latencyMs`: medido en cada scan, devuelto por el puerto, jamás persistido.** Tokens/costo: solo en `raw`, deliberadamente no persistido. Ambos irrecuperables para el pasado (sin backfill posible). |
| ¿Qué no se podía medir? | Latencia histórica, costo, calibración (¿un 0.9 reportado acierta el 90%?), determinismo del pipeline sobre datos reales, y ningún desglose per-food/user/cuisine/confidence. |
| ¿Cuál es la costura permanente? | `eval/vision-eval.harness.ts` (V2): puro, provider-agnóstico, mismo puerto — pero solo conoce casos sintéticos. V3.5 añade la mitad que faltaba: ground truth real. El harness sintético NO se reemplaza — mide proveedores nuevos sin tráfico; el motor V3.5 mide proveedores con tráfico real. |

---

## 3. Arquitectura — cuatro capas independientes

```
Layer 1 · GROUND TRUTH        GroundTruthReader (read-only)
  VisionScan ⋈ VisionFeedback → GroundTruthDataset { examples, scans }
  Cada corrección es un ejemplo etiquetado POR EL USUARIO — nunca por un
  modelo, nunca por una heurística. El usuario supervisa; la plataforma aprende.

Layer 2 · EVALUATION          metrics.ts (puro) + ReplayEngine (read-only)
  buildScorecard(dataset, providerId) → ProviderScorecard versionado
  ReplayEngine → pipeline ACTUAL sobre detecciones almacenadas vs ground truth

Layer 3 · CALIBRATION         calibration.ts (puro)
  bins de confianza reportada vs precisión empírica → CalibrationCurve + ECE
  calibrate(conf, curve): qué ha SIGNIFICADO históricamente esa confianza
  Interfaz reutilizable: cada proveedor futuro construye su curva de su
  propio tráfico, con cero cambios de código.

Layer 4 · PROMOTION           promotion.ts (puro)
  decidePromotion(incumbent, challenger) → PROMOTE / KEEP / INSUFFICIENT_DATA
  z de dos proporciones (una cola, 95%) sobre top-1 + gates de no-regresión.
  La decisión REPORTA; un humano cambia VISION_PROVIDER. Producción corre
  SIEMPRE un solo proveedor: sin ensembles, sin voting, sin comparación runtime.
```

Orquestador: `EvaluationEngine` (scorecard / calibration / compare / replay / summary). Superficies: **CLI** (`npm run eval:vision -- --provider=claude | --compare=fixture,claude | --replay | --days=30`) y **endpoints admin** (`GET /vision/learning/{summary,scorecard,calibration,comparison,replay}`, tras `JwtAuthGuard` — primeros candidatos a rol admin cuando exista; todo lo que devuelven ya es agregado).

### 3.1 Decisiones arquitectónicas clave

1. **Dejar de descartar telemetría** — 3 columnas aditivas (`latencyMs`, `tokensIn`, `tokensOut`) + `usage?` provider-agnóstico en `RecognitionResult` (números planos, jamás la forma del payload del vendor). Null = no medido (pre-V3.5), nunca cero. Única migración del slice.
2. **Curvas de calibración derivadas, no materializadas** (decisión V3.3 reaplicada): misma ground truth → misma curva; nada que sincronizar; la CURVA es el contrato, el algoritmo interno (binning hoy, isotónica mañana) puede cambiar sin tocar la interfaz.
3. **El replay no re-ejecuta proveedores sobre fotos históricas** — las imágenes son efímeras POR DISEÑO (privacidad > replayabilidad). El replay mide el pipeline propio; los proveedores se comparan por scorecard sobre su propio tráfico + el corpus sintético del harness V2.
4. **El replay corre SIN priors V3.3, a propósito** — el prior de hoy contiene la confirmación que el replay intenta predecir (fuga del futuro al pasado). Mide el piso NO personalizado del pipeline, que es la cantidad comparable en el tiempo.
5. **Proxies nombrados como proxies** — barcode/OCR/restaurant reportan *acceptance rate* (LOGGED vs decididos); la exactitud por campo necesita ground truth que esos flujos aún no capturan (gap documentado, no escondido).
6. **Política de promoción asimétrica** — empate conserva al incumbente; datos insuficientes conservan al incumbente; ganar en accuracy pero regresar en porciones o fallos pierde. Cambiar de proveedor cuesta (confianza del usuario, prompts, curva de calibración nueva): la carga de la prueba es del challenger. `z ≥ 1.645`, mínimos 50 scans / 100 ejemplos por lado.

### 3.2 Qué NO se tocó

Cero cambios a: LogsService, ciclo de vida del scan, motor de porciones, barcode, OCR, restaurante, matching, planner, coach, ledger, review. `VisionScanService` no ganó dependencias (el subsistema es paralelo, no inline). El único cambio en el hot path son tres asignaciones de telemetría en la persistencia del scan.

---

## 4. Archivos

**Nuevos:** `learning/types/eval-contract.ts` (contratos versionados), `learning/ground-truth.reader.ts`, `learning/pipeline/metrics.ts`, `learning/pipeline/calibration.ts`, `learning/pipeline/promotion.ts`, `learning/replay.engine.ts`, `learning/evaluation.engine.ts`, `learning/learning.controller.ts`, `scripts/eval-vision.ts` (CLI), `scripts/smoke-learning.ts`, migración `20260715150000_nutrition_vision_v3_5_telemetry`.

**Modificados:** `types/vision-contract.ts` (+`usage?`), `providers/response-validator.ts` (gate de usage, política strip), `providers/claude-vision.provider.ts` (+usage), `vision-scan.service.ts` (persistir telemetría), `vision.module.ts`, `schema.prisma`, `package.json` (+`smoke:learning`, +`eval:vision`), `scripts/smoke-vision.ts` (+3 asserts).

---

## 5. Métricas soportadas

Top-1/Top-3 accuracy, precisión y recall de reconocimiento, error de porción (medio y mediano, %), tasa de corrección manual, fallback/reject/failure rate, disponibilidad del proveedor, aceptación barcode/OCR/restaurante (proxies), latencia (media/p50), costo (tokens/scan), error de calibración (ECE), determinismo (medido en replay) — con desgloses per-food, per-user, per-cuisine, per-confidence-band y per-source. Métrica sin datos = `null` (UNMEASURED), nunca cero inventado.

---

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Sesgo de supervivencia (solo se etiqueta lo confirmado) | Los scans REJECTED/EXPIRED/FALLBACK cuentan como outcomes de scan; recall usa ADDED_MANUAL como señal de lo no propuesto |
| Proxies leídos como accuracy real | Nombrados `*AcceptanceRate` en el contrato; documentados aquí y en el código |
| Comparación con ventanas/tráfico distinto por proveedor | Gates de muestra mínima + el veredicto INSUFFICIENT_DATA nombra la evidencia faltante; misma ventana para ambos lados |
| Evaluación muta producción | Los engines no contienen NINGUNA llamada de escritura; el smoke lo prueba contando filas antes/después de una pasada completa |
| Endpoints exponen datos de otros usuarios | Todo lo devuelto es agregado; JWT hoy, rol admin cuando exista (documentado) |
| Curva de calibración con bins escasos | `calibrate()` cae al valor crudo bajo `MIN_BIN_SAMPLES` — nunca más opinionado que su evidencia |

---

## 7. Despliegue

- **Una migración aditiva** (3 columnas nullable, sin backfill — el dato nunca existió). Render Free: `npx prisma migrate deploy` manual tras el deploy.
- Sin flags nuevos, sin cambios mobile. El subsistema es read-only y no altera ningún flujo de usuario.
- La telemetría empieza a acumularse desde el primer scan post-deploy; los scorecards mejoran su cobertura solos con el tiempo.

## 8. Verificación

| Check | Resultado |
|---|---|
| `smoke:learning` (nuevo) | ✅ **52/52** — cada métrica contra valores calculados a mano |
| Garantía read-only | ✅ pasada completa de evaluación = 0 filas cambiadas (probado) |
| Determinismo | ✅ scorecard byte-idéntico entre corridas; replay con determinismo MEDIDO (dos pasadas) |
| `smoke:vision` | ✅ **288/288** (+3: gate de usage ×2, telemetría persistida) |
| Otros 9 smokes | ✅ todos verdes |
| Backend build + tsc, mobile tsc | ✅ limpios |

---

## 9. Por qué este diseño es la columna vertebral permanente

Los cuatro contratos (`GroundTruthDataset`, `ProviderScorecard`, `CalibrationCurve`, `PromotionDecision`) están versionados y expresados en vocabulario de plataforma. Un proveedor nuevo (GPT, Gemini, un modelo local) llega mañana como una línea en el registry — y este subsistema lo mide con las MISMAS definiciones, construye su curva de calibración con la MISMA interfaz, y lo somete a la MISMA política de promoción, sin que ningún archivo de `learning/` cambie. Las definiciones de métrica viven en un solo lugar puro; la ground truth viene solo del usuario; la evaluación es offline y read-only. Cuando el proveedor cambie, nada de lo aprendido se pierde — que es exactamente la propiedad que convierte los datos, y no el modelo, en el activo.
