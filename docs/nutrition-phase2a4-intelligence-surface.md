# Nutrition Phase 2A.4 — Intelligence Surface (audit report)

Branch: `feature/nutrition-state-2a2` (continues on 2A.3)
Status: implemented locally, smoke-green, TS clean (backend + mobile). **Not deployed, not merged.**

## Goal
Make the already-computed longitudinal intelligence **visible** in the product. No new AI, no new model, no client-side recomputation. The brain already exists deterministically in `UserNutritionState`; this phase lets the user see it.

## Audit findings (before code)
- `UserNutritionState` was **not exposed to mobile** — `NutritionStateService` had no controller; the dashboard pulled only `streak` from `/users/me`.
- Mobile `Recommendation` type lacked `reason` (added to the backend `getHistory` select in 2A.3 but never surfaced).
- The brief's illustrative enum names (`LOGGING_INCONSISTENT`) differ from the real backend enums (`LOW_LOGGING_CONSISTENCY`, `LOW_ADHERENCE_WEEK`, …). Mapped the **actual** enums.

## What was built

### Backend (one read-only endpoint, no recompute, no migration)
- `IntelligenceSnapshot` DTO (`nutrition-state/types/intelligence-snapshot.ts`): scores, trendStatus, plateauStatus, behaviorFlags, weekly aggregates, topRecommendation.
- `NutritionStateService.getIntelligenceSnapshot(userId)` — composes `get(userId)` (lazy-fresh rollup = single source of truth) + the latest pending `Recommendation`. **Pure projection** — copies fields, computes nothing.
- `GET /nutrition-state/intelligence` (`NutritionStateController`, `JwtAuthGuard`), wired into `NutritionStateModule`.
- **No schema change, no migration** — reads existing columns.

### Mobile (render-only, one centralized copy map)
- `src/lib/intelligence.ts` — the **single, deterministic** place enums become copy/theming: `BEHAVIOR_FLAG_COPY`, `PLATEAU_COPY`, `TREND_COPY`, `reasonLabel()`, `scoreBand()`. No flag/score/trend is reinterpreted or recomputed; it's only labeled.
- `api/intelligence.ts` + `useIntelligence()` hook (`['intelligence']` query).
- **Dashboard Intelligence Card** (`IntelligenceCard`): adherence + nutrition score meters, goal-aware trend chip, plateau chip, highest-impact issue (the engine's top recommendation). Gated so brand-new users with no signal don't see an empty block.
- **Habit Detection UI** (`HabitFlags`): renders typed `behaviorFlags` as labeled cards; renders nothing when empty.
- **Weekly Summary** (`WeeklySummaryCard`, on the Consejos tab): estado (trend), registro (days logged + 7d/30d kcal), principal (plateau or top habit), qué hacer ahora (top rec). Every judgment comes from the backend; the client only selects which backend value to show.
- **Recommendation explanation**: each rec in the history list shows its structured `reason` translated via `reasonLabel()`.
- Cache invalidation: `['intelligence']` invalidated on meal log (`useLogMeal`) and weight log (progress), matching the backend stale→recompute flow.

## Single-source-of-truth compliance
- Zero client-side computation of trends, scores, or plateau. The mobile only maps enums to strings/colors and displays numbers.
- The snapshot is a read-only projection; the rollup remains the only writer of the intelligence.
- One reason→copy map, centralized; no free-form strings as source of truth.
- No existing recommendation infrastructure touched (cooldown/dedupe/push/persistence/handlers untouched).

## Verification
- Backend: `tsc` exit 0, `nest build` exit 0 (new controller resolves in DI), `smoke:rec` **33/33** (incl. 7 new snapshot assertions: scores present, plateau mirrors rollup, weekly.daysLogged7d, topRecommendation reason, ISO computedAt, null-when-no-rec), `smoke:state` ✅, `smoke:1c` ✅.
- Mobile: `tsc --noEmit` exit 0.

## Deploy note
No new migration in 2A.4. The pending prod batch is unchanged from 2A.3 — three additive migrations (`user_nutrition_state`, `nutrition_state_2a2`, `recommendation_reason`). The new endpoint ships with the same backend deploy. Mobile is Expo Go (no EAS) — the new screens reach the user on next Metro reload.
