import { Injectable } from '@nestjs/common';
import { CoachingContextService } from '../nutrition-state/coaching-context.service';
import { CoachingContext } from '../nutrition-state/types/coaching-context';
import { decidePlan } from '../planner/adaptive-planner.engine';
import { PLANNER_VERSION } from '../planner/types/nutrition-plan';
import { FoodService } from '../food/food.service';
import { NormalizedFood } from '../food/adapters/food-adapter.interface';
import { buildMealPlan, MealCandidate } from './meal-planner.engine';
import { MealPlan } from './types/meal-plan';

/** How many catalog foods to include as fallback candidates (bounded pool). */
const CATALOG_POOL_SIZE = 40;

/**
 * The Adaptive Meal Planner (Phase 2D.1) — the execution layer. A pure CONSUMER:
 * it builds the deterministic CoachingContext ONCE, reads the Adaptive Planner's
 * decision from that same context (the planner stays the only strategy maker),
 * assembles a priority-ranked pool from the user's OWN foods + the catalog, and
 * delegates all composition to the deterministic engine. It reads NO raw meal
 * logs (frequent/recent come through the sanctioned FoodService aggregation),
 * recomputes NO scores, and writes nothing.
 */
@Injectable()
export class MealPlannerService {
  constructor(
    private readonly coachingContext: CoachingContextService,
    private readonly food: FoodService,
  ) {}

  /**
   * `providedCtx` (V5.2) lets a caller that ALREADY built the context reuse
   * it. Optional and fully backward compatible — the context is the same
   * deterministic snapshot whether built here or passed in.
   */
  async getMealPlan(userId: string, providedCtx?: CoachingContext): Promise<MealPlan> {
    // One context build feeds both the planner decision and the meal signals.
    const ctx = providedCtx ?? (await this.coachingContext.build(userId, 'full'));
    const plan = decidePlan(ctx);

    const [favorites, frequent, recent, custom, common] = await Promise.all([
      this.food.getFavorites(userId),
      this.food.getFrequent(userId),
      this.food.getRecent(userId),
      this.food.getCustom(userId),
      this.food.getCommon(CATALOG_POOL_SIZE, userId),
    ]);

    const pool = buildPool([favorites, frequent, recent, custom, common]);

    return buildMealPlan({
      contractVersion: ctx.meta.version,
      plannerVersion: PLANNER_VERSION,
      generatedAt: ctx.meta.generatedAt,
      goalDirection: ctx.user.goal,
      goalTargets: {
        calories: ctx.targets.calories,
        proteinG: ctx.targets.proteinG,
        carbsG: ctx.targets.carbsG,
        fatG: ctx.targets.fatG,
      },
      plan,
      behaviorFlags: ctx.currentState.behaviorFlags,
      nutritionScore: ctx.currentState.nutritionScore,
      pool,
    });
  }
}

/**
 * Merge the food lists into one deduped, priority-ranked candidate pool. Rank
 * reflects how much the user already relies on a food (favorites highest,
 * catalog lowest); the first list a food appears in wins.
 */
function buildPool(lists: NormalizedFood[][]): MealCandidate[] {
  const byId = new Map<string, MealCandidate>();
  lists.forEach((list, rank) => {
    for (const f of list) {
      if (byId.has(f.id)) continue; // keep the highest-priority occurrence
      byId.set(f.id, {
        id: f.id,
        name: f.name,
        kcal100: f.caloriesPer100g,
        prot100: f.proteinPer100g,
        carb100: f.carbsPer100g,
        fat100: f.fatPer100g,
        priorityRank: rank, // 0 fav, 1 frequent, 2 recent, 3 custom, 4 catalog
        userOwned: rank <= 3,
      });
    }
  });
  return Array.from(byId.values());
}
