# Nutrition Vision — Architecture (design document, no code in this slice)

Status: **DESIGN ONLY.** Nothing here is implemented yet. This document is the foundation the
implementation slices (roadmap at the end) will follow. The existing platform is untouched.

North star: the biggest weakness of nutrition apps is friction, not recommendation quality. Nutrition
Vision progressively eliminates manual logging: **take a picture → confirm → continue your day.**

---

## 1. Audit findings (what the design must plug into)

Verified in the repository before designing anything:

- **`LoggedMeal` has exactly ONE producer**: `LogsService.logMeal()` (`POST /logs/meal`). It resolves
  items server-side against `FoodItem`/`ServingSize` (macros are never trusted from the client when a
  catalog food is referenced), wraps writes in a transaction, recalculates `DailyLog` totals, and emits
  `meal.logged`. (`progress.handler` only upserts `DailyLog` adherence fields — it never creates meals.)
- **Everything downstream hangs off `meal.logged`**: `recommendation.listener` (nudge + push),
  `retention.handler` (milestones), `nutrition-state.listener` (markStale → rollup → ledger → review →
  planner → coach → meal planner). One event, one cascade.
- **`LoggedMealItem` is already vision-shaped**: `foodItemId?` (nullable → one-off items exist today),
  `nameSnapshot`, `quantity/unit/amountG`, server-computed macros. A confirmed vision candidate maps to
  this row with zero schema strain.
- **`FoodItem` search is recognition-ready**: normalized names, aliases, typo tolerance (Levenshtein),
  favorite boosting. Label → catalog matching can reuse it as-is.
- **The platform already has the two disciplines Vision needs**: a versioned, Prisma-free contract
  boundary (CoachingContext, 2C.0) and a provider adapter pattern (`AnthropicService.complete()`, 2C.1,
  where a model outage degrades without breaking the product).
- **Constraints that shape the design**: Render Free (no background workers → no async job queue; scan
  processing must complete within a request or degrade), Expo Go (camera via `expo-image-picker` works
  without EAS), Supabase (its Storage is the natural image store).

**The integration thesis follows directly:** Nutrition Vision is *another producer* that converges on
the existing single write path. It never writes `LoggedMeal` itself — it hands a confirmed payload to
`LogsService.logMeal()`. Every downstream system keeps working with zero changes, automatically.

```
TODAY:    Mobile manual entry ──→ POST /logs/meal ──→ LoggedMeal ──→ meal.logged ──→ platform
VISION:   Camera → vision pipeline → user CONFIRMS ──→ same endpoint/service ──→ same everything
FUTURE:   Barcode / OCR / receipt / video → same pipeline shape → same convergence point
```

---

## 2. Architectural principles

1. **Vision is a plug-in, not the platform.** A bounded `vision/` domain that could be deleted tomorrow
   without any other module noticing. Nutrition never imports from vision; vision imports only the
   sanctioned seams (`LogsService.logMeal`, `FoodService.search/favorites/recents`).
2. **Separation of knowledge.** Vision modules contain zero nutrition business logic (no macro math, no
   targets, no adherence). Nutrition modules contain zero vision logic (no confidence, no bounding
   boxes). They communicate ONLY through the versioned contracts in §4.
3. **The user is the quality gate.** No scan becomes a `LoggedMeal` without explicit confirmation. Vision
   proposes; the human disposes; the platform records. (Auto-accept is a *future* graduation gated on
   measured precision, never a launch behavior.)
4. **Provider-agnostic by contract.** Recognition is behind a `VisionProvider` port with capability
   descriptors. Claude, GPT-4V, Gemini, a self-hosted model, or a stub fixture are interchangeable
   adapters. No vendor name appears outside `vision/providers/`.
5. **Friction can only go down.** Every failure path (provider down, low confidence, nothing recognized,
   offline) degrades to today's manual flow, prefilled with whatever WAS extracted. Vision can never make
   logging harder than it is now.
6. **Determinism where possible, honesty where not.** Model output is inherently non-deterministic, so the
   boundary quarantines it: everything AFTER the provider response (matching, portion math, confidence
   aggregation, thresholds) is pure and deterministic, and every scan persists its full provenance
   (provider, model, version, raw candidates) for auditability and offline evaluation.

---

## 3. Vision domain (bounded context)

### The aggregate: `VisionScan`

One scan = one user image (or barcode/receipt later) moving through an explicit lifecycle:

```
CREATED → PROCESSING → PROPOSED → CONFIRMED → LOGGED
                │           │          └─ user edited candidates → still LOGGED (edits captured as feedback)
                │           └─ REJECTED (user discarded) / EXPIRED (never confirmed; TTL, lazy sweep)
                └─ FAILED (provider error / timeout / unusable image)
```

- `PROPOSED` holds the machine's suggestion; **only the confirmation transition** produces a
  `LoggedMeal` (via `LogsService`), stamping `loggedMealId` + `source: 'vision'` for provenance.
- `EXPIRED` uses the platform's existing lazy-sweep discipline (like commitments) — no cron.
- Every transition is recorded; the scan row is the audit trail AND the future training corpus.

### Sub-domains inside `vision/`

| Sub-domain | Responsibility | Knows about |
|---|---|---|
| `acquisition` | image intake, validation, storage refs | storage only |
| `pipeline` | orchestrates the stages below | contracts only |
| `providers` | `VisionProvider` adapters (per vendor) | vendor SDKs only |
| `matching` | provider labels → `FoodItem` candidates | `FoodService` (read-only) |
| `portion` | grams estimation strategies | contracts only |
| `confidence` | deterministic scoring + thresholds | contracts only |
| `confirmation` | human validation + handoff to `LogsService` | `LogsService` (the only write) |
| `feedback` | corrections capture (`VisionFeedback`) | own tables only |

---

## 4. Contracts & DTOs (the stable boundary)

All in `vision/types/vision-contract.ts`. Pinned vocabularies, **no `@prisma/client` imports**, versioned
(`VISION_CONTRACT_VERSION = 1`) — the same discipline as `coaching-context.ts`. Sketches:

```ts
export type ScanSource = 'PHOTO' | 'BARCODE' | 'MENU_OCR' | 'RECEIPT_OCR' | 'VIDEO_FRAME'; // growable
export type ScanStatus = 'CREATED'|'PROCESSING'|'PROPOSED'|'CONFIRMED'|'LOGGED'|'REJECTED'|'EXPIRED'|'FAILED';
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';       // derived from numeric score, one place
export type PortionMethod = 'REFERENCE_OBJECT'|'PLATE_RATIO'|'PROVIDER_ESTIMATE'|'SERVING_DEFAULT'|'USER';

/** What a provider returns. Provider-agnostic: labels + optional structure, NEVER nutrition math. */
export interface RecognitionResult {
  providerId: string; model: string; providerVersion: string;
  detections: Detection[];                 // [] = nothing recognized (a valid, handled outcome)
  latencyMs: number;
  raw?: unknown;                           // stored for audit/eval, never consumed by logic
}
export interface Detection {
  label: string;                           // provider's food label, free-form
  labelConfidence: number;                 // 0..1 as reported by the provider
  boundingBox?: { x: number; y: number; w: number; h: number }; // multi-food support from day one
  portionHint?: { grams?: number; confidence?: number };        // if the provider estimates portions
  attributes?: string[];                   // 'packaged', 'homemade', 'liquid', … growable
}

/** After catalog matching + portion estimation — what the USER sees and confirms. */
export interface FoodCandidate {
  detectionIndex: number;                  // which detection this came from (multi-food)
  foodItemId: string | null;               // catalog match, or null → will log as one-off item
  displayName: string;
  matchScore: number;                      // 0..1 deterministic (search score, favorites boost)
  portion: PortionEstimate;
  confidence: CandidateConfidence;
  alternates: { foodItemId: string; displayName: string; matchScore: number }[]; // top-N for one-tap swap
}
export interface PortionEstimate { grams: number; method: PortionMethod; confidence: number }
export interface CandidateConfidence {
  recognition: number;                     // from provider
  match: number;                           // label→catalog
  portion: number;                         // grams estimate
  overall: number;                         // deterministic combination (§6)
  band: ConfidenceBand;
}

/** The scan result exposed to mobile. No Prisma types, no vendor types. */
export interface VisionScanProposal {
  scanId: string; status: ScanStatus; source: ScanSource;
  candidates: FoodCandidate[];
  scanConfidence: { overall: number; band: ConfidenceBand };
  suggestedMealType: string;               // reuses LogsService's hour-based inference vocabulary
  fallback: { reason: string | null };     // set when degraded → mobile opens manual flow prefilled
  contractVersion: number;
}

/** What confirmation sends back. Deliberately isomorphic to LogMealDto.items — the handoff is trivial. */
export interface ScanConfirmation {
  scanId: string;
  mealType?: string;
  items: { foodItemId: string | null; customName?: string; quantity: number; unit: string;
           grams?: number; calories?: number; proteinG?: number; carbsG?: number; fatG?: number;
           acceptedFromCandidate: number | null }[];  // null = user added manually (strong feedback signal)
}
```

**The provider port** (`vision/providers/vision-provider.port.ts`):

```ts
export interface VisionProviderCapabilities {
  multiFood: boolean; portionHints: boolean; barcode: boolean; ocr: boolean; video: boolean;
}
export interface VisionProvider {
  readonly id: string;                       // 'claude' | 'openai' | 'gemini' | 'local' | 'fixture'
  readonly capabilities: VisionProviderCapabilities;
  recognize(req: { imageRef: string; source: ScanSource; hints?: RecognitionHints }): Promise<RecognitionResult>;
}
```

A `VisionProviderRegistry` selects the adapter by config (`VISION_PROVIDER=…`), exactly like
`CLAUDE_MODEL` works today. **The `fixture` adapter (deterministic canned results) ships FIRST** — it
makes the whole pipeline buildable, testable and demoable before any vendor key exists.

---

## 5. Pipeline (stage by stage)

```
1 ACQUIRE      mobile captures/picks image → uploads to object storage (Supabase Storage bucket,
               private, per-user path) → POST /vision/scans { imageRef, source } → VisionScan CREATED.
               Validation: size/format caps, ownership. No image bytes ever transit our API twice.
2 RECOGNIZE    pipeline calls VisionProviderRegistry.active().recognize() (request-scoped; hard timeout
               ~10s like AnthropicService). Detections persisted verbatim on the scan (audit).
3 MATCH        each Detection.label → FoodService.search(label, userId) — reusing normalization, typo
               tolerance, alias matching, favorite boost. Ranking augmented deterministically with the
               user's repertoire (favorites > frequent > recent — same principle as the meal planner).
               Top match + alternates become FoodCandidates. No match ⇒ candidate with foodItemId=null
               (logs as one-off item with provider label as name — today's manual path allows exactly this).
4 PORTION      PortionEstimator strategy chain (first applicable wins, method recorded):
               PROVIDER_ESTIMATE (if capability) → SERVING_DEFAULT (FoodItem's default ServingSize /
               category heuristics) → REFERENCE_OBJECT & PLATE_RATIO (future strategies, same interface).
               Output is always editable grams — the UI slider is the real portion corrector at v1.
5 CONFIDENCE   deterministic scoring (§6) → bands → UX mode. Pure function, fully unit-testable.
6 CONFIRM      user reviews candidates: swap via alternates, adjust grams, remove, add manually.
               POST /vision/scans/:id/confirm { ScanConfirmation } → handler maps items →
               LogsService.logMeal(userId, dto) — THE existing single write path. Macros are therefore
               server-resolved by the same code as manual logging. meal.logged fires as always.
7 LEARN        diff(proposal, confirmation) persisted as VisionFeedback rows (label→food corrections,
               portion deltas, rejections). This is the continuous-improvement corpus: per-provider
               precision dashboards, matching tuning, and eventual auto-accept gating — all offline.
```

---

## 6. Confidence model

Three independent, per-candidate signals — never merged upstream, so each can improve separately:

- `recognition` — provider's own label confidence (normalized 0..1).
- `match` — deterministic: search score of label→FoodItem, boosted if the match is in the user's
  favorites/frequent/recent (a user who eats it weekly is evidence).
- `portion` — per method: PROVIDER_ESTIMATE moderate, SERVING_DEFAULT low-moderate, USER = 1.0.

`overall = recognition × match × portion^w` (w<1 — portion uncertainty matters less because grams are
one slider away from corrected). Bands with ONE threshold table (`confidence.thresholds.ts`):

| Band | Launch UX |
|---|---|
| HIGH | pre-selected candidate, one tap to confirm |
| MEDIUM | candidate shown with alternates expanded |
| LOW / none | manual flow opens, prefilled with whatever was extracted |

Scan-level confidence = calorie-weighted mean of candidate overalls. **Auto-accept (skip confirmation)
exists in the design as a THRESHOLD graduation** — enabled per-user only when VisionFeedback shows
sustained precision (e.g. ≥95% unedited confirmations over N scans). Never at launch.

---

## 7. Data model (additive only — no existing column changes)

```prisma
model VisionScan {          // new table
  id/userId/source/status/imageRef/provider/model/providerVersion
  detections Json           // raw provider output (audit + eval corpus)
  proposal   Json           // the VisionScanProposal shown to the user (versioned by contractVersion)
  scanConfidence Float?     // denormalized for dashboards
  loggedMealId String?      // set on LOGGED (provenance link)
  failureReason String?     // FAILED/EXPIRED detail
  createdAt/processedAt/confirmedAt/expiresAt
  @@index([userId, createdAt])
}
model VisionFeedback {      // new table — the training signal
  id/scanId/userId/detectionIndex
  proposedFoodItemId String? / confirmedFoodItemId String?   // label→food correction
  proposedGrams Float? / confirmedGrams Float?               // portion delta
  action String             // 'ACCEPTED'|'SWAPPED'|'EDITED_PORTION'|'REMOVED'|'ADDED_MANUAL'
  createdAt
}
// LoggedMeal: + source String @default("manual")   // 'manual' | 'vision' | 'barcode' | …
//             + visionScanId String?               // nullable provenance backlink
```

`LoggedMeal.source` is the ONLY touch on an existing table: additive with a default, invisible to every
consumer (none read it), and it gives the ledger/analytics free provenance ("% of meals logged via
vision" becomes a retention metric later). Scan `detections/proposal` are `Json` deliberately: provider
output shape churns; the *contract* stays typed at the API layer. **Enum-values lesson from 2B.1 applies:
`source` and all scan vocabularies are Strings + TS unions, never Postgres enums.**

## 8. Event flow

- `meal.logged` remains THE platform event, emitted only by `LogsService` — vision adds no new emitter.
- Internal vision events (`vision.scan.proposed`, `.confirmed`, `.failed`) are for vision's own
  telemetry/feedback module only. Nothing outside `vision/` may subscribe to them — enforced by review
  convention, so the plug-in stays severable.

## 9. Repository structure

```
app/backend/src/vision/
  vision.module.ts            // imports FoodModule, LogsModule (sanctioned seams only)
  vision.controller.ts        // POST /vision/scans · GET /vision/scans/:id · POST /vision/scans/:id/confirm
  vision-scan.service.ts      // lifecycle + orchestration
  pipeline/{matching,portion,confidence}.ts   // pure, deterministic, unit-tested
  providers/{vision-provider.port.ts, provider.registry.ts, fixture.provider.ts, <vendor>.provider.ts…}
  feedback/vision-feedback.service.ts
  types/vision-contract.ts    // §4 — the only file mobile/other domains may import
app/mobile: src/api/vision.ts · src/hooks/useVisionScan.ts · app/scan.tsx (camera → upload → confirm UI)
```

## 10. Failure handling (friction can only go down)

| Failure | Behavior |
|---|---|
| Provider down/timeout/rate-limit | scan FAILED + `fallback.reason` → mobile opens manual flow immediately |
| Zero detections | PROPOSED with empty candidates → manual flow, image kept for feedback |
| Label matches nothing in catalog | candidate with `foodItemId: null` → logs as one-off (existing path) |
| Low confidence | never blocks — LOW band just changes the UX mode |
| Upload fails / offline | manual flow untouched (vision is additive UI, never the only door) |
| User abandons at PROPOSED | EXPIRED by lazy sweep; nothing was logged; no partial state |
| Provider returns garbage | contract validation at the adapter edge; unparseable ⇒ FAILED (same as down) |

## 11. Testing strategy

- **Fixture provider as first-class citizen**: deterministic canned `RecognitionResult`s make every
  pipeline test (and demos, and mobile dev) run with zero vendor calls — the same philosophy as
  `hasKey=false → deterministic coach`.
- **Pure-stage unit tests**: matching, portion strategies, confidence scoring are pure functions →
  exhaustive branch tests like `smoke-planner`'s Part A.
- **`smoke-vision.ts`** (embedded PG, established harness): full lifecycle CREATED→…→LOGGED via fixture
  provider; asserts the confirmed scan produced a real LoggedMeal through `LogsService`, `meal.logged`
  fired (rollup went stale), provenance stamped, feedback rows captured, expiry sweep, every failure
  path degrades correctly, and determinism of everything post-provider.
- **Contract tests**: `VisionScanProposal`/`ScanConfirmation` serialization pinned (no Prisma/vendor
  leakage — same assertions style as `smoke-contract`).
- **Eval harness (later slice)**: golden image set + stored `detections` → offline precision/recall per
  provider; drives provider choice and auto-accept graduation with data, not vibes.

## 12. Future extensions (already anticipated, zero redesign)

| Extension | How it lands |
|---|---|
| Barcode | `source: 'BARCODE'`; adapter capability; MATCH consults OpenFoodFacts-backed catalog; same confirm |
| Menu OCR / restaurant | `MENU_OCR`; detections are dish names; matching biases restaurant-tagged foods |
| Grocery receipts | `RECEIPT_OCR`; output feeds pantry/grocery (2D consumers), not necessarily a meal |
| Multimodal AI | just another `VisionProvider` whose `raw` is richer; contract unchanged |
| Video | `VIDEO_FRAME` scans sharing one session id; portion from motion later — new strategy, same interface |
| Wearables | not vision: a future producer that also converges on `LogsService` — the pattern generalizes |

## 13. Roadmap (additive slices; every slice leaves the app working)

- **V0 — Contracts + skeleton**: `vision/` module, contract types, provider port + registry + fixture
  provider, VisionScan/VisionFeedback migration, scan lifecycle endpoints, `smoke-vision`. No camera, no
  vendor, invisible to users. *(App unchanged for everyone.)*
- **V1 — Manual-assist camera (Expo Go)**: mobile capture/upload → fixture-or-first-vendor proposal →
  confirmation screen → `logMeal` handoff + `source`/provenance columns + feedback capture. Feature-flagged.
- **V2 — First real provider**: one multimodal adapter behind the port (chosen by eval, not loyalty);
  timeout/fallback discipline; telemetry in `AiGenerationLog` style; manual flow always one tap away.
- **V3 — Portion intelligence**: serving-default strategy tuned by feedback data; alternates UX; per-user
  precision stats; barcode as second source (cheap, high-precision win).
- **V4 — Continuous improvement**: eval harness over accumulated feedback; provider A/B by config;
  matching tuned by correction corpus; auto-accept graduation for HIGH-precision users.
- **V5 — Expansion**: menu OCR, receipts, video frames — each a new source + adapter capability, no
  pipeline redesign.

## 14. Definition-of-done check

- Vision evolves independently → bounded module, own tables, severable (§3, §9). ✓
- Existing platform untouched → only additive `LoggedMeal.source`/`visionScanId`; single write path
  preserved; no consumer changes (§1, §7). ✓
- `LoggedMeal` remains the integration point → confirmation hands off to `LogsService.logMeal` (§5.6). ✓
- Providers swappable → `VisionProvider` port + registry + fixture-first; no vendor names outside
  `providers/` (§4). ✓
- CV is a plug-in, not the platform → the user can always log manually; deleting `vision/` breaks nothing (§2). ✓
