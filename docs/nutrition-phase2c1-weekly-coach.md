# Nutrition Phase 2C.1 — Weekly Coach (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A/2B/2C stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**

The first production AI coach, wired as a CONSUMER of the CoachingContext contract. North star held:
the platform stays the source of truth; the coach only consumes; Claude is one swappable adapter.

## Audit findings (before code)
- CoachingContext v1 already carries everything the scope lists (current state, history weeks, trend,
  scores, plateau, flags, streaks, review with follow-up + nextPriority, active commitments,
  primaryIssue/primaryImprovement). **The contract was sufficient — no extension needed.** ("current
  recommendation reasons" = the daily-nudge concern; the weekly coach uses the review's nextPriority.)
- `AnthropicService` is a clean model adapter (`complete(system,user)→text+usage`, timeout/retry/cache).
  `PromptBuilderService` already renders the contract. `renderCoachingContext` already exists (2C.0).
- `TelemetryService` (AiGenerationLog) is reusable via a new `trigger: 'weekly-coach'`.

## Architecture

```
CoachingContext(full)
   ↓  buildDeterministicCoach()   ← platform source of truth + fallback (pure)
WeeklyCoachOutput (structure fixed, grounded)
   ↓  (if a model is configured)
renderCoachingContext + COACH_SYSTEM_PROMPT → AnthropicService → parseCoachResponse
   ↓
same 4 sections, better prose (meta.source = 'claude')   — else deterministic verbatim
```

### Design decisions
1. **Structure is deterministic and platform-owned.** Every response has four sections (summary /
   diagnosis / next_action / optional_follow_up). `buildDeterministicCoach(ctx)` — a PURE function of the
   contract — decides them, grounded in the review's `nextPriority`/`biggestOpportunity` and the ledger
   week's real numbers (e.g. "promedio 60g vs meta 150g → suma 90g al desayuno"). The model NEVER decides
   structure, diagnosis, or action; it only rephrases. `meta.grounding` records the codes the prose must
   honor, so any output is auditable against backend truth.
2. **Deterministic is the fallback.** No API key, a model timeout, or a malformed response all degrade to
   the deterministic coaching. The coach never breaks and never fabricates. (Claude is OFF in prod today,
   so the deterministic analyst ships now; when the key lands, Claude rephrases with zero code change.)
3. **Model coupling is confined** to `AnthropicService` + `weekly-coach.prompt.ts` (system prompt +
   canonical render + parser). No business logic depends on Anthropic. `COACH_PROMPT_VERSION` /
   `COACH_OUTPUT_VERSION` make prompt/format changes traceable.
4. **The coach is a consumer.** `WeeklyCoachService` reads only `CoachingContextService.build('full')` —
   never Prisma models, never raw logs, never recomputing scores/trends/streaks. New bounded `CoachModule`
   (imports AiModule + NutritionStateModule); `GET /coach/weekly` returns the structured result read-only.

## Concurrency fix (found by this slice)
`smoke:coach` exposed a **latent race introduced in 2C.0**: `CoachingContextService.build('full')` fired
`ledger.getHistory` and `review.getReviewSnapshot` (which itself calls `getHistory`) in one `Promise.all`,
so the ledger's lazy backfill ran twice concurrently and collided on the `(userId, weekStart)` unique key
(P2002) — a crash the weekly-review/coaching-context endpoints could hit in prod. Fixed at both levels:
- **Composer:** history + review are now fetched **sequentially** (review backfills once; getHistory then
  reads fresh) — the 5 unrelated reads stay parallel.
- **Ledger append:** the per-week write is now `createMany({ data, skipDuplicates: true })` — an atomic
  `INSERT ... ON CONFLICT DO NOTHING` — so any concurrent backfill of the same user is collision-proof and
  still never mutates an existing (immutable) week. `ensureBackfilled` counts + carries `prev` unchanged.

## What changed
- **New:** `coach/` module — `types/weekly-coach.ts`, `weekly-coach.builder.ts` (pure deterministic coach
  + grounded copy), `weekly-coach.prompt.ts` (versioned system prompt + canonical user prompt + tolerant
  parser), `weekly-coach.service.ts` (orchestrator), `coach.controller.ts` (`GET /coach/weekly`),
  `coach.module.ts`; registered in `AppModule`.
- **Fixed:** `coaching-context.service.ts` (sequential history/review), `weekly-ledger.service.ts`
  (atomic append). **Mobile:** `api/coach.ts` + `useWeeklyCoach` + `WeeklyCoachCard` on the Consejos tab
  (summary / diagnosis / action / acknowledgement), gated on `hasCoaching`.
- **No migration.** No schema change.

## Constraint compliance
Claude consumes CoachingContext only · no Prisma reads from the coach · no recomputation of
scores/trends/plateau/streaks · no raw meals/weights · no hidden health logic (copy is grounded in
contract codes/numbers) · never overrides backend truth (structure + grounding are platform-owned) ·
output structured + compact · model-agnostic (adapter isolated) · no second source of truth · frontend
renders, computes nothing.

## Verification
- `smoke:coach` **19/19**: deterministic structure + grounding (STEADY/RESOLVED_NEXT on a resolved week
  with improvement acknowledgement; PROTEIN_CHRONIC_LOW → protein diagnosis + specific grams/breakfast
  action), idempotency, no-review gate, service degrades to deterministic with no key, parser robustness
  (well-formed, "-" follow-up, missing-section → null, accented labels).
- No regressions: `smoke:contract`, `smoke:ledger` 28/28, `smoke:review` 28/28, `smoke:state` 37/37,
  `smoke:rec` 43/43, `smoke:1c` 14/14. Backend `nest build` clean (CoachModule DI resolves). Mobile `tsc` clean.

## Deploy note
No migration — pending prod batch unchanged (5 migrations). The endpoint + coach ship with the backend
deploy. **The concurrency fix is important to deploy** (it hardens the 2C.0 endpoints against a prod P2002).

## Next
- Turn Claude ON (set `ANTHROPIC_API_KEY`) — the coach starts rephrasing; no code change.
- A second model adapter (GPT/Gemini/local) implementing `complete(req)` — reuses the contract + renderer.
- Contract v2 (per-week goal from PlanHistory) via an explicit version bump.
