# Nutrition Phase 2B.3 — Weekly Review + Behavior Follow-Up (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A/2B stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**

This slice **closes the behavior loop**. The platform already had current state (UserNutritionState),
history (Weekly Ledger), commitments, streaks and a recommendation lifecycle. What was missing was the
feedback loop: turning that history into longitudinal coaching. 2B.3 adds the Weekly Review + Behavior
Follow-Up engine that consumes the ledger and says *what improved, what failed, which commitments were
kept, and what to focus on next.*

## Audit findings (before code)
- The Weekly Ledger (2B.2) already stores everything a review needs per week: scores, flags, plateau,
  streaks, commitment/recommendation aggregates, `primaryIssue`, `primaryImprovement`. The review is a
  **comparison of ledger rows**, not a recomputation.
- The recommendation lifecycle (`reason`, `status`, `committedAt`/`completedAt`/`commitExpiresAt`,
  `respondedAt`) is the second history source needed to know whether an intervention was tried and worked.
- Mobile already has a clean consumption pattern (`api` + `hook` + centralized copy in `lib/intelligence.ts`
  + a `Card`). The review surface mirrors it exactly.

## Architectural decisions
1. **The Weekly Review is a PURE COMPUTED PROJECTION — never persisted.** It is fully determined by the
   immutable ledger + rec lifecycle, so persisting it would create a second longitudinal store (forbidden).
   Recomputing on read is deterministic and idempotent (verified: repeated reads are byte-identical).
2. **No autonomous writes in a GET.** The architecture diagram ends in "New Commitments", but the engine
   never silently closes recommendations or creates rows as a hidden side effect of a read. The loop closes
   when the **user commits to the surfaced `nextPriority`** via the existing commit flow (2B.1). This keeps
   the endpoint read-only, deterministic, and free of policy decisions buried in a GET.
3. **Everything is a consumer.** `WeeklyReviewService` reads the ledger (via `WeeklyLedgerService`, which
   also backfills) + the Recommendation table, and delegates ALL reasoning to a pure engine
   (`weekly-review.engine.ts`). No scores are recomputed; no raw meal row is ever read.
4. **Structured codes, not free-form strings.** `nextPriority` = `{ reason: RecommendationReason, basis }`,
   `biggestImprovement` = `WeeklyImprovement` code, issues = reason codes. The mobile copy map turns codes
   into text — one place, no scattered strings, no client-side interpretation.

## What was built (all backend logic is pure + deterministic)
### Weekly Review Engine (`weekly-review.engine.ts`)
- `compareWeeks(current, prior)` → `{ improved, worsened, stable }` over a fixed metric set with materiality
  thresholds (scores ±5, streaks/days ±1). Empty when there's no prior week.
- `commitmentOutcomesForWeek()` → which commitments were COMPLETED / EXPIRED that week (from the lifecycle).
- `buildReview()` → the `WeeklyReview` DTO: headline scores, improved/worsened/stable, biggestOpportunity
  (`primaryIssue`), biggestImprovement (`primaryImprovement`), commitment outcomes, nextPriority.

### Behavior Follow-Up Engine
- `deriveIssueSet(entry)` → the structured issue codes present in a ledger week (behaviorFlags via
  `FLAG_TO_REASON` + plateau + low-adherence). No raw logs.
- `buildFollowUp(entries, recs)` → classifies each issue across the timeline: **resolved** (present last
  week, gone now), **persisting**, **emerged**; correlates each with the rec lifecycle → `intervention`
  = INTERVENED / IGNORED / NONE; counts `successfulInterventions` (resolved + intervened) and
  `repeatedFailures` (persisting + intervened).
- `pickNextPriority(followUp)` → one structured priority: persistent-intervened → *different intervention*;
  persistent-ignored → *address it*; new issue; else resolved → *acknowledge + maintain*; else maintain.

### Retention Instrumentation (`computeRetention`)
- recommendationCompletionRate, commitmentAcceptanceRate, commitmentCompletionRate, weeklyConsistency,
  improvementVelocity, interventionSuccessRate — all from ledger + lifecycle. **Product intelligence only;
  it does NOT feed recommendation generation** (per the constraint).

### Endpoint + mobile
- `GET /nutrition-state/weekly-review` → `{ hasReview, current, previous, followUp, retention, nextPriorities }`.
  Controller delegates to the service; no calculation in the controller.
- Mobile: `api/weeklyReview.ts` + `useWeeklyReview` + copy additions (`metricLabel`, `improvementLabel`,
  `basisCopy`) + `WeeklyReviewCard` (scores, ▲/▼ moved-metrics, improvement acknowledgement, commitment
  outcomes, resolved-issue callout, next-priority). Wired into the Consejos tab above the live summary.

## Constraint compliance
- No duplicate business logic (review reuses ledger values + `FLAG_TO_REASON`; scores never recomputed).
- No raw logs read anywhere in the review path (mobile or backend).
- Ledger never mutated; `UserNutritionState` remains the present; the review is a read-only view of history.
- No scores computed in the frontend; no second longitudinal state created.

## Verification
- `smoke:review` **28/28**: user with a resolved issue + successful intervention (resolved+INTERVENED,
  successfulInterventions=1, nextPriority RESOLVED_NEXT, commitment COMPLETED outcome, retention rates);
  user with a persisting issue + committed-but-failing intervention (repeatedFailures=1, nextPriority
  PERSISTENT_INTERVENED); empty case (no completed week → hasReview false, no crash); determinism
  (repeated read byte-identical).
- No regressions: `smoke:state` 37/37, `smoke:rec` 43/43, `smoke:1c` 14/14, `smoke:ledger` 28/28.
  Backend `nest build` clean (new provider resolves). Mobile `tsc` clean.

## Deploy note
**No migration** — 2B.3 is pure computation over existing tables. The pending prod batch is unchanged
(5 migrations from earlier slices). The endpoint ships with the same backend deploy; the mobile card
reaches the user on the next Metro reload.

## Deliberately deferred
- Autonomous recommendation lifecycle writes (auto-close resolved recs, auto-generate the next
  recommendation) — a policy decision that shouldn't live in a GET; the loop already closes via the user
  committing to `nextPriority`.
- Retention metrics influencing recommendations (explicitly out of scope this slice).
- Claude Coach over the review — the structured `ReviewSnapshot` is the seam it will consume.
