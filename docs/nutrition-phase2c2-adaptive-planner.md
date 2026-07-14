# Nutrition Phase 2C.2 — Adaptive Nutrition Planner (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A/2B/2C stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**

This slice turns Vitals Fit from an app that *explains the past* into a platform that *plans the
future*. The planner is the strategic brain: given the deterministic CoachingContext, it decides whether
the nutrition strategy should stay stable or evolve — and the platform, not AI, makes that decision.

## Audit findings (before code)
- The CoachingContext (2C.0) already composes everything the planner needs: current rollup state, ledger
  history weeks (with per-week trend/plateau/adherence/protein/commitments), the review's follow-up
  (resolved/persisting/emerged + intervention status), and active commitments. **The planner consumes the
  contract directly** — the same deterministic snapshot that feeds the coach. No new data access.
- The recommendation engine's `decidePlanAdjustment` already makes REACTIVE, single-event plan hints on
  `weight.updated` (plateau→-200, fast-loss→+100, gain-stalled→+100). The planner is DIFFERENT: it is
  LONGITUDINAL (requires a sustained plateau across ledger weeks, not one flat reading). They are
  complementary — the reactive nudge vs the strategic review — and the planner reuses the same magnitudes
  by design. This slice does not touch the reactive path (extend, don't redesign); a future slice may
  route it through the planner.

## Architecture
```
UserNutritionState + WeeklyLedger + Review + Commitments
        ↓  (already composed by)
CoachingContext.build(userId, 'full')
        ↓
decidePlan(ctx)   ← PURE, deterministic strategic brain
        ↓
NutritionPlan (posture + per-dimension decisions + evidence + review windows)
```
The planner is its own bounded module (`planner/`), imports ONLY NutritionStateModule (the contract
source), and has **no AI dependency** — AI is optional and only communicates decisions.

## Design decisions
1. **Deterministic, longitudinal decisions.** `decidePlan(ctx)` is a pure function of the contract. It
   never reacts to one day: a calorie change requires a sustained stall (`stalledStreak ≥ 2`, HIGH
   confidence at ≥3) computed by *counting consecutive ledger weeks* whose stored trend/plateau say "not
   progressing" — consumption, not recomputation.
2. **Per-dimension decisions + one headline.** The planner evaluates CALORIES, PROTEIN, INTERVENTION and a
   DATA gate, each producing a `PlanDecision` (code, dimension, confidence, deterministic explanation,
   structured evidence, numeric adjustment, review window). The `headline` is the single most important;
   `posture` ∈ STABLE / EVOLVING / ADHERENCE_FIRST / INSUFFICIENT_DATA.
3. **Reuses platform truth for the adherence gate.** A real plateau cut fires only when the rollup already
   says `PLATEAU_SUSPECTED` (which itself encodes high adherence) AND the ledger confirms the stall is
   sustained. A sustained stall with low adherence → **KEEP_PLAN / ADHERENCE_FIRST** ("fix consistency
   before cutting"), exactly the brief's guard against cutting calories for a non-adherent user.
4. **Structured, model-agnostic output.** Every vocabulary is pinned in `types/nutrition-plan.ts` (no
   @prisma imports). Decisions + evidence are codes with deterministic explanations; a coach may rephrase,
   never override. The plan is versioned (`PLANNER_VERSION`) and carries `weeksAnalyzed` + `contractVersion`.
5. **Read-only; the platform stays the source of truth.** `GET /planner/plan` returns the plan; the planner
   decides what the plan *should* be but does not mutate the Goal — applying a decision stays with the
   existing confirmation flow. No hidden writes in a GET.

## Decision coverage (each with confidence, evidence, review window, adjustment)
- **KEEP_PLAN** — on track, or a deliberate adherence-first hold during a stall.
- **REDUCE_CALORIES** — sustained plateau (lose) + high adherence (−200 kcal, 14-day window).
- **INCREASE_CALORIES** — losing too fast (protect muscle) or gain stalled + adherent (+100).
- **REDUCE_CALORIES (gain)** — gaining too fast (−150, leaner bulk).
- **INCREASE_PROTEIN** — complements a deficit-deepening calorie cut when protein has room (+15g).
- **REDUCE_PROTEIN** — adherent user whose protein target is chronically unreachable for ≥3 weeks (−15g).
- **MAINTAIN_PROTEIN** — default; the target is correct.
- **REPLACE_INTERVENTION** — a committed intervention still failing ≥2 weeks (the approach doesn't work).
- **CONTINUE_INTERVENTION** — an open issue that needs more time.
- **WAIT_FOR_MORE_DATA** — < 2 completed weeks, or too few weight points to move calories.

## Constraint compliance
No raw logs read · no rollup/review/recommendation-engine logic duplicated (all signals CONSUMED from the
contract) · no planner logic in mobile · no Prisma entities exposed · no Claude-specific planning (zero AI
dependency) · no hidden business rules (every decision has structured evidence) · deterministic (identical
context → identical plan, verified).

## Verification
- `smoke:planner` **24/24**: data gate → WAIT; plateau+high-adherence → REDUCE_CALORIES (HIGH, −200,
  14d, EVOLVING); sustained stall+low-adherence → KEEP/ADHERENCE_FIRST; fast-loss → INCREASE; on-track →
  KEEP/STABLE; too-few-weight-points → WAIT/INSUFFICIENT_DATA; gain-stall → INCREASE; calorie cut →
  INCREASE_PROTEIN complement (headline stays the cut); protein unreachable → REDUCE_PROTEIN; committed
  intervention still failing → REPLACE_INTERVENTION; determinism; and a real-contract integration build.
- No regressions: `smoke:coach` 19/19, `smoke:contract`, `smoke:review` 28/28, `smoke:ledger` 28/28,
  `smoke:state` 37/37, `smoke:rec` 43/43, `smoke:1c` 14/14. Backend `nest build` clean (PlannerModule DI
  resolves). Mobile `tsc` clean (untouched — no planner logic in mobile, per the anti-goal).

## Deploy note
No migration — pure computation over existing tables/contract. Pending prod batch unchanged (5 migrations).
`GET /planner/plan` ships with the backend deploy.

## What plugs in next (future consumers of the plan)
- The Weekly Coach communicates the plan's headline (deterministic decision → AI rephrase).
- Applying a decision (mutating Goal targets) through the existing confirmation flow.
- Push notifications, meal planning, grocery/recipe suggestions, and a future workout planner all consume
  the same structured `NutritionPlan` — model-agnostic, no schema knowledge required.
