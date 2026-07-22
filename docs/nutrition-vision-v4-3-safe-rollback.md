# Nutrition Vision V4.3 — Safe Rollback Engine

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones**

---

## 1. Qué es este slice

El espejo de V4.2. Donde el Promotion Executor convierte un veredicto estadístico en un plan de promoción, el Rollback Engine decide **cuándo un rollout debe revertirse, por qué y cómo** — produciendo un `RollbackExecutionPlan` determinista y auditable. No ejecuta rollback, no escribe configuración, no toca flags. Construye un documento; un humano lo lee y actúa.

---

## 2. Auditoría

| Pregunta | Hallazgo |
|---|---|
| ¿Cómo se decide "hay que revertir" hoy? | **Ya existe:** la puerta `ROLLBACK_REQUIRED` (V4.0, gates.ts) FAILea cuando `isHealthGreen` no está verde o los falsos positivos superan `GATE_MAX_FALSE_POSITIVES`. **El Rollback Engine la consume como trigger — no la re-deriva.** |
| ¿Deriva de proveedor? | Governance (V4.1) ya la detecta (`incumbentDrift: DRIFTING`) y recomienda `DEMOTE`. Consumido, no recalculado. |
| ¿Duplicación con V4.2? | `promotion-plan.ts` tiene `rollbackConditions/rollbackSteps` — pero son plantillas *hacia adelante* ("si promueves, así revertirías"). V4.3 evalúa el estado **vivo**. Los umbrales que ambos citan (`HEALTH_MAX_UNDO_RATE`, `HEALTH_MAX_ECE`…) viven en un solo lugar (health.ts) e importados por ambos — **cero duplicación de lógica o constantes**. |
| ¿Riesgo / gates / health / trust? | Todos de sus dueños existentes vía `RolloutEngine`. `isHealthGreen` reutilizado para el detalle de degradación. |
| **Límite de conocibilidad honesto** | La plataforma **no persiste historial de promociones**. Un rollback de proveedor no conoce el proveedor previo desde el estado vivo. Se declara (readiness BLOCKED, `blockingReasons` lo explica), no se fabrica — misma disciplina que el `IMAGE_QUALITY_BAND` no disponible de V4.1. |

---

## 3. Arquitectura

```
   RolloutEngine (V4.0)        GovernanceEngine (V4.1)     PromotionExecutor (V4.2)
   .risk() .gatesReport()      .recommend()                .plan()
   .health() .status()         (drift, DEMOTE)             (readiness → retry)
        │                            │                          │
        └──────────────┬─────────────┴──────────────────────────┘
                       ▼
        RollbackEngine (orquesta; read-only; sin estadística)
                       ▼
        buildRollbackPlan()  ← PURO: consume el trigger ROLLBACK_REQUIRED,
                               elige la palanca segura, cita umbrales.
                               Recalcula NADA.
                       ▼
        RollbackExecutionPlan (versionado, determinista, auditable)
                       ▼
   GET /vision/rollback · /rollback/{readiness,checklist,monitoring,summary}
                       ▼
   mobile /admin-rollback (flag operador, render puro)
```

### 3.1 La regla de palanca segura

La plataforma tiene dos palancas autónomas que degradan la experiencia del usuario, y exactamente una es recuperable del estado vivo:

- **`DISABLE_AUTO_ACCEPT`** — mientras auto-accept está encendido, la contención más rápida y **determinista** para *cualquier* degradación es apagar el comportamiento autónomo (`AUTO_ACCEPT_ENABLED=false`, el default de fábrica). No requiere historial y siempre está disponible → **readiness REQUIRED**.
- **`RESTORE_PROVIDER`** — solo cuando auto-accept ya está apagado y el proveedor mismo se degrada. El objetivo (proveedor previo) no es derivable → **readiness BLOCKED**, el operador confirma el último bueno conocido (piso seguro: `fixture`).
- **`NONE`** — nada se degrada.

Esto es honesto y determinista: la palanca que la plataforma *siempre* puede accionar sola es apagar auto-accept; el rollback de proveedor, que necesita historial que no persistimos, se bloquea explícitamente en vez de adivinar.

### 3.2 Severidad, prioridad, confianza — derivadas, no inventadas

- **Severity:** CRITICAL si riesgo HIGH o (gate FAIL + falsos positivos); HIGH si gate FAIL; MEDIUM si solo deriva; NONE si nada.
- **Priority:** IMMEDIATE / SCHEDULED / MONITOR / NONE, mapeadas 1:1 desde la severidad.
- **Confidence:** una etiqueta sobre el **conteo de ejes independientes** que coinciden (salud/gate, deriva, riesgo). El smoke destapó un doble-conteo real — la puerta FAILea *porque* la salud se degrada, así que gate y health-degradada son **el mismo eje**, no dos; contarlos ambos inflaba la certeza. Corregido: tres ejes independientes máximo.

### 3.3 El plan explica todo, nunca un boolean

`rollbackReason` (por qué), `rollbackPriority` (cuándo), `rollbackTarget` (qué restaurar), `monitoringPlan` (cómo monitorear la recuperación), `postRollbackChecklist` "estado estable" (cuándo es estable), `retryConditions` (qué permite reintentar promoción — reutiliza la readiness del Promotion Executor, sin criterios nuevos). Más `communicationPlan` escalado por severidad y `estimatedImpact`.

### 3.4 Determinismo

`generatedAt` es un **input**, no una lectura de reloj → el builder es puro (mismo estado + mismo timestamp = plan byte-idéntico). El engine deriva su ventana de `new Date()`; esa ventana es un reloj igual que `generatedAt`, y el smoke afirma el determinismo del contenido derivado normalizándola.

---

## 4. Archivos

**Nuevos (backend):** `rollback/types/rollback-contract.ts`, `rollback/pipeline/rollback-plan.ts`, `rollback/rollback.engine.ts`, `rollback/rollback.controller.ts`, `scripts/smoke-rollback.ts`.
**Modificados (backend):** `vision.module.ts` (registro), `package.json` (+`smoke:rollback`).
**Mobile:** `src/api/rollout.ts` (+`rollbackPlan`), `app/admin-rollback.tsx` (nuevo, render puro).
**Cero migraciones. Cero tablas. Cero cambios** a Planner, Coach, Meal Planner, Coaching Context, Ledger, Review, Rollup, Recommendation, Vision Providers, Barcode, OCR, Restaurant, Portion, Learning, Governance, Promotion Executor ni Rollout. Solo se registró el nuevo consumidor.

---

## 5. Read-only — cómo se garantiza

El engine no tiene una sola llamada de escritura, ni referencia a config mutable, flags ni proveedores. Los endpoints son todos GET. El smoke lo **prueba**: construir el plan completo (governance + rollout + promotion + ensamblaje) cambia **cero filas**. `rollbackSteps` describe la reversión pero la plataforma no ejecuta ninguno.

---

## 6. Verificación

| Check | Resultado |
|---|---|
| `smoke:rollback` (nuevo) | ✅ **33/33** |
| Rollback por cada causa | ✅ health/undo (gate), falsos positivos (CRITICAL), deriva de proveedor, riesgo HIGH |
| Regla de palanca segura | ✅ auto-accept on → DISABLE_AUTO_ACCEPT (REQUIRED); off + deriva → RESTORE_PROVIDER (BLOCKED) |
| Rollback bloqueado | ✅ deriva de proveedor sin historial persistido → BLOCKED con la razón nombrada |
| Rollback innecesario | ✅ salud verde → NOT_REQUIRED, target NONE |
| Consumidor puro | ✅ trigger = gate verbatim; métricas con umbrales de sus dueños; retry reutiliza V4.2 |
| Confianza = ejes independientes | ✅ doble-conteo gate/health corregido |
| Checklists (6 categorías, status/explicación/severidad/owner) | ✅ |
| Determinismo + idempotencia + read-only | ✅ plan byte-idéntico; 0 filas cambiadas |
| Regresión (15 suites: vision 310, learning 117, rollout 58, governance 70, promotion 36, + 9 de Fase 1–2) | ✅ todo verde |
| Backend build + tsc, mobile tsc | ✅ limpios |

---

## 7. Definition of done

- [x] Auditoría realizada · [x] Arquitectura documentada · [x] Contratos versionados
- [x] RollbackEngine implementado · [x] RollbackExecutionPlan implementado
- [x] Endpoints GET · [x] Mobile Admin (render puro, flag)
- [x] smoke:rollback verde · [x] Regresión completa verde · [x] Builds limpios
- [x] Sin romper contratos · [x] Sin migraciones · [x] Sin commit/push/merge

**Estado: WAIT.** Nada commiteado, nada pusheado, ninguna migración (no hay ninguna en este slice).
