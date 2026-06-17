import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { ProgressHandler } from './handlers/progress.handler';
import { RecommendationHandler } from './handlers/recommendation.handler';
import { RetentionHandler } from './handlers/retention.handler';
import { NutritionStateModule } from '../nutrition-state/nutrition-state.module';

@Module({
  imports: [NutritionStateModule],
  providers: [OrchestratorService, ProgressHandler, RecommendationHandler, RetentionHandler],
  controllers: [OrchestratorController],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
