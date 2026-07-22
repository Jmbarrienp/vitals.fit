import { Module } from '@nestjs/common';
import { NutritionStateModule } from '../nutrition-state/nutrition-state.module';
import { PlannerModule } from '../planner/planner.module';
import { MealPlannerModule } from '../meal-planner/meal-planner.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { NutritionCopilotRuntime } from './copilot.runtime';
import { CopilotController } from './copilot.controller';

/**
 * The Copilot bounded context (V5.0) — pure composition. It imports the
 * modules whose EXPORTED services it coordinates and adds nothing of its own:
 * no repository, no Prisma, no migration, no new intelligence. Removing this
 * module removes the coordination layer and nothing else — every engine keeps
 * working exactly as before, which is the proof it never absorbed a
 * responsibility that wasn't coordination.
 */
@Module({
  imports: [NutritionStateModule, PlannerModule, MealPlannerModule, RecommendationsModule],
  providers: [NutritionCopilotRuntime],
  controllers: [CopilotController],
  exports: [NutritionCopilotRuntime],
})
export class CopilotModule {}
