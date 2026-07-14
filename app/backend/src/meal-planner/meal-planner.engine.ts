import { NutritionPlan } from '../planner/types/nutrition-plan';
import {
  FoodSource,
  MEAL_PLANNER_NAME,
  MEAL_PLANNER_VERSION,
  MealItem,
  MealPlan,
  MealPlanConfidence,
  MealSlot,
  PlannedMeal,
  TargetSource,
} from './types/meal-plan';

/**
 * The Adaptive Meal Planning engine (Phase 2D.1). PURE and DETERMINISTIC: given
 * the planner's strategy, the user's targets, behaviour signals and a
 * priority-ranked pool of the user's OWN foods, it composes a concrete day of
 * eating. Same inputs -> same plan (only generatedAt/reviewDate, copied through,
 * vary).
 *
 * It EXECUTES strategy; it never decides it. It never scores, never analyses
 * behaviour, never reads a raw log — those already happened upstream.
 */

const PROTEIN_DENSITY_MIN = 12; // g protein / 100g to count as a protein anchor
const CARB_DENSITY_MIN = 15; // g carbs / 100g to count as an energy/carb source
const MIN_FILL_KCAL = 120; // don't add another item for less than this

/** A candidate food, priority-ranked by how much the user already relies on it. */
export interface MealCandidate {
  id: string;
  name: string;
  kcal100: number;
  prot100: number;
  carb100: number;
  fat100: number;
  priorityRank: number; // 0 favorite, 1 frequent, 2 recent, 3 custom, 4 catalog
  userOwned: boolean; // priorityRank <= 3
}

export interface MealPlanInput {
  contractVersion: number;
  plannerVersion: number;
  generatedAt: string;
  goalDirection: 'lose' | 'gain' | 'maintain';
  goalTargets: { calories: number; proteinG: number; carbsG: number; fatG: number };
  plan: NutritionPlan;
  behaviorFlags: string[];
  nutritionScore: number | null;
  pool: MealCandidate[];
}

const SLOT_NAME: Record<MealSlot, string> = {
  BREAKFAST: 'Desayuno',
  LUNCH: 'Almuerzo',
  DINNER: 'Cena',
  SNACK: 'Snack',
};
const SOURCE_BY_RANK: FoodSource[] = ['favorite', 'frequent', 'recent', 'custom', 'catalog'];

export function buildMealPlan(input: MealPlanInput): MealPlan {
  const targets = effectiveTargets(input.plan, input.goalTargets);
  const adapt = deriveAdaptations(input.plan, input.behaviorFlags, input.nutritionScore, input.goalDirection);

  // ── meal structure ──
  const slots: MealSlot[] = adapt.extraSnack
    ? ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']
    : ['BREAKFAST', 'LUNCH', 'DINNER'];
  const calShares = adapt.extraSnack ? [0.28, 0.35, 0.27, 0.1] : [0.3, 0.4, 0.3];
  const protShares = proteinShares(calShares, adapt.proteinToBreakfast);
  const maxItems = adapt.simpler ? 2 : 3;

  // ── compose each meal from the pool ──
  const usedIds = new Set<string>();
  const meals: PlannedMeal[] = slots.map((slot, i) => {
    const mealKcal = Math.round(targets.calories * calShares[i]);
    const mealProt = Math.round(targets.proteinG * protShares[i]);
    const items = composeMeal(input.pool, mealKcal, mealProt, maxItems, usedIds, adapt.lighter);
    return {
      slot,
      name: SLOT_NAME[slot],
      targetCalories: mealKcal,
      targetProteinG: mealProt,
      items,
      totalCalories: sum(items, (it) => it.calories),
      totalProteinG: Math.round(sum(items, (it) => it.proteinG)),
    };
  });

  const allItems = meals.flatMap((m) => m.items);
  const totals = {
    calories: sum(allItems, (it) => it.calories),
    proteinG: Math.round(sum(allItems, (it) => it.proteinG)),
    carbsG: Math.round(sum(allItems, (it) => it.carbsG)),
    fatG: Math.round(sum(allItems, (it) => it.fatG)),
  };
  const fromUserFoods = allItems.filter((it) => it.source !== 'catalog').length;

  const confidence = scoreConfidence(totals, targets, fromUserFoods, allItems.length);
  const reviewWindowDays = input.plan.reviewWindowDays;

  return {
    meta: {
      planner: MEAL_PLANNER_NAME,
      version: MEAL_PLANNER_VERSION,
      contractVersion: input.contractVersion,
      plannerVersion: input.plannerVersion,
      generatedAt: input.generatedAt,
    },
    targets,
    meals,
    totals,
    adaptations: adapt.codes,
    confidence,
    rationale: {
      drivers: [input.plan.headline.code, ...adapt.codes, targets.source],
      summary: buildSummary(input.plan, adapt, targets, fromUserFoods, allItems.length),
    },
    coverage: { fromUserFoods, totalItems: allItems.length },
    reviewWindowDays,
    reviewDate: addDaysISO(input.generatedAt, reviewWindowDays),
  };
}

// ── strategy -> executable targets ──

function effectiveTargets(
  plan: NutritionPlan,
  goal: { calories: number; proteinG: number; carbsG: number; fatG: number },
): MealPlan['targets'] {
  let calories = goal.calories;
  let proteinG = goal.proteinG;
  let source: TargetSource = 'current-goal';
  // The meal planner EXECUTES the planner's recommended targets when it proposes a change.
  for (const d of plan.decisions) {
    if (d.adjustment?.newCalorieTarget != null) {
      calories = d.adjustment.newCalorieTarget;
      source = 'planner-adjusted';
    }
    if (d.adjustment?.newProteinTarget != null) {
      proteinG = d.adjustment.newProteinTarget;
      source = 'planner-adjusted';
    }
  }
  // Protein is fixed; split the remaining energy by the goal's carb:fat ratio.
  const remaining = Math.max(0, calories - proteinG * 4);
  const goalCarbKcal = goal.carbsG * 4;
  const goalFatKcal = goal.fatG * 9;
  const denom = goalCarbKcal + goalFatKcal;
  const carbRatio = denom > 0 ? goalCarbKcal / denom : 0.55;
  return {
    source,
    calories,
    proteinG,
    carbsG: Math.round((remaining * carbRatio) / 4),
    fatG: Math.round((remaining * (1 - carbRatio)) / 9),
  };
}

interface Adaptations {
  codes: string[];
  proteinToBreakfast: boolean;
  simpler: boolean;
  lighter: boolean;
  extraSnack: boolean;
}

function deriveAdaptations(
  plan: NutritionPlan,
  flags: string[],
  nutritionScore: number | null,
  goalDir: string,
): Adaptations {
  const proteinToBreakfast = flags.includes('PROTEIN_CHRONIC_LOW') || plan.decisions.some((d) => d.code === 'INCREASE_PROTEIN');
  const simpler =
    plan.posture === 'ADHERENCE_FIRST' ||
    flags.includes('LOW_LOGGING_CONSISTENCY') ||
    flags.includes('WEEKEND_OVEREATING') ||
    (nutritionScore !== null && nutritionScore < 50);
  const lighter = plan.decisions.some((d) => d.code === 'REDUCE_CALORIES');
  const extraSnack = !simpler && goalDir === 'gain';

  const codes: string[] = [];
  if (proteinToBreakfast) codes.push('PROTEIN_TO_BREAKFAST');
  if (simpler) codes.push('SIMPLER_STRUCTURE');
  if (lighter) codes.push('LIGHTER_MEALS');
  if (extraSnack) codes.push('EXTRA_SNACK');
  return { codes, proteinToBreakfast, simpler, lighter, extraSnack };
}

function proteinShares(calShares: number[], proteinToBreakfast: boolean): number[] {
  const shares = [...calShares];
  if (proteinToBreakfast && shares.length >= 3) {
    const boost = 0.12;
    const donors = shares.map((_, i) => i).filter((i) => i === 1 || i === 2);
    const donorTotal = donors.reduce((s, i) => s + shares[i], 0);
    shares[0] += boost;
    for (const i of donors) shares[i] -= boost * (shares[i] / donorTotal);
  }
  const total = shares.reduce((a, b) => a + b, 0);
  return shares.map((s) => s / total); // normalize defensively
}

// ── deterministic meal composition from the pool ──

function composeMeal(
  pool: MealCandidate[],
  kcalTarget: number,
  proteinTarget: number,
  maxItems: number,
  usedIds: Set<string>,
  lighter: boolean,
): MealItem[] {
  const items: MealItem[] = [];

  const proteinSources = pool.filter((c) => c.prot100 >= PROTEIN_DENSITY_MIN).sort(byPriorityThen((c) => -c.prot100));
  const anchor = pickPreferUnused(proteinSources, usedIds);
  if (anchor) {
    const grams = clampRound10((proteinTarget * 100) / anchor.prot100, 30, 300);
    items.push(mkItem(anchor, grams));
    usedIds.add(anchor.id);
  }

  if (items.length < maxItems) {
    const remaining = kcalTarget - sum(items, (it) => it.calories);
    if (remaining > MIN_FILL_KCAL) {
      const carbSources = pool
        .filter((c) => c.carb100 >= CARB_DENSITY_MIN && c.prot100 < PROTEIN_DENSITY_MIN && !items.some((it) => it.foodId === c.id))
        .sort(byPriorityThen((c) => -c.carb100));
      const carb = pickPreferUnused(carbSources, usedIds);
      if (carb) {
        const grams = clampRound10((remaining * (lighter ? 0.5 : 0.6) * 100) / carb.kcal100, 20, 400);
        items.push(mkItem(carb, grams));
        usedIds.add(carb.id);
      }
    }
  }

  if (items.length < maxItems) {
    const remaining = kcalTarget - sum(items, (it) => it.calories);
    if (remaining > MIN_FILL_KCAL) {
      const others = pool
        .filter((c) => c.kcal100 > 0 && !items.some((it) => it.foodId === c.id))
        .sort(byPriorityThen((c) => c.kcal100)); // prefer lower energy density as filler
      const other = pickPreferUnused(others, usedIds);
      if (other) {
        const grams = clampRound10((remaining * 100) / other.kcal100, 20, 300);
        items.push(mkItem(other, grams));
        usedIds.add(other.id);
      }
    }
  }

  return items;
}

function mkItem(c: MealCandidate, grams: number): MealItem {
  const f = grams / 100;
  return {
    foodId: c.id,
    name: c.name,
    source: SOURCE_BY_RANK[c.priorityRank] ?? 'catalog',
    grams,
    calories: Math.round(c.kcal100 * f),
    proteinG: Math.round(c.prot100 * f * 10) / 10,
    carbsG: Math.round(c.carb100 * f * 10) / 10,
    fatG: Math.round(c.fat100 * f * 10) / 10,
  };
}

/** Sort by priority, then a numeric secondary key, then stable name/id — fully deterministic. */
function byPriorityThen(secondary: (c: MealCandidate) => number) {
  return (a: MealCandidate, b: MealCandidate): number =>
    a.priorityRank - b.priorityRank ||
    secondary(a) - secondary(b) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id);
}

function pickPreferUnused(sorted: MealCandidate[], usedIds: Set<string>): MealCandidate | null {
  return sorted.find((c) => !usedIds.has(c.id)) ?? sorted[0] ?? null;
}

function scoreConfidence(
  totals: { calories: number; proteinG: number },
  targets: { calories: number; proteinG: number },
  fromUserFoods: number,
  totalItems: number,
): MealPlanConfidence {
  if (totalItems === 0) return 'LOW';
  const calOff = targets.calories > 0 ? Math.abs(totals.calories - targets.calories) / targets.calories : 1;
  const protOff = targets.proteinG > 0 ? Math.abs(totals.proteinG - targets.proteinG) / targets.proteinG : 1;
  const coverage = fromUserFoods / totalItems;
  if (coverage >= 0.6 && calOff <= 0.12 && protOff <= 0.15) return 'HIGH';
  if (calOff <= 0.22 && protOff <= 0.25) return 'MEDIUM';
  return 'LOW';
}

function buildSummary(
  plan: NutritionPlan,
  adapt: Adaptations,
  targets: MealPlan['targets'],
  fromUserFoods: number,
  totalItems: number,
): string {
  const base = `Plan de ${targets.calories} kcal y ${targets.proteinG}g de proteína, alineado con la estrategia (${plan.headline.code}).`;
  const notes: string[] = [];
  if (adapt.proteinToBreakfast) notes.push('más proteína en el desayuno');
  if (adapt.simpler) notes.push('estructura simplificada para sostener la adherencia');
  if (adapt.lighter) notes.push('comidas más ligeras');
  const coverage = totalItems > 0 ? ` ${fromUserFoods}/${totalItems} porciones vienen de alimentos que ya consumes.` : '';
  return notes.length > 0 ? `${base} Ajustes: ${notes.join(', ')}.${coverage}` : `${base}${coverage}`;
}

// ── small utils ──

function sum<T>(xs: T[], f: (x: T) => number): number {
  return Math.round(xs.reduce((s, x) => s + f(x), 0) * 10) / 10;
}

function clampRound10(x: number, lo: number, hi: number): number {
  const rounded = Math.round(x / 10) * 10;
  return Math.max(lo, Math.min(hi, rounded));
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
