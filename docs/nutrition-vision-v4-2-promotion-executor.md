# Nutrition Vision V4.2 — Provider Promotion Executor

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones**

---

## 1. Qué es este slice

El sistema que transforma una **decisión estadística** (que ya existe) en un **Plan de Promoción completamente auditable**. No cambia proveedores, no escribe configuración, no toca variables de entorno, no ejecuta nada. Construye un documento; un humano lo lee y decide.

"Executor" es aspiracional a propósito: **no ejecuta nada.** Produce un plan.

---

## 2. Auditoría

| Pregunta | Hallazgo |
|---|---|
| ¿Cómo decide Governance hoy? | `GovernanceEngine.recommend()` → `GovernanceRecommendation` (V4.1): action PROMOTE/MAINTAIN/DEMOTE/HOLD/REQUIRE_MORE_DATA + evidencia pareada (McNemar, IC, generalización). |
| ¿Dónde vive PromotionDecision? | Dos capas distintas y correctas: el veredicto estadístico de V3.5 (`decidePromotion`, z no pareado) y el de V4.1 (`decideGovernance`, McNemar pareado). El Executor consume el de V4.1. |
| ¿Dónde viven Gates / Risk? | `rollout/pipeline/gates.ts` y `rollout/pipeline/risk.ts` (V4.0), expuestos por `RolloutEngine.gatesReport()` / `.risk()`. |
| ¿Cómo se calcula McNemar? | `governance/pipeline/paired-comparison.ts` (V4.1). **El Executor no lo recalcula — lo cita.** |
| ¿Dónde vive Shadow Rollout? | `RolloutEngine.status()` (V4.0). |
| **¿Duplicación?** | **Ninguna, y ninguna introducida.** El Executor no tiene una sola constante estadística propia: importa los umbrales de sus dueños (`HEALTH_MAX_UNDO_RATE`, `MIN_PAIRED_SCANS`, `MAX_LATENCY_MULTIPLE`…) y los **cita** en las condiciones del plan. Si un dueño cambia un umbral, el plan lo refleja sin editarse. |

---

## 3. Arquitectura

```
   RolloutEngine (V4.0)            GovernanceEngine (V4.1)
   .risk() .gatesReport()         .recommend()
   .health() .status()                 │
        │                              │
        └──────────────┬───────────────┘
                       ▼
        PromotionExecutorEngine (orquesta; read-only; sin estadística)
                       ▼
        buildPromotionPlan()  ← PURO: consume veredictos, cita umbrales,
                                 arma escalera + checklists + rollback.
                                 Recalcula NADA.
                       ▼
        PromotionExecutionPlan (versionado, determinista, auditable)
                       ▼
   GET /vision/promotion-plan · /promotion/{checklist,readiness,execution,rollback}
                       ▼
   mobile /admin-promotion (flag operador, render puro)
```

### 3.1 Consumidor puro — cómo se garantiza

- **Cero estadística propia.** El plan no tiene tests, ni z, ni IC computados aquí: `statisticalEvidence` es `GovernanceRecommendation.evidence` citado verbatim; `estimatedRisk` es `RiskAssessment` resumido; `confidence` es una **etiqueta** sobre el ancho del IC (ALTA/MEDIA/BAJA) — no un recálculo de la posición, que `action`/`significant` ya codificaron.
- **`readiness` se deriva de los dueños, no se re-juzga.** READY exige las tres: Governance dijo PROMOTE, ninguna puerta bloqueante (`PROVIDER_READY`, `ROLLBACK_REQUIRED`) en FAIL, y riesgo global ≠ HIGH. Cualquier otra cosa es BLOCKED, y **cada razón de bloqueo se cita del dueño que la produjo**.
- **`generatedAt` es un INPUT, no una lectura de reloj.** El único no-determinismo se empuja al borde, así que el builder es una función pura: mismos veredictos + mismo timestamp → plan byte-idéntico, para siempre.

### 3.2 La distinción determinismo que reveló el smoke

El *builder puro* es byte-idéntico (probado). El *engine* deriva su ventana de evaluación de `new Date()` en cada llamada — dos llamadas con milisegundos de diferencia ven ventanas casi idénticas pero no byte-idénticas. La ventana es un reloj, igual que `generatedAt`. El engine es determinista en su **contenido derivado**; los dos inputs de reloj (ventana + timestamp) están fuera de esa garantía por diseño, y el smoke lo afirma normalizándolos.

### 3.3 Escalera de rollout — nunca booleanos desnudos

Plantilla fija 5% → 10% → 25% → 50% → 100% (24/24/48/48/72h). Cada peldaño lleva:
- **advanceConditions** — qué debe sostenerse para subir (citan la ventaja de top-1 de Governance y los umbrales de undo/fallos/ECE de Health).
- **stopConditions** — qué pausa aquí (sin revertir): pérdida de significancia, disponibilidad <95%, latencia/coste >1.5×.
- **rollbackConditions** — qué revierte al instante: undo sobre umbral, fallos sobre umbral, ECE deshonesto, incidente de seguridad.

### 3.4 Checklists tipados

Seis categorías (TECHNICAL, OPERATIONAL, STATISTICAL, PRODUCT, OBSERVABILITY, SAFETY), tres listas (validación, monitoreo, aprobación). Cada ítem: `status` + `explanation` + `severity` + `owner` (rol, no persona — portable entre equipos). El status refleja los veredictos vivos: undo bajo umbral → PASS, undo alto → FAIL; scans pareados suficientes → PASS, insuficientes → FAIL.

---

## 4. Archivos

**Nuevos (backend):** `promotion/types/promotion-plan-contract.ts`, `promotion/pipeline/promotion-plan.ts`, `promotion/promotion-executor.engine.ts`, `promotion/promotion.controller.ts`, `scripts/smoke-promotion.ts`.
**Modificados (backend):** `vision.module.ts` (registro), `package.json` (+`smoke:promotion`).
**Mobile:** `src/api/rollout.ts` (+`promotionPlan`), `app/admin-promotion.tsx` (nuevo, render puro).
**Cero migraciones. Cero tablas. Cero cambios** a Planner, Coach, Meal Planner, Coaching Context, Weekly Review, Ledger, Rollup, Recommendation, Vision Providers, Barcode, OCR, Restaurant, Portion, Learning, Governance, Rollout ni Promotion Engine. Solo se registró el nuevo consumidor.

---

## 5. Read-only — cómo se garantiza

El engine no tiene una sola llamada de escritura, ni referencia a config mutable, ni a flags, ni a proveedores. Los endpoints son todos GET. El smoke lo **prueba**: una construcción completa del plan (governance + rollout + ensamblaje) cambia **cero filas**. El plan es un documento; el `executionSteps` lo describe pero la plataforma no ejecuta ninguno.

---

## 6. Verificación

| Check | Resultado |
|---|---|
| `smoke:promotion` (nuevo) | ✅ **36/36** |
| Readiness derivada (PROMOTE+gates+riesgo; bloqueos citados de los dueños) | ✅ los 6 caminos (READY, HOLD, gate FAIL ×2, riesgo HIGH, sin candidato) |
| Consumidor puro (evidencia/riesgo citados, confianza es etiqueta) | ✅ |
| Escalera 5/10/25/50/100 con condiciones explicadas, duración 216h | ✅ |
| Checklists: 6 categorías, status/explicación/severidad/owner | ✅ reaccionan a health en vivo (undo alto → FAIL) |
| Pasos de ejecución y rollback (ordenados, con owner, descriptivos) | ✅ |
| Determinismo + idempotencia | ✅ builder byte-idéntico; engine determinista en contenido derivado |
| Read-only | ✅ construcción completa = 0 filas |
| Regresión (14 suites: vision 310, learning 117, rollout 58, governance 70, + 9 de Fase 1–2) | ✅ todo verde |
| Backend build + tsc, mobile tsc | ✅ limpios |

---

## 7. Definition of done

- [x] Auditoría realizada · [x] Arquitectura documentada · [x] Contratos versionados
- [x] PromotionExecutor implementado · [x] PromotionExecutionPlan implementado
- [x] Endpoints GET · [x] Mobile Admin (render puro, flag)
- [x] smoke:promotion verde · [x] Regresión completa verde · [x] Builds limpios
- [x] Sin romper contratos · [x] Sin modificar producción
- [x] Sin commit · [x] Sin push · [x] Sin merge

**Estado: WAIT.** Nada commiteado, nada pusheado, ninguna migración (no hay ninguna en este slice).
