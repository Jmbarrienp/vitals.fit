# Nutrition Vision V0 — Skeleton (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A–2D stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**
Design reference: `docs/nutrition-vision-architecture.md`.

The first implementation slice of Nutrition Vision. **Invisible to users** — no camera, no vendor call, no
mobile change. It builds the skeleton the architecture doc specified: contracts, the provider port + a
deterministic fixture provider, the pure pipeline stages, and the scan lifecycle that converges on the
platform's existing single write path.

## What this slice proves
The central architectural claim — *"Vision is another producer that converges on `LogsService.logMeal`,
so the existing platform needs zero changes"* — is now verified end-to-end, not just designed:
`smoke:vision`'s integration section runs a full scan → confirm → `LoggedMeal`, asserts `meal.logged`
actually fires, and confirms every existing consumer (rollup markStale, ledger, etc.) reacts exactly as
it does for manual logging, because it's the identical code path.

## What was built
- **Schema (additive only)**: `VisionScan` + `VisionFeedback` tables; `LoggedMeal` gains `source` (String,
  default `'manual'`) + nullable `visionScanId`. No existing column altered. All vocabularies are Strings
  + TS unions, never Postgres enums — the 2B.1 lesson applied deliberately (a new enum value is a breaking
  read for an older deployed Prisma Client; a String default never is).
- **`types/vision-contract.ts`**: the stable boundary (`RecognitionResult`, `Detection` with
  `boundingBox`/multi-food from day one, `FoodCandidate`, `PortionEstimate`, `CandidateConfidence`,
  `VisionScanProposal`, `ScanConfirmation`). No `@prisma/client` import. Versioned (`VISION_CONTRACT_VERSION`).
- **`providers/vision-provider.port.ts`** + **`fixture.provider.ts`** + **`provider.registry.ts`**: the
  `VisionProvider` interface with capability flags; a deterministic, zero-cost fixture (canned detections
  selected by an `imageRef` keyword — same `imageRef` always yields the same result) that ships BEFORE any
  vendor key exists, mirroring the coach's `hasKey=false` discipline. The registry selects by
  `VISION_PROVIDER` config, exactly like `CLAUDE_MODEL`.
- **Pure pipeline** (`pipeline/`): `matching.ts` (label → catalog via `FoodService.search`, reused
  verbatim — no parallel search logic), `portion.ts` (strategy chain: PROVIDER_ESTIMATE →
  SERVING_DEFAULT → fallback, always records its method), `confidence.ts` (three independent signals ×
  combined, deterministic band thresholds), `build-candidates.ts` (pure composition of the three, unit-
  tested for determinism and schema-leak-freedom).
- **`vision-scan.service.ts`**: the lifecycle orchestrator. `createScan` (CREATED→PROCESSING→PROPOSED,
  with a 10s provider timeout mirroring `AnthropicService`, degrading to FAILED + `fallback.reason` on any
  error). `confirmScan` hands off to `LogsService.logMeal` — the platform's one write path — then stamps
  `source`/`visionScanId` provenance on the resulting row and captures one `VisionFeedback` row per item
  (ACCEPTED/SWAPPED/EDITED_PORTION/ADDED_MANUAL, diffed against the original proposal). `rejectScan` and a
  lazy `sweepExpired` (called at the start of every read/confirm, no cron — the ledger's established
  pattern) round out the lifecycle.
- **Controller + module**: `POST /vision/scans`, `GET /vision/scans/:id`, `POST /vision/scans/:id/confirm`,
  `POST /vision/scans/:id/reject`. `VisionModule` imports ONLY `FoodModule` + `LogsModule` — the two
  sanctioned seams from the architecture doc. No other domain imports from `vision/`.

### Provider-infrastructure hardening (added per the V0 implementation brief)
- **Response validators** (`providers/response-validator.ts`): `validateRecognitionResult(raw)` — a pure,
  fail-safe gate run on EVERY provider response before it enters the pipeline. It checks the full contract
  (provider metadata, `latencyMs ≥ 0`, `detections` is an array within bounds, each detection's
  `label`/`labelConfidence∈[0,1]`/optional boundingBox/portionHint/attributes). Wired into `createScan`:
  an invalid result is treated exactly like a provider error → scan `FAILED`. **No malformed provider
  output can reach Nutrition** — this is what keeps future adapters honest at the boundary.
- **Event definitions** (`vision.events.ts`): typed `VisionScanProposedEvent` / `ConfirmedEvent` /
  `FailedEvent` + `VISION_EVENTS` names, emitted by the service. Vision-internal telemetry only — nothing
  outside `vision/` subscribes, so the plug-in stays severable. The platform's `meal.logged` is still
  emitted solely by `LogsService`; Vision adds no new platform-facing emitter.
- **Provider evaluation harness** (`eval/vision-eval.harness.ts`): `evaluateProvider(provider, cases)` runs
  ANY `VisionProvider` through the same port and measures execution success, latency, confidence, contract
  validity, deterministic output (same `imageRef` → identical detections), and unsupported-capability
  reporting (a case may require a capability; providers lacking it report UNSUPPORTED rather than fail).
  Built now, not postponed — this is exactly how Claude/GPT/Gemini/local get compared later with zero app
  changes. The registry was refactored to accept a `providers[]` array via a module factory, making
  provider swapping a one-line addition and directly testable.

## Constraint compliance (from the architecture doc)
No vision-specific nutrition logic (macros are resolved by `LogsService`, same as manual entry) · no
nutrition logic duplicated inside vision (matching reuses `FoodService.search`, not a parallel search) ·
no vendor hardcoded outside `providers/` · `LoggedMeal` remains the sole integration point · every failure
degrades to a usable state (`fallback.reason` set, never a broken scan) · deterministic post-provider
(matching/portion/confidence/build-candidates are pure functions, unit-tested for identical-input ⇒
identical-output) · the human is the quality gate (nothing reaches `LoggedMeal` without `confirmScan`).

## Deliverables checklist (V0 implementation brief)
vision module ✓ · provider abstraction/interface ✓ · provider registry (swappable via `providers[]`) ✓ ·
capability descriptor ✓ · fixture provider ✓ · DTOs ✓ · contracts (versioned) ✓ · domain models ✓ ·
**response validators ✓** · confidence model ✓ · **event definitions ✓** · smoke tests ✓ ·
**provider evaluation harness ✓** — all 14 present.

## Verification
- `smoke:vision` **51/51**: pure stages (matching, portion's 3-strategy chain + clamping, confidence
  bands, build-candidates determinism + no schema leakage); **contract validation** (valid passes; missing
  metadata / non-array detections / out-of-range confidence rejected with specific errors); **provider
  swapping & capability** (config selects provider, default = fixture, unknown throws loud, capability
  flags); **evaluation harness** (contract-valid + deterministic across cases, latency measured, barcode
  case reports UNSUPPORTED, a second provider runs through the same harness unchanged); then the full
  integration — multi-food scan (3 detections) → catalog-matched candidates → confirm → real `LoggedMeal`
  with 3 items → `meal.logged` fired → provenance stamped → 3 `VisionFeedback` rows as ACCEPTED; **vision
  events** (proposed/confirmed/failed fire); every degradation path (zero detections, unmatched label →
  one-off item, unknown provider → FAILED not thrown, **malformed provider response → FAILED via the
  validation gate**); lazy expiry; cross-user ownership.
- No regressions: `smoke:mealplan` 24/24, `smoke:planner` 24/24, `smoke:coach` 19/19, `smoke:contract` 25/25,
  `smoke:review` 28/28, `smoke:ledger` 28/28, `smoke:state` 37/37, `smoke:rec` 43/43, `smoke:1c` 14/14.
  Backend `nest build` clean (`VisionModule` DI resolves via the registry factory). Mobile `tsc` clean
  (completely untouched — this slice touched no nutrition module: LogsService, Planner, Coach, CoachingContext,
  Meal Planner, Weekly Review and the Ledger are all unchanged; Vision only CALLS `LogsService.logMeal`).

## Deploy note
One additive migration (`20260618140000_nutrition_vision_v0` — 2 new tables + 2 nullable/defaulted columns
on `LoggedMeal`, online-safe). Pending prod batch is now **6** migrations. No mobile change — this slice is
invisible to users even after deploy (no client calls `/vision/scans` yet).

## What's next (per the roadmap)
- **V1** — Expo Go camera capture/upload (Supabase Storage) → confirmation screen → this same
  `createScan`/`confirmScan` API, feature-flagged.
- **V2** — first real provider behind `VisionProvider` (chosen by eval against the fixture's contract
  shape, not vendor loyalty); telemetry in the `AiGenerationLog` style.
- **V3+** — portion intelligence tuned by `VisionFeedback`, barcode as a second `ScanSource`, eval harness,
  auto-accept graduation — all per `docs/nutrition-vision-architecture.md` §13.
