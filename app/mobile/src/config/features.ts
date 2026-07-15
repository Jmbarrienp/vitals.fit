/**
 * Feature flags (build-time, via EXPO_PUBLIC_* env). Default OFF so the app
 * behaves exactly as before when a flag is unset — the manual logging flow is
 * always the baseline. Set EXPO_PUBLIC_VISION_ENABLED=true in the mobile .env
 * to reveal the camera capture entry point (Nutrition Vision V1).
 */
export const FEATURES = {
  visionCapture: process.env.EXPO_PUBLIC_VISION_ENABLED === 'true',
};
