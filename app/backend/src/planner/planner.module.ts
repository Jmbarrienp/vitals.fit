import { Module } from '@nestjs/common';
import { NutritionStateModule } from '../nutrition-state/nutrition-state.module';
import { AdaptivePlannerService } from './adaptive-planner.service';
import { PlannerController } from './planner.controller';

/**
 * The Planner bounded context (Phase 2C.2). Imports only the intelligence contract
 * source (NutritionStateModule -> CoachingContext). It has NO AI dependency: the
 * planner is fully deterministic and AI is optional. It owns nutrition strategy;
 * the coach owns communication.
 */
@Module({
  imports: [NutritionStateModule],
  providers: [AdaptivePlannerService],
  controllers: [PlannerController],
  exports: [AdaptivePlannerService],
})
export class PlannerModule {}
