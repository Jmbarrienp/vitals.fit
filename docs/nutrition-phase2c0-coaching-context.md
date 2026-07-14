# Nutrition Phase 2C.0 — CoachingContext: the model-agnostic intelligence contract (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A/2B stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**

North star honored: the objective was NOT to integrate Claude — it was to build the contract any LLM
(Claude, GPT, Gemini, local) consumes without knowing the database schema. Success = decoupling.

## Audit findings (before code)
- `toClaudeSummary` (named in the Phase 2 design) **was never implemented** — 2C.0 builds it properly.
- The de-facto contract was `UserSnapshot` + `ContextBuilderService`: coupled (imports Prisma enums,
  prompt-builder knows its shape) and **blind to everything built in 2B** — no ledger history, no review,
  no follow-up, no commitments. Used ONLY by the daily-nudge Claude path → safe to retire outright.
- `AnthropicService` is already a clean model adapter (`systemPrompt + userPrompt → text + usage`,
  timeout, retry, prompt caching). That seam stays; it is exactly where a GPT/Gemini adapter would plug in.

## The architecture

```
Platform (model-agnostic)                          Model adapters
NutritionState / Ledger / Review / Commitments  │
        ↓                                       │
CoachingContextService.build(userId, depth)     │
        ↓                                       │
CoachingContext v1 (versioned contract)         │
        ↓                                       │
renderCoachingContext(ctx) → canonical text ────┼→ AnthropicService (Claude)
                                                │   (tomorrow: GPT/Gemini/local)
```

Swapping models = writing a new adapter. Zero business logic moves.

## Contract design decisions
1. **Anti-corruption boundary.** `types/coaching-context.ts` imports NOTHING from `@prisma/client`.
   The stable vocabularies (goal/persona/sex/trend/plateau/flags/basis) are **pinned as explicit unions
   in the contract itself** — a schema change can never silently change what models see. The builder is
   the single place internal enums are mapped in (`GOAL_MAP`, `FLAG_MAP`, … — exhaustive `Record`s, so
   a new enum value forces an explicit decision at compile time). Growable code vocabularies
   (RecommendationReason, WeeklyImprovement) travel as documented strings, matching their design.
2. **Versioned + self-describing.** `meta = { contract: 'vitals-fit.coaching-context', version: 1,
   depth, generatedAt, locale }`. Consumers pin the version; evolution is explicit.
3. **Zero schema leakage.** No `userId`, no UUIDs, no DB ids, no raw meal logs (today's ≤3 meals are
   today-state, not history), no table-shaped keys. Verified by smoke assertions on the serialized payload.
4. **Retention excluded.** 2B.3's constraint — retention metrics are product instrumentation and must not
   influence coaching — is enforced structurally: the contract has no retention section (smoke-asserted).
5. **Deterministic.** Same DB state → identical contract (only the informational `generatedAt` varies;
   smoke compares two builds with it neutralized). No relative dates anywhere — absolute ISO only.
6. **`depth: 'today' | 'full'`.** The high-frequency daily nudge consumes `'today'` (no ledger/review
   fetch per meal log); the future weekly coach and the endpoint consume `'full'` (8 ledger weeks +
   review + follow-up). One contract, sections empty/null by depth — consumers need no branching.
7. **Canonical renderer.** `renderCoachingContext(ctx)` — a PURE function of the contract (no clock;
   `generatedAt` deliberately not rendered) producing the text block any chat LLM receives. Codes are
   rendered verbatim so models get the structured vocabulary. Rendering is platform-side; `ai/` keeps
   only the task instructions (system prompt) and the Claude client.

## What changed
- **New:** `types/coaching-context.ts` (contract, v1), `coaching-context.service.ts` (composer over
  rollup + ledger + review + commitments; computes no metric), `coaching-context.render.ts` (canonical
  renderer), `GET /nutrition-state/coaching-context` (read-only inspection + future consumers).
- **Refactored:** `PromptBuilderService` now = system prompt + delegate-to-renderer (data selection left
  the AI module); `RecommendationService.generateForUser` consumes the contract at depth `'today'`
  (`contextToInput()` is the one narrow typed bridge back into the deterministic engine); telemetry's
  compact snapshot now records `contractVersion`.
- **Retired:** `ContextBuilderService` + `UserSnapshot` (the parallel, coupled snapshot). One contract, no duplicates.
- **No migration. No mobile changes.** Deterministic nudge behavior preserved (same engine, same inputs).

## Verification
- `smoke:contract` **25/25**: shape + pinned version, neutral vocabulary mapping, history/review/commitments
  composition, **decoupling** (no UUIDs, no userId, no retention, no raw-log keys, payload 2,082 B < 8 KB),
  **determinism** (two builds identical modulo generatedAt), **depth gating**, **renderer purity**
  (deterministic, clock-free, all sections, codes verbatim, 1,112 chars < 4,000), engine bridge decides.
- No regressions: `smoke:rec` 43/43, `smoke:state` 37/37, `smoke:ledger` 28/28, `smoke:review` 28/28,
  `smoke:1c` 14/14. Backend `nest build` clean (DI resolves after retiring ContextBuilderService).
  Mobile `tsc` clean (untouched).

## Deploy note
No migration — the pending prod batch is unchanged (5 migrations from earlier slices). The endpoint and
refactor ship with the same backend deploy. Claude remains OFF (no API key) — the deterministic engine
keeps serving nudges; when the key lands, Claude starts receiving the full contract with zero code change.

## What plugs in next (2C.1+)
- **Weekly Claude Coach**: `build(userId, 'full')` → `renderCoachingContext` → adapter. The seam is live.
- A second model adapter (GPT/Gemini/local) implementing the same `complete(req)` shape.
- Contract v2 evolution (e.g., per-week goal reconstruction from PlanHistory) via an explicit version bump.
