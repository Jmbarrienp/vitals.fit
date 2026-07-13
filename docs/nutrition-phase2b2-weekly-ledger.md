# Nutrition Phase 2B.2 — Weekly Behavioral Ledger (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A/2B stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**

This slice is architectural: it adds the **historical memory** the platform was missing.
`UserNutritionState` answers *"how is the user now"*; the ledger answers *"how did the user
perform in week N"* — without reading a single raw meal. It is the foundation Weekly/Monthly
Review, Claude Coach, Progress Timeline, and future ML consume instead of rebuilding history.

## Audit findings (before code)
- All the derived metrics a weekly snapshot needs (adherence/nutrition scores, flags, plateau,
  streaks, trend) already existed **inside `recompute()`, hardcoded to "now."** Re-implementing
  them per-week would have been the exact duplication the brief forbids.
- The rollup is a 1:1 *current-state* row that is overwritten each recompute — it keeps **no
  history**. Behavior Follow-Up ("protein improved vs last week") is impossible without a ledger.
- Streaks are already log-derived (2B.1); the same `streakEndingAt` generalizes to any anchor.

## Architectural decisions
1. **One derivation, two callers.** Extracted `deriveState()` (`nutrition-state/derive.ts`) — a
   pure, window-agnostic function taking an `anchor` + pre-sliced windows. `recompute()` calls it
   with anchor = now (rolling 7d/30d); the ledger calls it with anchor = week end (calendar week +
   30d context). `streakEndingAt(anchor, grace)` generalizes the streak. **The scoring math now
   lives in exactly one place.** The rollup refactor is behavior-preserving (smoke:state byte-identical).
2. **Week identity = ISO-8601 week, Monday 00:00 UTC** (`common/metrics/iso-week.ts`). Natural key
   `@@unique([userId, weekStart])` + stored `isoYear`/`isoWeek` for monthly rollups and timelines.
3. **Append-only by construction.** Only *completed* weeks (weekEnd ≤ now) are ever written; the
   in-progress week is excluded, so a row's inputs can never change after capture. Existing rows are
   never mutated (`upsert` with empty `update`). No `updatedAt` column — the absence is the contract.
4. **Deterministic reconstruction.** Each week is rebuilt from logs/weights/recommendations as-of
   week end. Re-running is a no-op (idempotent); mutating a *past* raw log does **not** rewrite an
   already-recorded week (verified in smoke).
5. **Typed columns, no JSON blob.** Every aggregate is a first-class, queryable column (analytics/ML
   friendly) + a `snapshotVersion`. Future signals arrive as additive nullable columns — the
   established pattern — not an opaque bag. `primaryIssue` = `RecommendationReason` code;
   `primaryImprovement` = growable `WeeklyImprovement` code (both structured, no free-form strings).
6. **Lazy backfill, no cron** (Render Free). On ledger read, missing completed weeks from the user's
   first-activity week (capped 52w) through last week are appended **ascending**, so each week's
   `primaryImprovement` can read the week just written. All span data is fetched once and sliced in memory.
7. **Outcome attribution (deterministic timestamps):** generated = `createdAt` in week; accepted =
   `ACCEPTED` with `respondedAt` in week; completed = `completedAt` in week; expired = `commitExpiresAt`
   in week and not completed-in-time; `completionRate` = completed / (completed + expired), null if none terminal.

## What was built
- `common/metrics/iso-week.ts` — UTC ISO-week helpers (pure).
- `nutrition-state/derive.ts` — the shared `deriveState()` + all scoring helpers (moved out of the service).
- `nutrition-state.service.recompute()` — now a thin caller of `deriveState()` (anchor = now). Unchanged output.
- `recommendations/recommendation-reason.ts` — `FLAG_TO_REASON` map + `RecommendationReasonCode` (reused by primaryIssue).
- `WeeklyNutritionSnapshot` model + additive migration `20260618130000_phase2b2_weekly_ledger` (one new table).
- `WeeklyLedgerService` — `ensureBackfilled()` (append-only lazy build) + `getHistory()` (projection).
- `GET /nutrition-state/weekly?limit=` — read endpoint (the seam Weekly Review / Claude Coach plug into).
- `scripts/smoke-ledger.ts` — dedicated smoke.

## Separation of responsibilities (constraint honored)
`UserNutritionState` = present (mutable rollup, overwritten). `WeeklyNutritionSnapshot` = history
(immutable, append-only). They **share the derivation** but store different things and never overlap.

## Known approximation
Backfilled past weeks use the goal/targets active at backfill time (the current active goal), frozen
into each row. Prospective weeks capture the goal in effect at week close. Reconstructing per-week
targets from `PlanHistory` is a future refinement; the denormalized columns make it non-breaking.

## Verification
- `smoke:ledger` **28/28**: append-only (2 completed weeks, current excluded), idempotency, immutability
  (mutating a past log appends 0 and leaves the row frozen), deterministic derivation (weekC full week →
  streaks 7/7/7, scores 100/100, on_track), partial week (streak 0, no grace), Behavior Follow-Up
  (`primaryImprovement = ADHERENCE_IMPROVED` vs prior week), commitment/rec aggregates (completed/expired/
  rate 0.5, generated 4, accepted 1), read projection newest-first.
- Regression: `smoke:state` **37/37 byte-identical** (deriveState extraction is behavior-preserving),
  `smoke:rec` 43/43, `smoke:1c` 14/14. Backend `nest build` clean (new provider resolves). Mobile `tsc` clean.

## Deploy note
One additive migration (`phase2b2_weekly_ledger`, new table only — online-safe). Pending prod batch is
now **5** migrations. Backend-only slice; mobile untouched. The `/nutrition-state/weekly` endpoint is
live plumbing for the next slice.

## Next (rest of Phase 2B)
- **2B.3** — retention instrumentation surface + mobile Weekly Review / Progress Timeline reading this ledger.
- Later — Claude Coach over the ledger's compact weekly history (the structured seam is now in place).
