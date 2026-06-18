import { Module } from '@nestjs/common';
import { NutritionStateService } from './nutrition-state.service';
import { NutritionStateListener } from './nutrition-state.listener';
import { NutritionStateController } from './nutrition-state.controller';

@Module({
  providers: [NutritionStateService, NutritionStateListener],
  controllers: [NutritionStateController],
  exports: [NutritionStateService],
})
export class NutritionStateModule {}
