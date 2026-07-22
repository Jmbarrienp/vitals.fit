# Nutrition Copilot V5.1 — Unified Daily Experience

**Fecha:** 2026-07-16 · **Rama:** `feature/nutrition-state-2a2` · **Estado:** implementado y verificado — **WAIT: sin commit, sin push, sin migraciones**

---

## 1. Qué es

La experiencia diaria unificada. El usuario abre la app y ve **un solo copiloto**: un foco, por qué, qué hacer, qué comer, su compromiso, cómo va. No percibe que detrás hay diez motores.

Este slice **no crea inteligencia**. Toda ya existe. Es una **proyección de presentación** del artefacto de coordinación que V5.0 produce.

---

## 2. Auditoría

| Componente | Hallazgo | Reutilización |
|---|---|---|
| **Copilot Runtime V5.0** | `CopilotSession` ya contiene **los siete entregables**: currentFocus (ya exactamente UNO), reason, nextAction, mealSuggestions, activeCommitments, recentProgress, visionSuggestions. | **Total.** V5.1 solo lo reproyecta. Cero llamadas nuevas a motores. |
| CoachingContext / Review / Ledger / Planner / Meal Planner / Coach / Commitments / Vision | Consumidos **transitivamente** vía V5.0. V5.1 no los toca. | Total, indirecta. |
| Mobile: Dashboard, "Consejos" (recommendations), Progress | Aquí vivía la fragmentación: cada pantalla mostraba **su** motor. El usuario tenía que integrar mentalmente. | La pantalla Daily Copilot unifica sin borrar las existentes (borrarlas sería rediseño y riesgo; quedan como vistas de detalle). |
| `silenced[]` de V5.0 | La auditoría de coordinación ya registra *por qué* un módulo calló. | Reutilizado como **la nota** cuando una sección viene vacía — en vez de inventar una explicación. |

**Duplicaciones detectadas: ninguna.** La proyección no recalcula score, adherencia, planner, coach, review, ledger ni rachas.

---

## 3. Decisiones arquitectónicas

1. **Dos contratos, dos audiencias, una verdad.** `CopilotSession` (V5.0) es el artefacto de **coordinación** — rico, auditable, con procedencia y `silenced[]`. `DailyCopilotSession` (V5.1) es el artefacto **diario** — exactamente lo que una persona necesita hoy. El primero sigue vivo en `/copilot/session` para operadores; el segundo es lo que abre la app.

2. **El copy vive en el backend.** La pantalla debe ser render puro sin lógica — por tanto **no puede ser** el lugar que decide qué significa una tendencia en español. Una proyección, un vocabulario, todos los clientes. El screen imprime `progress.headline`; no tiene tabla de copy ni condicionales de negocio.

3. **Un foco, nunca dos.** `currentFocus` de V5.0 ya es exactamente uno; la proyección lo titula, no lo re-decide. El contrato lo expresa como un **objeto**, no una lista — la forma del tipo hace imposible devolver dos.

4. **Deduplicación explícita.** `todaysPlan.actions` lleva la acción prioritaria en posición 1 y añade pasos concretos (compromiso, registro) **solo si no repiten** el texto ya presente (normalizado). Un compromiso idéntico a la prioridad no se muestra dos veces.

5. **Extensión, no modificación.** `runtime.daily()` se añade; `session()` queda intacta. Ningún motor existente cambió una línea.

---

## 4. Implementación

```
CopilotSession (V5.0, coordinación)
        │
        ▼  projectDailySession()  [PURO: selecciona, ordena, deduplica, etiqueta]
DailyCopilotSession (V5.1, 7 secciones)
        │
        ▼  GET /copilot/daily
mobile/daily-copilot.tsx  [render puro: imprime strings, cero lógica]
```

**Las siete secciones:** `focus` (área + título + why) · `todaysPlan.actions` (prioridad primero) · `meals` (+ nota auditada si vacío) · `commitments` · `progress` (headline + métricas pre-formateadas) · `visionCta` (solo si reduce fricción) · `confidence`.

---

## 5. Archivos

**Nuevos (backend):** `copilot/types/daily-copilot-contract.ts`, `copilot/pipeline/daily-projection.ts`, `scripts/smoke-dailycopilot.ts`.
**Modificados (backend):** `copilot.runtime.ts` (+`daily()`), `copilot.controller.ts` (+`GET /copilot/daily`), `package.json`.
**Mobile:** `app/daily-copilot.tsx` (nuevo), `src/api/copilot.ts` (+`daily`).
**Cero migraciones. Cero tablas. Cero cambios** a Planner, Weekly Coach, Meal Planner, Review, Ledger, Vision, Recommendations, Commitments ni CoachingContext.

---

## 6. Riesgos encontrados

| Riesgo | Mitigación |
|---|---|
| El copy en backend podría "decidir" negocio por la puerta trasera | Los mapas de copy son `Record<estado, string>` puros sobre enums que otro motor ya decidió; ninguna rama evalúa datos nutricionales |
| Una tendencia futura sin copy quedaría sin etiqueta | Degradación segura a `'Tu progreso'`, verificada en smoke con un valor inventado |
| Adherencia nula mostrada como 0% (falso "vas mal") | `'sin datos'` explícito, verificado |
| Duplicación entre secciones al crecer | Dedupe por texto normalizado + assert dedicado en smoke |
| Dos pantallas Copilot (V5.0 y V5.1) confunden | La de V5.0 queda como vista de coordinación; la diaria es la que el flag expone al usuario |
| La proyección se desincroniza del contrato fuente | `meta.source.copilotSessionVersion` fija la procedencia |

---

## 7. Verificación

| Check | Resultado |
|---|---|
| `smoke:dailycopilot` (nuevo) | ✅ **34/34** — verde a la primera |
| Prioridad única (objeto, no lista; título por área) | ✅ |
| Ausencia de duplicación (compromiso == prioridad no se repite) | ✅ |
| Composición correcta (cada valor trazable a su dueño) | ✅ |
| Rendering puro (copy y métricas pre-formateadas en el contrato) | ✅ |
| Determinismo (puro y contra el grafo real) | ✅ byte-idéntico |
| Cero escrituras | ✅ probado |
| Integración: Runtime, Planner, Meal Planner, Commitments, Vision, Weekly Review | ✅ |
| Degradación honesta (tendencia desconocida, adherencia sin datos) | ✅ |

## 8. Resultado de todos los smokes

**18/18 suites verdes:** dailycopilot 34 · copilot 30 · canary 34 · rollback 33 · promotion 36 · governance 70 · rollout 58 · learning 117 · vision 310 · 1c · state · rec · ledger · review · contract · coach · planner · mealplan.
**Backend build limpio · backend tsc limpio · mobile tsc limpio.**

## 9. Estado del deploy

**WAIT.** Sin commit, sin push, sin merge, sin deploy, sin migraciones. La pantalla queda tras `EXPO_PUBLIC_COPILOT_ENABLED` (default `false`), así que incluso desplegada no cambia nada para el usuario hasta activarla.
