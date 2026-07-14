# Nutrition Phase 2D.1 — Adaptive Meal Planning Engine (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A/2B/2C stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**

The first EXECUTION layer: Vitals Fit stops only *explaining* nutrition and starts *planning what the user
actually eats*. The planner decides strategy; the meal planner turns that strategy into a concrete day of
meals built from the user's OWN food repertoire.

## Audit findings (before code)
- The Adaptive Planner (2C.2) already emits structured decisions with numeric adjustments
  (`newCalorieTarget`, `newProteinTarget`). The meal planner EXECUTES those — it never re-derives strategy.
- The Food Catalog exposes exactly what's needed via `FoodService`: `getFavorites`, `getFrequent`,
  `getRecent`, `getCommon`, and (added this slice) `getCustom`. `getFrequent`/`getRecent` aggregate logs
  *inside the service* — the sanctioned indirection; the meal planner never touches `LoggedMealItem`.
- `CoachingContext` already carries `targets` (current goal), `behaviorFlags`, `nutritionScore`, and the
  user goal — so the meal planner reads its signals from the same contract, not the schema. No Goal query.

## Architecture
```
CoachingContext.build(userId,'full')  ← ONE build
        ↓                     ↘
   decidePlan(ctx)         behaviorFlags / nutritionScore / goal targets
   (planner strategy)
        ↓
FoodService (fav/frequent/recent/custom/common) → priority-ranked candidate pool
        ↓
buildMealPlan(...)   ← PURE deterministic composition
        ↓
MealPlan DTO → GET /meal-plan → Mobile (MealPlanCard, pure render)
```
The meal planner is its own bounded module (`meal-planner/`), imports NutritionStateModule + FoodModule,
reuses the planner's pure `decidePlan` (single context build), and has **no AI dependency**.

## Design decisions
1. **Executes the planner's strategy, never invents it.** Effective targets = the planner's adjusted
   calorie/protein targets when it proposed a change (`targets.source = 'planner-adjusted'`), else the
   current goal. Carbs/fat are split from the remaining energy by the goal's carb:fat ratio. The planner
   stays the only strategy maker; the meal planner is a consumer.
2. **Deterministic composition, no randomness.** For each meal the engine picks a protein anchor (highest
   *priority* protein-dense food), then a carb/energy source, then a filler — each chosen from a pool
   sorted by `(priorityRank, macro key, name, id)`, so identical inputs always yield identical meals.
   Portions are computed to hit the meal's protein/energy split and rounded to 10g.
3. **Adherence over perfection.** The pool ranks the user's OWN foods first (favorite > frequent > recent
   > custom > catalog); `coverage.fromUserFoods` reports how much of the plan the user already eats. The
   engine prefers foods the user succeeds with over theoretical macro perfection.
4. **Behaviour-driven adaptations (from the planner + flags, never recomputed):**
   - `PROTEIN_CHRONIC_LOW` / `INCREASE_PROTEIN` → **PROTEIN_TO_BREAKFAST** (breakfast protein share boosted).
   - `ADHERENCE_FIRST` / low-consistency / weekend-drift / low nutrition score → **SIMPLER_STRUCTURE**
     (≤2 items per meal, 3 meals) — "reduce complexity before optimizing macros".
   - `REDUCE_CALORIES` → **LIGHTER_MEALS** (lower per-meal energy) + the adjusted lower targets.
   - muscle gain (not simplified) → **EXTRA_SNACK** (4 meals to fit the surplus).
5. **Structured, model-agnostic output.** `types/meal-plan.ts` imports nothing from @prisma. The DTO carries
   targets, meals (slot/items/portions/source tags), totals, adaptations, confidence, a deterministic
   rationale (drivers + summary a coach MAY rephrase), coverage, and the planner's review window — the
   foundation future consumers (grocery lists, recipe recs, AI substitutions, CV corrections) build on.
6. **Read-only.** `GET /meal-plan` proposes; it does not persist to the MealPlan tables or mutate the Goal.

## Constraint compliance
No random meals (deterministic pool + greedy composition) · no duplicated planner logic (reuses
`decidePlan`) · no duplicated scoring/behaviour analysis (consumes flags/scores from the contract) · no raw
meal logs read (frequent/recent via FoodService aggregation) · no meal intelligence in mobile (the card is
pure render) · no Claude-specific planning (zero AI dependency) · reuses the existing Food Catalog · no
schema leakage (pinned vocab, no ids/log keys in the payload).

## Verification
- `smoke:mealplan` **24/24**: structure (3 meals, protein anchor per meal, totals near target, variety);
  executes planner-adjusted calories (1800) with LIGHTER_MEALS + inherited 14-day review; adaptations
  (PROTEIN_TO_BREAKFAST shifts protein to breakfast, ADHERENCE_FIRST → ≤2 items, gain → EXTRA_SNACK/4
  meals); food reuse (favorite anchor, coverage); determinism; no userId/raw-log leakage; and a
  real-service integration (context + planner + catalog → favorited food used).
- No regressions: `smoke:planner`, `smoke:coach` 19/19, `smoke:contract`, `smoke:review` 28/28,
  `smoke:ledger` 28/28, `smoke:state` 37/37, `smoke:rec` 43/43, `smoke:1c` 14/14. Backend `nest build`
  clean (MealPlannerModule DI resolves). Mobile `tsc` clean.

## Deploy note
No migration — pure computation over the contract + existing Food Catalog. Pending prod batch unchanged
(5 migrations). `GET /meal-plan` + the mobile card ship with the backend/Metro deploy.

## What plugs in next
- Grocery lists (aggregate the plan's items), recipe recommendations, AI food substitutions, restaurant
  suggestions, CV portion corrections — all consume the same structured `MealPlan`.
- The Weekly Coach could communicate the plan's rationale (deterministic → AI rephrase).
- Optional: persist an accepted plan to the MealPlan tables through a confirmation flow.
