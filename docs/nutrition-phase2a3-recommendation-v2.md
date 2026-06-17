# Nutrition Phase 2A.3 — Recommendation V2 (audit report)

Branch: `feature/nutrition-state-2a2` (continues on top of slice 1 + 2A.2)
Status: implemented locally, smoke-green, **not deployed, not merged**.

## 1. Audit findings (before any code)

The brief's mental model didn't match the repo. Verified against source:

- The recommendation surface had **four** writers, and **three recomputed weight trend independently** of `computeWeightTrend()` — the rollup's single source of truth:
  1. `RecommendationsService.generate()` (HTTP `POST /recommendations/generate`) — recomputed `(last−first)/recordCount·7` (also a latent bug: divides by record *count*, not elapsed days) and **wrote rows with `type` values not in the `RecommendationType` enum** (`'SAFETY'`, `'REMINDER'`, `'BEHAVIOR'`, `'DATA_COLLECTION'`), which Prisma rejects at runtime. Orphaned — mobile never calls it.
  2. `RecommendationListener.handleMealLogged` (`meal.logged`) — already a **consumer** of `UserNutritionState`, but returned bare text and the listener hardcoded `type=BEHAVIOR_RECOMMENDATION, priority=MEDIUM`.
  3. orchestrator `RecommendationHandler` (`weight.updated`) — recomputed a 2-point rate and **cut 200 kcal on any flat trend, without checking adherence** (the exact false-positive `PLATEAU_SUSPECTED` exists to prevent).
  4. orchestrator `ProgressHandler` (`weight.updated`) — recomputes a status string into `dailyLog.notes` (side-channel, left as-is; not a user-facing recommendation).
- Mobile consumes **only** `GET /recommendations/history`. User-visible rows come from paths (2) and (3).
- The brief's `RecommendationHandler` exists, but in the **orchestrator** module, not recommendations.

## 2. What 2A.3 delivers

A single structured decision engine; every path becomes a **consumer** of it and of the rollup. No path recomputes a metric.

- **`recommendation-reason.ts`** — `RecommendationReason` (typed vocabulary: `PLATEAU_SUSPECTED`, `PROTEIN_CHRONIC_LOW`, `WEEKEND_DRIFT`, `LOSING_TOO_FAST`, …), `REASON_META` (reason → `RecommendationType` + `Priority`, one place, no scattered casts), `StructuredRecommendation`, `RecommendationInput`.
- **`recommendation-engine.ts`** — two pure entry points, both consumer-only:
  - `decideNudge(input)` → exactly **one** highest-impact nudge (plateau ▸ today-state ▸ streak ▸ habit flags ▸ STEADY floor). Messages preserved verbatim from the tuned V1 rules; only the structured reason is new.
  - `decidePlanAdjustment(input)` → a calorie-changing rec **only** when the rollup justifies it (`PLATEAU_SUSPECTED` → −200; fast loss → +100; gain stalled → +100), else `null`.
  - `stateToInput(...)` builds the input straight from the `UserNutritionState` row + today's intake.
- **`meal.logged` listener** — persists the real `reason/type/priority`; cooldown (4 h) + dedupe (24 h prefix) + push **unchanged**.
- **orchestrator `RecommendationHandler`** — now reads the rollup via `NutritionStateService.get()`; 14-day `planHistory` cooldown unchanged. Trigger string changed `'weight.updated → recommendation-engine'` → `'weight.updated'` (ASCII-safe; also now matches the mobile "Al registrar peso" label).
- **HTTP `generate()`** — reads the rollup, returns **one** highest-impact rec (plan change if warranted, else nudge), persists the reason, keeps the `respond()` → calorie-adjustment flow. The invalid-enum bug is gone.
- **`RecommendationService.generateForUser`** — returns `{ text, reason, type, priority }`; the deterministic rule is now the **fallback** when Claude is off or transiently failing (replaces the static "Sigue manteniendo tus macros" filler).

### Behavioral upgrades (not just refactor)
- A non-adherent user with a flat scale is **never** told to eat less (was: −200 kcal regardless). Verified in smoke.
- Every persisted recommendation now carries a structured `reason` — the foundation for Dashboard Intelligence / Weekly Insights / Claude Coach to query, not re-derive.
- One strong recommendation, never five.

## 3. Migration review

One migration, **additive + nullable + no default → metadata-only, online-safe** (no table rewrite, no backfill, no lock of consequence):

```sql
-- 20260617140000_recommendation_reason
ALTER TABLE "Recommendation" ADD COLUMN "reason" TEXT;
```

`reason` is a `String?` backed by the TS `RecommendationReason` enum (single writer = the engine) — deliberately **not** a Postgres enum, because the reason vocabulary grows with every new insight and an enum would force a migration per addition. Structured + queryable without that friction.

Deploy batch is now **three** unmerged additive migrations (none in prod yet):
`20260617120000_user_nutrition_state` → `20260617130000_nutrition_state_2a2` → `20260617140000_recommendation_reason`.

## 4. Verification

- `smoke:rec` **22/22** — single-output, prioritization (plateau beats protein flag), the non-adherent-no-cut guarantee, rollup-as-source-of-truth integration, reason persistence.
- `smoke:state` ✅, `smoke:1c` ✅ — no regression.
- `tsc --noEmit` exit 0; `nest build` exit 0 (full module graph compiles, incl. `NutritionStateModule` now imported by `OrchestratorModule`).

## 5. Not in scope (left honest)
- `ProgressHandler`'s `notes` side-channel still recomputes a status string; it's not a user-facing recommendation, so it's out of the recommendation-surface cleanup. Flagged for a later pass if `dailyLog.notes` becomes load-bearing.
- No Claude reasoning layer (still deferred). The structured reason is the seam it will plug into.
- Mobile UI unchanged (history already renders `messageForUser` + priority dot; `reason` is available for a future surface).

## 6. Deploy steps (require explicit authorization — touches prod)
```
cd app/backend
npm run migrate:status     # gate
npm run migrate:deploy     # applies the 3 pending additive migrations
npm run migrate:status     # verify 6 total applied
# then merge feature branch → main → Render redeploys → validate /recommendations + history
```
