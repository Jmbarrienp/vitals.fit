import { Module } from '@nestjs/common';
import { FoodService } from './food.service';
import { FoodController } from './food.controller';
import { LocalFoodAdapter } from './adapters/local.adapter';

@Module({
  providers: [FoodService, LocalFoodAdapter],
  controllers: [FoodController],
  exports: [FoodService],
})
export class FoodModule {}
