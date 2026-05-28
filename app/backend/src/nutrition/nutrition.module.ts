import { Module } from '@nestjs/common';
import { NutritionService } from './nutrition.service';
import { NutritionController } from './nutrition.controller';

@Module({
  providers: [NutritionService],
  controllers: [NutritionController],
  exports: [NutritionService],
})
export class NutritionModule {}
