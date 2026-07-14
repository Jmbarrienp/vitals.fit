/**
 * Adaptive Meal Plan contract (Phase 2D.1) — the first EXECUTION layer of Vitals
 * Fit. The planner decides strategy; the meal planner turns that strategy into a
 * concrete day of eating using the user's OWN food repertoire. Deterministic:
 * identical context + plan + food pool -> identical meal plan.
 *
 * A pure consumer — it computes no nutrition strategy and no scores. Every
 * vocabulary is pinned here (no @prisma imports) so future consumers (grocery
 * lists, recipe recs, AI substitutions, CV corrections) depend on a stable,
 * model-agnostic contract, not the schema.
 */

export const MEAL_PLANNER_NAME = 'vitals-fit.meal-planner';
export const MEAL_PLANNER_VERSION = 1;

export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

/** Where a suggested food came from — user's repertoire ranks above the catalog. */
export type FoodSource = 'favorite' | 'frequent' | 'recent' | 'custom' | 'catalog';

export type MealPlanConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** Which target set the plan executes against. */
export type TargetSource = 'planner-adjusted' | 'current-goal';

export interface MealItem {
  foodId: string;
  name: string;
  source: FoodSource;
  grams: number; // estimated portion
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface PlannedMeal {
  slot: MealSlot;
  name: string; // localized display name (es)
  targetCalories: number;
  targetProteinG: number;
  items: MealItem[];
  totalCalories: number;
  totalProteinG: number;
}

export interface MealPlan {
  meta: {
    planner: typeof MEAL_PLANNER_NAME;
    version: number; // MEAL_PLANNER_VERSION
    contractVersion: number; // CoachingContext version
    plannerVersion: number; // Adaptive Planner version the strategy came from
    generatedAt: string; // ISO — informational only, NOT part of determinism
  };

  targets: {
    source: TargetSource; // did we execute the planner's adjusted targets or the current goal?
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };

  meals: PlannedMeal[];
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };

  /** Deterministic adaptation codes applied (e.g. PROTEIN_TO_BREAKFAST, SIMPLER_STRUCTURE). */
  adaptations: string[];

  confidence: MealPlanConfidence;
  rationale: {
    drivers: string[]; // structured codes explaining the plan (planner decision + adaptations)
    summary: string; // deterministic, human — a coach MAY rephrase, never override
  };

  /** How much of the plan came from foods the user already eats (adherence signal). */
  coverage: { fromUserFoods: number; totalItems: number };

  reviewWindowDays: number; // inherited from the planner's headline
  reviewDate: string; // ISO — informational, derived from now
}
