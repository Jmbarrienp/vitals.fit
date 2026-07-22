# Nutrition Copilot Runtime — V5.0

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones**

---

## 1. Qué es (y qué no es)

El runtime que coordina todos los motores inteligentes construidos en Fases 1–4 para producir **una sesión coherente** — un **contrato**, no texto. NO es un chatbot, NO toma decisiones nutricionales, NO recalcula, NO reinterpreta. Cada afirmación inteligente de una sesión la produjo el motor que la dueña; el Copilot decide únicamente **coordinación**: quién habla primero, quién tiene prioridad, quién calla, y qué mensaje sería redundante.

---

## 2. Auditoría

| Hallazgo | Consecuencia de diseño |
|---|---|
| **`CoachingContext` (2C.0) ya ES el contrato de inteligencia model-agnostic** — compone user/targets/today/state/history/review/commitments, versionado, sin Prisma, sin userId. | El Copilot lo consume con UNA llamada; re-componer sus piezas habría sido la duplicación clásica. La mayor parte del "runtime" ya estaba construida en 2C. |
| `WeeklyCoachService.getWeeklyCoaching` **llama al LLM** cuando hay key (con degradación determinista). | Decisión de coordinación: la sesión consume `buildDeterministicCoach(ctx)` — el builder PURO exportado que ambas variantes comparten. Cero costo LLM, cero queries extra (reusa el ctx ya cargado), determinismo garantizado. La versión refraseada sigue viva en su propio endpoint. |
| `AdaptivePlannerService.getPlan` / `MealPlannerService.getMealPlan` producen contratos versionados propios (`NutritionPlan`, `MealPlan`). | Consumidos verbatim; sus versiones quedan fijadas en `session.meta.consumes` (procedencia). |
| `RecommendationsService.getActive` devuelve **filas Prisma**. | Anti-corrupción en la frontera del runtime: proyección a vocabulario del contrato; nada con forma de Prisma sobrevive. |
| Responsabilidades mezcladas / coordinación faltante | Ninguna mezcla detectada. Lo que FALTABA era exactamente esto: nadie decidía prioridad entre coach/nudges/planner/comidas — cada pantalla mostraba su motor. El Copilot es esa coordinación, por composición. |

## 3. Arquitectura

```
 CoachingContextService ──build(full)──┐        (1 fetch, compartido)
 AdaptivePlannerService ──getPlan──────┤
 MealPlannerService ──getMealPlan──────┼──► NutritionCopilotRuntime (SIN Prisma)
 RecommendationsService ──getActive────┤        │ proyección anti-corrupción
 buildDeterministicCoach(ctx) [puro]───┘        ▼
                                composeSession() [PURO]
                    focus ladder · prioridad · silencio · redundancia
                                        ▼
                        CopilotSession (contrato versionado)
                                        ▼
              GET /copilot/session · /copilot/next-action
                                        ▼
              mobile /copilot (flag EXPO_PUBLIC_COPILOT_ENABLED, render puro)
```

### 3.1 La escalera de foco (primera coincidencia gana, cada peldaño explicado)

1. **LOGGING** — sin comidas hoy y ≤2/7 días: toda la inteligencia corre sobre datos registrados; un circuito roto supera todo.
2. **COMMITMENT** — la palabra del usuario va antes que un consejo nuevo.
3. **ISSUE** — un problema persistente (follow-up) supera a un plan nuevo.
4. **ADJUSTMENT** — el planner decidió un cambio (`EVOLVING` o ajuste numérico).
5. **MAINTAIN** — todo verde: proteger la racha.

### 3.2 Prioridad de la próxima acción

`COMMITMENT > nudge activo de mayor prioridad > coach determinista > headline del planner` — una sola acción, con el porqué del coordinador. Los nudges extra se retienen ("una acción a la vez"), registrado.

### 3.3 Silencio y redundancia — auditables

`silenced[]` registra cada módulo callado y por qué: el Meal Planner calla cuando el foco es LOGGING (sugerir comidas a quien no registra es ruido); Vision habla solo como *affordance* de registro y calla cuando el registro fluye; el coach calla si su próxima acción repite la elegida ("una sola voz por problema"). Silenciar también es una decisión — y queda en el contrato.

### 3.4 Preguntas, no adivinanzas

`pendingQuestions` sale solo de vacíos de datos reales (sin peso → preguntar). `confidence` es una etiqueta sobre conteo de evidencia (semanas + días registrados), no una probabilidad.

## 4. Archivos

**Nuevos (backend):** `copilot/types/copilot-contract.ts`, `copilot/pipeline/session-composer.ts`, `copilot/copilot.runtime.ts`, `copilot/copilot.controller.ts`, `copilot/copilot.module.ts`, `scripts/smoke-copilot.ts`.
**Modificados:** `app.module.ts` (+CopilotModule), `package.json` (+`smoke:copilot`).
**Mobile:** `app/copilot.tsx` (nuevo, render puro), `src/api/copilot.ts`, `features.ts` (+flag), `.env.example`.
**Cero migraciones. Cero cambios a ningún motor existente** — quitar `CopilotModule` elimina la coordinación y nada más (la prueba de que no absorbió ninguna responsabilidad).

## 5. Verificación

| Check | Resultado |
|---|---|
| `smoke:copilot` (nuevo) | ✅ **30/30** — verde a la primera |
| Escalera de foco (los 5 peldaños) + prioridad de acción (4 fuentes) | ✅ |
| Silencio con razón + redundancia (dedupe coach/nudge) + composición pura | ✅ |
| Determinismo (puro y contra el grafo real, timestamp fijado) | ✅ byte-idéntico |
| El runtime no añade escrituras (cachés de motores pre-calentadas, luego 0 filas) | ✅ probado |
| Regresión: **17 suites** (copilot 30, canary 34, rollback 33, promotion 36, governance 70, rollout 58, learning 117, vision 310, + 9 de Fase 1–2) | ✅ todo verde |
| Backend build + tsc, mobile tsc | ✅ limpios |

**Estado: WAIT.** Sin commit, sin push, sin merge, sin migraciones.
