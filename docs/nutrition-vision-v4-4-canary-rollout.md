# Nutrition Vision V4.4 — Progressive Canary Rollout Automation

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones**

---

## 1. Qué es este slice

El motor que determina **cómo debería progresar un rollout canario** — de manera determinista, segura y auditable. Dada la posición actual de un rollout, recomienda el próximo movimiento (avanzar, permanecer, mantener, pausar, revertir, completar) y lo explica. No mueve tráfico, no escribe flags, no promueve nada. "Automatización" aquí significa que la **lógica de progresión** es determinista y verificable por máquina — no que la máquina actúe. Un humano lee la recomendación y mueve el rollout.

---

## 2. Auditoría

| Pregunta | Hallazgo |
|---|---|
| ¿La escalera de rollout ya existe? | **Sí.** `PromotionExecutionPlan.rolloutStrategy` (V4.2) es la escalera 5/10/25/50/100 con duración y condiciones (advance/stop/rollback) por peldaño. **V4.4 la consume verbatim — no la reconstruye.** |
| ¿La señal de aborto ya existe? | **Sí.** `RollbackExecutionPlan.readiness/rollbackPriority` (V4.3). V4.4 la consume como su señal de degradación — **no re-chequea salud, ni gates, ni riesgo.** |
| ¿Duplicación? | **Ninguna, y ninguna introducida.** El Canary Engine no tiene ni una constante, ni un umbral, ni un test estadístico. Consume los dos planes (que ya consumieron a los dueños de V4.0/V4.1) y decide un movimiento. Es la capa más delgada de toda la cadena de gobernanza. |
| **Límite de conocibilidad honesto** | La plataforma **no persiste estado vivo de canario** (sin tabla de rollout-state; este slice no añade migración). La posición actual es un **input del operador** (`atPercent`); el motor aconseja el próximo movimiento desde ella. Misma disciplina que V4.1 (image-quality) y V4.3 (historial de proveedor). |

---

## 3. Arquitectura

```
   PromotionExecutor (V4.2)          RollbackEngine (V4.3)
   .plan() → rolloutStrategy         .plan() → readiness, priority
             (la escalera)                     (la señal de aborto)
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
        CanaryEngine (orquesta; read-only; sin lógica propia de métrica)
                       ▼         + atPercent (posición del operador)
        decideCanary()  ← PURO: una decisión sobre los dos veredictos
        buildCanaryPlan()  consumidos + la posición. Recalcula NADA.
                       ▼
        CanaryRolloutPlan (versionado, determinista, auditable)
                       ▼
   GET /vision/canary · /canary/{readiness,stages,checklist,timeline}
                       ▼
   mobile /admin-canary (flag operador, render puro, selector de posición = query)
```

### 3.1 La decisión — seis movimientos, cada uno explicado

El orden codifica prioridad: un aborto supera todo; una degradación leve supera el progreso; una promoción inviable no puede proceder; solo un estado limpio y de bajo riesgo avanza.

| Condición (toda consumida) | Recomendación |
|---|---|
| `rollback.priority` ∈ {IMMEDIATE, SCHEDULED} | **ROLLBACK** — abortar, deferir al plan de rollback |
| `rollback.readiness ≠ NOT_REQUIRED` (prioridad MONITOR) | **PAUSE** — degradación leve, contener y observar |
| `promotion.readiness ≠ READY` | **HOLD** — sin promoción viable para canario |
| posición ≥ 100% | **COMPLETE** — el canario terminó |
| riesgo global MEDIO | **STAY** — limpio pero cauteloso, seguir observando |
| todo lo demás (verde, viable, riesgo bajo) | **ADVANCE** — las señales apoyan subir |

Clave anti-duplicación: `rollback.readiness ≠ NOT_REQUIRED` **es** la señal de "una degradación disparó". El Canary Engine no re-verifica la salud — lee el veredicto que el Rollback Engine ya produjo, que es exactamente lo que evita que dos subsistemas discrepen sobre si las cosas se degradan.

### 3.2 Posicionamiento de la escalera

`atPercent` (0..100, default 0 = pre-rollout) se mapea al peldaño en que está el rollout (el más alto ≤ posición). Cada peldaño se marca PAST / CURRENT / FUTURE. Una posición fuera de peldaño (7%) se ancla al peldaño en que está (5% CURRENT, 10% siguiente). Solo el peldaño CURRENT lleva indicadores observados en vivo.

### 3.3 Nunca un enum desnudo

Cada recomendación viene con `recommendationReason`. Las tres señales (`advanceRecommendation`, `holdRecommendation`, `rollbackRecommendation`) son `{ value, explanation }`. Los checklists (monitoreo, verificación) llevan status/explicación/severidad/owner. La exposición estimada nombra el porcentaje actual y el siguiente.

### 3.4 Determinismo

`generatedAt` es un **input** → `buildCanaryPlan` es puro (misma posición + mismos planes + mismo timestamp = plan byte-idéntico). El engine deriva su ventana de `new Date()`; esa ventana es un reloj, y el smoke afirma el determinismo del contenido derivado normalizándola.

---

## 4. Archivos

**Nuevos (backend):** `canary/types/canary-contract.ts`, `canary/pipeline/canary-plan.ts`, `canary/canary.engine.ts`, `canary/canary.controller.ts`, `scripts/smoke-canary.ts`.
**Modificados (backend):** `vision.module.ts` (registro), `package.json` (+`smoke:canary`).
**Mobile:** `src/api/rollout.ts` (+`canaryPlan`), `app/admin-canary.tsx` (nuevo, render puro con selector de posición).
**Cero migraciones. Cero tablas. Cero cambios** a ningún subsistema existente — solo se registró el nuevo consumidor.

---

## 5. Read-only

El engine no tiene una sola escritura, ni referencia a config mutable, flags ni proveedores. Todos los endpoints son GET; `atPercent` es un input de consulta (qué posición evaluar), no una acción. El smoke lo **prueba**: construir el plan (promotion + rollback + ensamblaje) cambia **cero filas**.

---

## 6. Verificación

| Check | Resultado |
|---|---|
| `smoke:canary` (nuevo) | ✅ **34/34** |
| Los 6 movimientos | ✅ ADVANCE, STAY (riesgo medio), HOLD (sin promoción), PAUSE (degradación leve), ROLLBACK (IMMEDIATE/SCHEDULED), COMPLETE (100%) |
| Aborto supera todo | ✅ ROLLBACK gana incluso con promoción viable |
| Posicionamiento de escalera | ✅ pre-rollout, 10% (PAST/CURRENT/FUTURE), 7% (ancla), 100%, clamp 150% |
| Consumidor puro | ✅ la escalera es la de promoción; el aborto es el de rollback; referencias apuntan, no copian |
| Señales explicadas + exposición | ✅ nunca boolean desnudo |
| Determinismo + read-only | ✅ plan byte-idéntico; 0 filas cambiadas |
| Regresión (16 suites: vision 310, learning 117, rollout 58, governance 70, promotion 36, rollback 33, + 9 de Fase 1–2) | ✅ todo verde |
| Backend build + tsc, mobile tsc | ✅ limpios |

---

## 7. Definition of done

- [x] Auditoría · [x] Arquitectura documentada · [x] Contratos versionados
- [x] Canary Engine · [x] CanaryRolloutPlan · [x] Endpoints GET · [x] Mobile Admin (render puro, flag)
- [x] smoke:canary verde · [x] Regresión completa verde · [x] Builds limpios
- [x] Sin romper contratos · [x] Sin migraciones · [x] Sin commit/push/merge

**Estado: WAIT.** Nada commiteado, nada pusheado, ninguna migración (no hay ninguna en este slice).
