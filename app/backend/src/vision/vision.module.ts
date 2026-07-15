import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodModule } from '../food/food.module';
import { LogsModule } from '../logs/logs.module';
import { VisionController } from './vision.controller';
import { VisionScanService } from './vision-scan.service';
import { VisionProviderRegistry } from './providers/provider.registry';
import { FixtureVisionProvider } from './providers/fixture.provider';

/**
 * The Vision bounded context (Phase 2D.2 V0) — a severable plug-in. Imports only
 * the sanctioned seams: FoodModule (catalog search/reuse) and LogsModule (the
 * single existing LoggedMeal write path). No other domain imports FROM vision.
 *
 * The registry is built via a factory over the list of registered providers —
 * adding a real vendor adapter is a one-line change here, nowhere else.
 */
@Module({
  imports: [FoodModule, LogsModule],
  providers: [
    VisionScanService,
    FixtureVisionProvider,
    {
      provide: VisionProviderRegistry,
      useFactory: (config: ConfigService, fixture: FixtureVisionProvider) =>
        new VisionProviderRegistry(config, [fixture]),
      inject: [ConfigService, FixtureVisionProvider],
    },
  ],
  controllers: [VisionController],
  exports: [VisionScanService],
})
export class VisionModule {}
