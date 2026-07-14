import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PushModule } from '../push/push.module';
import { NutritionStateModule } from '../nutrition-state/nutrition-state.module';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationService } from './services/recommendation.service';
import { RecommendationListener } from './listeners/recommendation.listener';

@Module({
  imports: [AiModule, PushModule, NutritionStateModule],
  providers: [
    RecommendationsService,
    RecommendationService,
    RecommendationListener,
  ],
  controllers: [RecommendationsController],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
