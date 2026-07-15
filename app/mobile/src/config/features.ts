/**
 * Feature flags (build-time, via EXPO_PUBLIC_* env). Default OFF so the app
 * behaves exactly as before when a flag is unset — the manual logging flow is
 * always the baseline. Set EXPO_PUBLIC_VISION_ENABLED=true in the mobile .env
 * to reveal the camera capture entry point (Nutrition Vision V1).
 *
 * `barcodeScan` is a SEPARATE flag from `visionCapture` (V3.1) — a deliberate
 * choice, not an oversight: barcode is a different perception plugin with its
 * own native dependency (expo-camera) and its own rollout risk, and progressive
 * enhancement means each modality should be independently toggleable.
 */
export const FEATURES = {
  visionCapture: process.env.EXPO_PUBLIC_VISION_ENABLED === 'true',
  barcodeScan: process.env.EXPO_PUBLIC_BARCODE_ENABLED === 'true',
};
