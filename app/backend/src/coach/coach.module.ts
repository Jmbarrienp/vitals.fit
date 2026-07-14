import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NutritionStateModule } from '../nutrition-state/nutrition-state.module';
import { WeeklyCoachService } from './weekly-coach.service';
import { CoachController } from './coach.controller';

/**
 * The Coach bounded context (Phase 2C.1). Imports the model adapter (AiModule)
 * and the intelligence contract source (NutritionStateModule → CoachingContext).
 * The coach is a pure consumer: it holds no state and owns no source of truth.
 */
@Module({
  imports: [AiModule, NutritionStateModule],
  providers: [WeeklyCoachService],
  controllers: [CoachController],
  exports: [WeeklyCoachService],
})
export class CoachModule {}
