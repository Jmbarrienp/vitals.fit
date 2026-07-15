/**
 * Restaurant context contract (Nutrition Vision V3.4). The stable boundary for
 * restaurant-aware drafting — the same role barcode-contract.ts plays for
 * barcode and ocr-contract.ts plays for labels. No vendor types, no Prisma.
 *
 * Epistemics: restaurant context is a SIGNAL, never a source of truth. A menu
 * candidate may carry nutrition ONLY when the menu source publishes it
 * (transcription — the same rule as V3.2 labels). Nothing here is ever computed
 * or inferred by a model: a provider that cannot cite a published number
 * returns null, and null is never filled in downstream.
 */

/** What a menu source knows about one dish. Macros are published-or-null, never derived. */
export interface MenuCandidate {
  name: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  servingGrams: number | null;
}

/** What a RestaurantMenuProvider returns. found=false is a valid, handled outcome. */
export interface MenuLookupResult {
  found: boolean;
  restaurantName: string | null; // the source's canonical name, when it has one
  items: MenuCandidate[];
}

/**
 * The restaurant block a proposal may carry (additive — pre-V3.4 proposals and
 * every other modality simply never set it). Presence means the platform is
 * confident enough in the scene signal to surface it; absence IS the fallback
 * state — the scan behaves exactly like a home-cooked photo scan.
 */
export interface RestaurantContext {
  restaurantName: string | null; // null = restaurant detected but name unreadable
  category: string | null; // e.g. 'italiana', 'tacos' — a cue for the user, nothing more
  confidence: number; // 0..1, the scene signal's confidence
  menuCandidates: MenuCandidate[]; // [] when no menu source is configured or lookup failed
}
