import { Module } from '@nestjs/common';
import { NutritionStateService } from './nutrition-state.service';
import { NutritionStateListener } from './nutrition-state.listener';

@Module({
  providers: [NutritionStateService, NutritionStateListener],
  exports: [NutritionStateService],
})
export class NutritionStateModule {}
