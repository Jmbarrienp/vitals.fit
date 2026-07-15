# Nutrition Vision V1 — Camera Capture Flow (audit report)

Branch: `feature/nutrition-state-2a2` (continues the 2A–2D stack)
Status: implemented locally, smoke-green, TS clean (backend build + mobile). **Not deployed, not merged.**
Builds on V0 (`docs/nutrition-vision-v0-skeleton.md`) and the design (`docs/nutrition-vision-architecture.md`).

The first USER-FACING Vision capability: open the camera → capture a meal → review the proposed
interpretation → confirm or reject → converge on the existing `LoggedMeal` flow. Feature-flagged, off by
default, deterministic via the fixture provider, and the manual flow is never removed.

## Audit findings (before code)
- V0 already provides the whole backend spine: `POST /vision/scans` (create → provider → validated →
  candidates → proposal), `GET /vision/scans/:id`, `POST /vision/scans/:id/confirm` (hands off to
  `LogsService.logMeal`), `POST /vision/scans/:id/reject`, the provider registry + fixture, response
  validation, events, and the eval harness. **V1 needed almost no backend change** — just the fallback
  state and a UX-mode signal.
- Mobile's manual logging lives in the `log` (Registrar) tab via `useLogMeal`, which invalidates
  `today`/`food-recent`/`food-frequent`/`intelligence`. V1's confirm reuses the exact same invalidations.
- `expo-image-picker` was not installed; added at the SDK-54 version (Expo Go bundles the native module).

## What was built
### Backend (additive only — no nutrition module touched)
- **`FALLBACK_MANUAL` scan status** (String, no migration) + `markFallbackManual()` +
  `POST /vision/scans/:id/fallback` + a `VisionScanFallbackEvent`. It records that the user abandoned the
  proposal to log manually — it creates **no** LoggedMeal (the manual flow does, through the existing path)
  and cannot be confirmed afterward. This is the degradation escape hatch, tracked for the feedback corpus.
- **`mode: ScanUxMode` on the proposal** (`CONFIRM` / `REVIEW` / `FALLBACK`), derived server-side by
  `deriveUxMode(band, fallbackReason, candidateCount)`. The confidence POLICY stays on the backend: LOW /
  no-detections / provider-failure → FALLBACK; MEDIUM → REVIEW; HIGH → CONFIRM. Mobile only renders it.

### Mobile (feature-flagged, presentation only)
- **`config/features.ts`** — `FEATURES.visionCapture` from `EXPO_PUBLIC_VISION_ENABLED` (default off, so
  the app is unchanged unless the flag is set; the manual flow is always the baseline).
- **`api/vision.ts`** + **`types/vision.ts`** (contract mirror) + **`lib/vision.ts`** (band/mode → copy,
  presentation only) + **`hooks/useVisionCapture.ts`** — an explicit capture state machine
  (`idle → capturing → proposing → proposed → confirming → done | error`). It launches the camera
  (`expo-image-picker`), submits an image reference, exposes the proposal, and offers confirm / reject /
  fallback. It computes no nutrition; confirm() calls the backend which converges on `LogsService.logMeal`.
- **`app/scan.tsx`** — the capture/review screen: auto-launches the camera, renders the proposal
  (candidates with portions + confidence band + the mode's title/hint), lets the user toggle matched
  candidates, and offers **Confirmar y registrar** (hidden in FALLBACK mode), **Registrar a mano**
  (records fallback → opens the manual tab), and **Descartar** (reject). Errors and low confidence both
  steer to manual — friction can only go down.
- **Entry point**: a feature-flagged "📷 Escanear comida" button atop the `log` tab.

## Design-principle compliance
User confirmation mandatory (no scan → LoggedMeal without `confirmScan`) · Vision proposes, LogsService
commits (confirm handoff unchanged) · friction only goes down (every failure/low-confidence path prefills
+ opens manual) · Vision severable (mobile behind a flag; backend imports only Food/Logs; deleting `vision/`
breaks nothing) · mobile recalculates no nutrition (renders backend proposal + sends confirm/reject only).

## Integration invariants (asserted in smoke)
- LogsService remains the ONLY LoggedMeal producer — vision-sourced meals all carry a `visionScanId` link
  (a "no direct bypass" invariant is asserted). Downstream (rollup/ledger/review/planner/coach/meal
  planner) is untouched; `meal.logged` still fires only from `LogsService`.

## Verification
- `smoke:vision` **64/64**: all V0 coverage plus V1 — UX-mode derivation (HIGH→CONFIRM, MEDIUM→REVIEW,
  LOW/no-detections/failure→FALLBACK), the proposal carries `mode`, the fallback path (→ FALLBACK_MANUAL,
  event fired, **no LoggedMeal created**, cannot be confirmed after), and the no-bypass invariant.
- No regressions: `smoke:mealplan` 24/24, `smoke:planner` 24/24, `smoke:coach` 19/19, `smoke:contract` 25/25,
  `smoke:review` 28/28, `smoke:ledger` 28/28, `smoke:state` 37/37, `smoke:rec` 43/43, `smoke:1c` 14/14.
  Backend `nest build` clean. Mobile `tsc` clean.

## Deploy / testing notes
- No migration (V1 is additive vocabulary + a mode field; `FALLBACK_MANUAL` is a String value). Pending
  prod batch unchanged at 6 (V0's `nutrition_vision_v0` covers the tables).
- The flag is OFF by default — after deploy the app is unchanged for everyone until `EXPO_PUBLIC_VISION_ENABLED=true`.
- V1 submits an image *reference*; the fixture provider is deterministic on it (keyword-based). Real image
  bytes → a real provider is V2's concern. Camera capture itself must be verified on a device (Expo Go).

## Next (roadmap)
- **V2** — first real provider behind the port (image upload to storage; chosen by the eval harness).
- **V3+** — portion editing UX, barcode source, auto-accept graduation from `VisionFeedback`.
