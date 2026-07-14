import { Module } from '@nestjs/common';
import { NutritionStateModule } from '../nutrition-state/nutrition-state.module';
import { FoodModule } from '../food/food.module';
import { MealPlannerService } from './meal-planner.service';
import { MealPlannerController } from './meal-planner.controller';

/**
 * The Meal Planner bounded context (Phase 2D.1) — the execution layer. Imports the
 * CoachingContext source (NutritionStateModule) and the Food Catalog (FoodModule).
 * It reuses the planner's pure decision function directly (decidePlan) so a single
 * context build feeds both. No AI dependency: composition is fully deterministic.
 */
@Module({
  imports: [NutritionStateModule, FoodModule],
  providers: [MealPlannerService],
  controllers: [MealPlannerController],
  exports: [MealPlannerService],
})
export class MealPlannerModule {}
