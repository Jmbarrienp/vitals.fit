import { Module } from '@nestjs/common';
import { NutritionStateService } from './nutrition-state.service';
import { NutritionStateListener } from './nutrition-state.listener';
import { NutritionStateController } from './nutrition-state.controller';
import { WeeklyLedgerService } from './weekly-ledger.service';

@Module({
  providers: [NutritionStateService, NutritionStateListener, WeeklyLedgerService],
  controllers: [NutritionStateController],
  exports: [NutritionStateService, WeeklyLedgerService],
})
export class NutritionStateModule {}
