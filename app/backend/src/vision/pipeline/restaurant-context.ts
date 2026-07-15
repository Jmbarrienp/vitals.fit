import { SceneContext } from '../types/vision-contract';
import { MenuCandidate, MenuLookupResult, RestaurantContext } from '../types/restaurant-contract';

/**
 * Restaurant context derivation (V3.4) — PURE. Decides whether the scene
 * signal is strong enough to surface, and sanitizes whatever a menu source
 * returned before it can reach a proposal. The policy lives HERE, server-side
 * and deterministic, not in mobile and not in a provider:
 *
 *   - below the threshold the context is dropped entirely (absence IS the
 *     fallback state — the scan behaves exactly like a home-cooked photo);
 *   - menu candidates are untrusted input: names are required and bounded,
 *     macros must be finite and plausible or they become null. A bad number
 *     from a menu source is DISCARDED, never repaired — repairing would be
 *     inventing nutrition, which nothing in Vision is allowed to do.
 */

/** Below this the scene signal says more about model uncertainty than about the meal. */
export const SCENE_CONFIDENCE_THRESHOLD = 0.5;
/** Proposal hygiene: a menu is a cue, not a catalog dump. */
export const MAX_MENU_CANDIDATES = 6;

const MAX_NAME_CHARS = 120;
/** Mirrors ConfirmScanItemDto's ceilings — never propose what confirm would reject. */
const MAX_CALORIES = 10_000;
const MAX_MACRO_G = 2_000;
const MAX_SERVING_G = 5_000;

export function deriveRestaurantContext(
  scene: SceneContext | undefined,
  menu: MenuLookupResult | null,
): RestaurantContext | null {
  if (!scene) return null;
  if (scene.setting !== 'RESTAURANT') return null;
  if (scene.confidence < SCENE_CONFIDENCE_THRESHOLD) return null;

  const items = (menu?.found ? menu.items : [])
    .map(sanitizeMenuCandidate)
    .filter((c): c is MenuCandidate => c !== null)
    .slice(0, MAX_MENU_CANDIDATES);

  return {
    restaurantName: cleanName(scene.restaurantName) ?? cleanName(menu?.restaurantName ?? null),
    category: cleanName(scene.category),
    confidence: round2(Math.max(0, Math.min(1, scene.confidence))),
    menuCandidates: items,
  };
}

/** Name required; each macro independently kept-or-nulled. Never throws, never invents. */
export function sanitizeMenuCandidate(raw: MenuCandidate): MenuCandidate | null {
  const name = cleanName(raw.name);
  if (!name) return null;
  return {
    name,
    calories: plausible(raw.calories, MAX_CALORIES),
    proteinG: plausible(raw.proteinG, MAX_MACRO_G),
    carbsG: plausible(raw.carbsG, MAX_MACRO_G),
    fatG: plausible(raw.fatG, MAX_MACRO_G),
    servingGrams: plausible(raw.servingGrams, MAX_SERVING_G),
  };
}

function plausible(value: number | null | undefined, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > max) return null;
  return Math.round(value * 10) / 10;
}

function cleanName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_NAME_CHARS);
  return trimmed.length > 0 ? trimmed : null;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
