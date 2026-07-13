import { Module } from '@nestjs/common';
import { NutritionStateService } from './nutrition-state.service';
import { NutritionStateListener } from './nutrition-state.listener';
import { NutritionStateController } from './nutrition-state.controller';
import { WeeklyLedgerService } from './weekly-ledger.service';
import { WeeklyReviewService } from './weekly-review.service';

@Module({
  providers: [NutritionStateService, NutritionStateListener, WeeklyLedgerService, WeeklyReviewService],
  controllers: [NutritionStateController],
  exports: [NutritionStateService, WeeklyLedgerService, WeeklyReviewService],
})
export class NutritionStateModule {}
