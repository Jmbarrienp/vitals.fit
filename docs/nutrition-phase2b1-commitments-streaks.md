# Nutrition Phase 2B.1 — Commitments + Streaks (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A stack)
Status: implemented locally, smoke-green, TS clean (backend + mobile). **Not deployed, not merged.**

Phase 2B = Retention & Behavior Engine. 2B.1 is the first slice: turn detection/explanation
into **accountability** (commitments) and **visible consistency** (streaks). No AI, no new
longitudinal math beyond the streaks themselves — `UserNutritionState` stays the source of truth.

## Audit findings (before code)
- **Streaks were not duplicate calculations — they were a mirror.** `UserNutritionState.loggingStreak`
  was copied from `UserHabits.currentStreak` (written event-by-event in `retention.handler` on
  `meal.logged`). The real defects: (1) the event counter **never decays on inactivity** — a user who
  logged 5 days then quit keeps a frozen "5"; (2) **two display paths** — dashboard + profile read
  `currentStreak`, while the intelligence layer carried `loggingStreak` (drift up to 12h + the freeze).
- **Lifecycle hook already existed.** `Recommendation.status` (PENDING/ACCEPTED/REJECTED/EXPIRED) +
  `respond()`. "Commit" extends this rather than a parallel entity (decision: extend the lifecycle).
- **No cron** (Render Free) — expiry must be lazy, consistent with the existing stale-flag pattern.

## What was built

### Backend
**Commitments (extend `Recommendation` lifecycle):**
- New enum states `COMMITTED`, `COMPLETED`; new nullable timestamps `committedAt`, `commitExpiresAt`,
  `completedAt`. State machine: PENDING → (commit) → COMMITTED → (complete) → COMPLETED, with a 7-day
  window; lapsed commitments are swept to EXPIRED **lazily on read** (`sweepExpiredCommitments`), no cron.
- Endpoints: `POST /recommendations/:id/commit`, `POST /recommendations/:id/complete`. Guards: only a
  PENDING rec can be committed; only a live COMMITTED rec can be completed; completing after the window
  records the truth (EXPIRED), never a fake COMPLETED. `getActive` now returns PENDING + live COMMITTED.

**Streaks (single source of truth = `recompute()`):**
- `loggingStreak` is now **derived from logs** (consecutive logged days, UTC-keyed, one-day grace so a
  not-yet-logged today doesn't break it) instead of mirroring `UserHabits.currentStreak`. Self-healing:
  a gap or a deleted log shortens it on the next recompute. `UserHabits.currentStreak` remains **only**
  the event-time trigger for milestones (STREAK_7/30) — no longer a display value.
- New derived fields `proteinStreakDays` (consecutive days within 90% of protein target) and
  `calorieStreakDays` (consecutive days within the calorie target band). Computed once in `recompute()`.
- `CURRENT_STATE_VERSION` 2 → 3 (auto-invalidates cached states). `adherenceScore` now consumes the
  log-derived streak (value shifts slightly; e.g. the state-smoke fixture 67 → 64 — more correct).

**Surface (read-only projection):**
- `IntelligenceSnapshot.weekly` gains `proteinStreakDays` + `calorieStreakDays`; `topRecommendation`
  gains `id` + `status` so the client can commit/complete it. The "what to do now" action now also
  considers a live commitment (newest PENDING or live COMMITTED). Still a pure projection.

### Mobile (render-only, no recomputation)
- `IntelligenceCard`: three streak pills (registro / proteína / calorías), gated when all are 0.
- Consejos tab: per-recommendation **"Me comprometo"** → **"Marcar como hecho"** buttons (commit only on
  non-plan-change nudges); COMMITTED/COMPLETED statuses surfaced. `useCommitment` mutations invalidate
  `['recommendations']` + `['intelligence']`.
- **Streak reconciliation**: dashboard + profile now read the current streak from the rollup
  (`intel.weekly.loggingStreak`) — one self-healing source. The dashboard's old `/users/me` habits read
  is gone. Profile keeps `longestStreak` (all-time trophy) from `UserHabits`.

## Single-source-of-truth compliance
- Streaks computed once, in `recompute()`. Mobile renders numbers; it computes none.
- Commitment lifecycle lives entirely in the backend; the client only POSTs transitions and shows status.
- No second source: the event counter is demoted to milestone-trigger duty and never displayed.

## Verification
- `smoke:rec` **43/43** (new: log-derived streaks logging/protein/calorie, full commit lifecycle —
  commit, complete, both guards, lazy expiry sweep, complete-after-window refusal, getActive scope,
  snapshot id/status). `smoke:state` **37/37** (streak fields + version 3 + adherence 64). `smoke:1c` 14/14.
- Backend `nest build` clean (no new providers — DI unchanged). Mobile `tsc --noEmit` clean.

## Deploy note
One additive migration: `20260618120000_phase2b1_commitments_streaks` (enum values + 3 commit columns +
2 streak columns — online-safe, no backfill). Pending prod batch is now **4** migrations
(`user_nutrition_state`, `nutrition_state_2a2`, `recommendation_reason`, `phase2b1_commitments_streaks`).
Mobile reaches the user on the next Metro reload (Expo Go).

## Not in 2B.1 (rest of Phase 2B)
2B.2 — weekly ledger (append-only snapshot) → Weekly Review history + Behavior Follow-Up.
2B.3 — retention instrumentation surface (completion rate reads off these commitment rows).
