# Nutrition Phase 2 — `UserNutritionState` (Longitudinal Keystone)

**Status:** Design — not implemented. **Author context:** 2026-06-16, post Phase 1 close.

## 1. Qué es y por qué es el keystone

`UserNutritionState` es una tabla **1:1 por usuario** que cachea el estado nutricional agregado y longitudinal del usuario. Convierte eventos aislados (`meal.logged`, `weight.updated`) en **comprensión de comportamiento** persistida.

**Insight central (no es un sistema nuevo):** el backend ya calcula este estado de forma efímera en
[`context-builder.service.ts`](../app/backend/src/recommendations/services/context-builder.service.ts)
en **cada** recomendación: `adherencePct7d`, `streak`, `last7Logs`, `recentWeights`. `UserNutritionState` es esa misma idea, pero:

- **persistida** (no recomputada en cada request),
- **extendida** a ventanas 7d/30d + tendencia + flags,
- **reutilizable** por el rules engine *hoy* y por Claude *mañana*.

> **Claude sin `UserNutritionState` = autocomplete caro sobre logs crudos.** Esta tabla es el contrato de entrada compacto que hace a Claude barato y específico.

## 2. Lo que ya existe y se reutiliza (no reinventar)

| Primitiva | Dónde vive hoy | Uso en el rollup |
|---|---|---|
| Regresión de peso (slope, `weeklyRate`, trend) | `progress.service.ts:78` | `weightTrendKgWk`, `trendStatus` |
| Adherencia por día | `DailyLog.adherencePct`, `planFollowed` | agregados 7d/30d |
| Streak | `UserHabits.currentStreak` | `loggingStreak` |
| Snapshot 7d efímero | `context-builder.service.ts` | se promueve a estado cacheado |
| Timezone del usuario | `UserProfile.timezone` | límites de día + horarios |
| Macros por día (fuente de verdad) | `recalcDailyLog(tx)` | base de `avgCalories*` |
| Telemetría IA | `AiGenerationLog` | medir costo de la capa Claude |

## 3. Modelo Prisma (aditivo, expand-contract)

```prisma
model UserNutritionState {
  id     String @id @default(uuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  // ── Control de frescura (lazy recompute, sin worker) ──
  computedAt DateTime @default(now())
  stale      Boolean  @default(true) // listeners lo marcan; el reader recomputa
  version    Int      @default(1)    // subir al cambiar la lógica → fuerza recompute

  // ── Snapshot de meta (denormalizado: evita re-query) ──
  goalType       String?
  calorieTarget  Int?
  proteinTargetG Int?

  // ── Ingesta (ventanas) ──
  avgCalories7d      Float?
  avgCalories30d     Float?
  avgProtein7d       Float?
  calorieAdherence7d Float? // 0..1 días dentro de banda del target
  proteinAdherence7d Float? // 0..1 días que cumplen proteína

  // ── Comportamiento / consistencia ──
  loggingStreak  Int   @default(0)
  daysLogged7d   Int   @default(0)
  daysLogged30d  Int   @default(0)
  avgMealsPerDay Float?
  weekdayLogRate Float? // consistencia L-V
  weekendLogRate Float? // detectar weekend drift

  // ── Trayectoria de peso (reusa progress.service) ──
  currentWeightKg  Float?
  weightTrendKgWk  Float?
  weightDataPoints Int    @default(0)
  trendStatus      String? // on_track | stalled | regressing | insufficient_data

  // ── Derivados deterministas (baratos) ──
  flags          String[] // ["protein_chronic_low","weekend_drift","streak_at_risk","plateau"]
  nutritionScore Int?      // 0..100 compuesto, opcional

  @@index([stale])
}
```
Y en `User`: `nutritionState UserNutritionState?`. Todos los campos nullable → usuarios nuevos = `insufficient_data` sin romper consumidores.

## 4. Servicio de rollup (determinista, $0 API)

`UserNutritionStateService.recompute(userId, tx)`:
1. Carga: `Goal` activa, `DailyLog`+items últimos 30d, `WeightLog`, `UserHabits`, `UserProfile.timezone`.
2. Computa agregados puros (promedios, adherencia por banda, ratios L-V/fin de semana, streak).
3. Trend de peso: **llama la misma regresión** de `progress.service` (extraerla a un helper compartido `computeWeightTrend(weights)`).
4. Deriva `flags` con umbrales deterministas (ej. `proteinAdherence7d < 0.5 → "protein_chronic_low"`).
5. `upsert` del estado con `computedAt = now()`, `stale = false`, `version = CURRENT`.

Es **pura y idempotente**: misma entrada → misma salida. Sin IA. Sin efectos colaterales más allá del upsert.

## 5. Enganche en el flujo de eventos + patrón lazy (Render Free)

Render Free **duerme el servicio** → no hay cron/worker confiable. Por eso: **marcar stale en escritura, recomputar en lectura.**

- **`meal.logged` listener** → `UPDATE ... SET stale = true` (una fila, barato). **No recomputa síncrono.**
- **`weight.updated`** → igual, `stale = true`.
- **Read path** (`get(userId)`): recomputa si `state == null` **OR** `stale` **OR** `computedAt < now - TTL` **OR** `version != CURRENT`; si no, sirve cache.

Esto da frescura sin background jobs y encaja con la arquitectura event-driven actual. El `cooldown 4h` + `dedupe 24h` existentes siguen siendo el rate-limit natural de la capa de recomendaciones encima.

## 6. Contrato para Claude (capa semanal, NO por evento)

`UserNutritionState.toClaudeSummary()` serializa ~300–500 tokens. Claude recibe **esto**, nunca logs crudos:

```json
{
  "goal": "LOSE_FAT",
  "target": { "kcal": 1900, "protein_g": 150 },
  "last7d": { "avg_kcal": 2180, "kcal_adherence": 0.43, "protein": "chronic_low", "days_logged": 4 },
  "last30d": { "avg_kcal": 2050, "days_logged": 18 },
  "weight": { "trend_kg_wk": -0.05, "status": "stalled", "points": 6 },
  "behavior": { "streak": 3, "weekend_drift": true },
  "flags": ["protein_chronic_low", "weekend_drift", "plateau"]
}
```
Claude solo se invoca en el **ciclo semanal** (o cuando `flags` cruzan un umbral), sobre este resumen cacheado. Cada llamada se registra en `AiGenerationLog` para medir costo real.

## 7. Migración y rollout

- **Aditivo** (expand-contract, igual que 1C): nueva tabla, cero cambios destructivos. Patrón de deploy: migración manual a prod **antes** del merge (Render Free, sin Pre-Deploy).
- **Backfill lazy, no batch:** la fila se crea en el primer `get(userId)` (`stale=true → recompute`). Cero job de backfill masivo → ideal para Render Free.
- **`version`** permite evolucionar la lógica del rollup **sin** migración: subir `CURRENT_VERSION` invalida todos los estados en la siguiente lectura.

## 8. Fronteras (qué NO es)

- **No reemplaza** a `progress-analyst` ni `recommendation-engine`. Es el **sustrato determinista** que ellos **leen** en vez de re-consultar logs crudos.
- **No guarda salida de IA.** Nada de mensajes generados ni diagnósticos de Claude en esta tabla — solo agregados deterministas.
- **No es god-table:** solo entran agregados que **≥2 consumidores** necesitan. Si lo usa uno solo, va en su servicio.

## 9. Riesgos y edge cases

| Riesgo | Mitigación |
|---|---|
| Timezone (límites de día / horarios) | usar `UserProfile.timezone` en todos los cortes; `DailyLog.date` debe ser consistente con esa tz |
| Datos escasos (usuario nuevo) | todo nullable; `trendStatus="insufficient_data"`; consumidores manejan null |
| Carrera de recompute (2 lecturas a la vez) | `upsert` idempotente, last-write-wins es seguro (misma entrada → mismo resultado) |
| Costo de recompute en lectura | TTL (6–12h) + flag `stale` evita recomputar en cada request; ventana acotada a 30d |
| Regresión de peso necesita N puntos | espejar el gate existente (≥7) de progress-analyst |

## 10. Primer slice implementable (el más pequeño)

1. Migración: tabla `UserNutritionState` + relación en `User`.
2. `UserNutritionStateService` con `recompute()` que **solo** promueve lo que `context-builder` ya calcula (adherencia 7d, streak, trend) → cachea. **Sin** Claude, **sin** flags nuevos.
3. `meal.logged`/`weight.updated` → `stale = true`.
4. Apuntar `context-builder` a leer de `UserNutritionState` (con fallback a recompute). **Misma salida, menos queries.**
5. Smoke test (patrón `smoke-1c.ts`): stale→recompute, agregados correctos, idempotencia.

Eso entrega valor inmediato (menos queries, estado cacheado) **sin** tocar IA. Las ventanas 30d, flags, score y la capa Claude vienen después, encima de una base ya probada.
