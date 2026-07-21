# Nutrition Vision V4.0 — Shadow Rollout + Trust Analytics Platform

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones aplicadas**

---

## 1. Qué es este slice

La plataforma ya es inteligente (V0–V3.6). V4.0 construye lo que falta para **desplegarla con pruebas**: el sistema que responde "¿podemos encender auto-accept?", "¿puede graduar este proveedor?", "¿los usuarios confían?", "¿dónde falla el modelo?", "¿hay que frenar el rollout?" — **sin tocar una línea de Vision**.

**El rollout observa. Nunca controla. Nunca reescribe historia.**

---

## 2. Auditoría

| Búsqueda | Hallazgo |
|---|---|
| Lógica de rollout escondida | Ninguna — solo el comentario de `TrustAuditService.statistics()` llamando a `shadowOnly` "the rollout signal". Ese servicio queda como dueño de sus estadísticas; V4 lee filas crudas solo para preguntas que él no responde (timeline, FP/FN). |
| Métricas/confianza/salud duplicadas | Ninguna. Dueños únicos confirmados: `buildScorecard` (métricas), `buildCalibrationReport` (calibración), `decidePromotion` (promoción), `computeTrust` (confianza runtime). |
| **Verdad rota encontrada y centralizada** | `TERMINAL_STATUSES` (V3.5) no incluía `UNDONE` (V3.6 lo creó después): **los scans deshechos eran invisibles para todo dataset de evaluación** — el auto-accept se habría visto mejor de lo que es. Corregido en el reader (una lista, una verdad), no parcheado en rollout. |
| Segunda centralización | `acceptance()` era privada en metrics.ts → exportada para que health la reutilice en vez de recomputarla. `portionExamples()` extraída como definición única (engine + analytics). |

## 3. Arquitectura

```
                    datos append-only (nunca duplicados, nunca reescritos)
   VisionScan ──────────┐
   VisionFeedback ──────┼──► GroundTruthReader (dueño de datasets, V3.5)
   VisionTrustDecision ─┼──► RolloutDataReader (V4.0 — SOLO lo que nadie responde:
                        │      filas crudas para timeline y el join FP)
                        ▼
        ┌────────────────────────────────────────────────┐
        │ RolloutEngine (orquesta; no decide nada él)     │
        │  pipelines PUROS:                               │
        │   rollout-stage   DISABLED→SHADOW→READY→        │
        │                   LIMITED→ROLLOUT→FULL          │
        │   trust-analytics score = 0.5·avgTrust +        │
        │                   0.3·accept + 0.2·(1−undo)     │
        │   health          FP/FN, drift ECE, promoción   │
        │                   citada VERBATIM de su dueño   │
        │   gates           PASS/FAIL/N-A + razones       │
        │   risk            5 dimensiones, overall = MAX  │
        │   timeline        semanas ISO UTC, recomputable │
        └────────────────────────────────────────────────┘
                        ▼
   GET /vision/{rollout,trust,health,risk,timeline}   (read-only, JWT)
                        ▼
   mobile /admin-rollout (flag operador, rendering puro — no computa nada)
```

**Definiciones fijadas:**
- **Falso positivo** = auto-aceptado y deshecho (join `executed` × scans UNDONE).
- **Falso negativo** = exigió revisión y el usuario aceptó todo sin cambios (fricción sin causa; solo medible en scans confirmados).
- **Salud verde** = una sola definición (`isHealthGreen`) consumida por stages Y gates — jamás dos nociones de verde.
- **Deriva de calibración** = |ECE ventana actual − ECE ventana anterior|; null si falta evidencia (nunca inventada).
- **Challenger determinista** = el proveedor no-activo con más scans en la ventana (empate → orden alfabético).
- `PROMOTION_ALLOWED/BLOCKED` citan el veredicto del dueño de promoción **verbatim** — cero estadística propia; dos subsistemas no pueden discrepar sobre a quién promover.

## 4. Reglas de graduación (stages, deterministas)

| Etapa | Regla |
|---|---|
| DISABLED | infra de la modalidad apagada por config |
| SHADOW | flag off; <25 decisiones, o <5 habría-aceptado, o salud no verde |
| READY | flag off; ≥25 decisiones, ≥5 habría-aceptado, salud verde |
| LIMITED | flag on; <50 ejecuciones, o undo >20%, o salud no verde |
| ROLLOUT | flag on; 50–499 ejecuciones, salud verde |
| FULL | flag on; ≥500 ejecuciones, salud sostenida |

Global = la modalidad más conservadora. PORTION gradúa con su propio corpus (ejemplos de porción; limpios = habría-aceptado; nunca ejecuta sola — viaja dentro del auto-accept del scan). PHOTO/BARCODE/OCR/RESTAURANT graduán con sus decisiones de confianza.

## 5. Política de rollback y modos de fallo

- **`ROLLBACK_REQUIRED`** dispara con: undo >20%, fallos de proveedor >15%, ECE >0.3, o >10 falsos positivos — siempre con la evidencia numerada. La acción sigue siendo humana (apagar `AUTO_ACCEPT_ENABLED`); el sistema la exige, no la ejecuta.
- Modos de fallo cubiertos: proveedor degradado (riesgo TECHNICAL + gate), confianza deshonesta (MODEL/ECE), usuarios revirtiendo (USER/undo+FP), fricción inútil (BUSINESS/FN), muestra insuficiente o postura inconsistente — scorecard evaluado ≠ proveedor activo — (OPERATIONAL, HIGH).
- Ventana sin datos → todo `null` y `NOT_APPLICABLE`, jamás ceros inventados.

## 6. Tradeoffs y evolución futura

- **Derivar > materializar** (tercera aplicación): ningún reporte se guarda; todo se recomputa de datos append-only. Costo: queries por consulta (aceptable a esta escala); beneficio: cero desincronización posible y reportes históricos recomputables para siempre. Cuando el volumen lo exija, la evolución es un caché con TTL delante del engine — los contratos no cambian.
- **Umbrales como constantes exportadas**, no config: un umbral configurable es una perilla que alguien girará sin evidencia. Cambiarlos exige un commit versionado.
- **Dashboard mobile con tipos laxos** (renderiza `any`): duplicar los contratos en el cliente sería un segundo vocabulario que deriva. El backend es la verdad; la pantalla no computa nada.
- Futuro: rol admin real para los endpoints (hoy JWT), alertas push sobre `ROLLBACK_REQUIRED` (via retention-agent, ya existe), y per-usuario cohorts en timeline.

## 7. Archivos

**Nuevos (backend):** `rollout/types/rollout-contract.ts`, `rollout/rollout-data.reader.ts`, `rollout/pipeline/{rollout-stage,trust-analytics,health,gates,risk,timeline}.ts`, `rollout/rollout.engine.ts`, `rollout/rollout.controller.ts`, `scripts/smoke-rollout.ts`.
**Modificados (backend):** `learning/ground-truth.reader.ts` (UNDONE terminal — fix de centralización), `learning/pipeline/metrics.ts` (`acceptance()` exportada + UNDONE en decididos), `vision.module.ts`, `package.json` (+`smoke:rollout`).
**Mobile:** `src/config/features.ts` (+`adminDashboard`), `src/api/rollout.ts` (nuevo), `app/admin-rollout.tsx` (nuevo), `.env.example`.
**Cero migraciones. Cero cambios a Vision, Learning (salvo las 2 centralizaciones), Promotion, LogsService, o cualquier subsistema de Fase 2.**

## 8. Análisis de migraciones

**Ninguna.** Todo deriva de `VisionScan`, `VisionFeedback` y `VisionTrustDecision` existentes. Las migraciones pendientes de deploy siguen siendo las de V3.1/V3.3/V3.5/V3.6 (sin cambios).

## 9. Verificación

| Check | Resultado |
|---|---|
| `smoke:rollout` (nuevo) | ✅ **58/58** |
| Reglas de stage (los 6 estados + determinismo) | ✅ |
| Salud calculada a mano (aceptación 0.6667, undo 0.5, FP=1, FN=1, drift null honesto) | ✅ |
| Gates siempre con razones (nunca boolean pelado) | ✅ |
| Riesgo 5 dimensiones, overall = MAX | ✅ |
| Timeline 2 semanas ISO, recomputable | ✅ |
| READ-ONLY (pasada completa = 0 filas) + APPEND-ONLY (re-lectura byte-idéntica) | ✅ |
| Independencia de proveedor (relabel ⇒ score idéntico) | ✅ |
| `smoke:vision` 310 · `smoke:learning` 117 · 9 suites Fase 1–2 | ✅ sin regresiones |
| Backend build + tsc, mobile tsc | ✅ limpios |

## 10. Análisis de riesgo del propio slice

| Riesgo | Mitigación |
|---|---|
| El observador se vuelve actor | Imposible por construcción: sin acceso de escritura, sin referencia a flags mutables, endpoints solo GET |
| Dos verdades de una métrica | Auditoría hecha; 3 centralizaciones aplicadas (UNDONE, acceptance, portionExamples); dueños citados verbatim |
| Reportes engañosos con poca muestra | Nulls honestos, mínimos de slice (n≥3), gate INSUFFICIENT explícito, riesgo OPERATIONAL nombra la muestra |
| Dashboard filtrado a usuarios | Flag off por defecto, sin enlaces de navegación, y aun encendido: solo agregados |
| UNDONE ahora visible cambia métricas históricas | Intencional y documentado — antes el auto-accept se veía MEJOR de lo real; la corrección es conservadora |

**Estado: WAIT.** Nada commiteado, nada pusheado, ninguna migración aplicada. Esperando autorización explícita.
