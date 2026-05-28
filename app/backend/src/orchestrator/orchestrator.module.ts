import { Module } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { ProgressHandler } from './handlers/progress.handler';
import { RecommendationHandler } from './handlers/recommendation.handler';
import { RetentionHandler } from './handlers/retention.handler';

@Module({
  providers: [OrchestratorService, ProgressHandler, RecommendationHandler, RetentionHandler],
  controllers: [OrchestratorController],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
