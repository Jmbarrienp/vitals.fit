import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodModule } from '../food/food.module';
import { LogsModule } from '../logs/logs.module';
import { VisionController } from './vision.controller';
import { VisionScanService } from './vision-scan.service';
import { VisionProviderRegistry } from './providers/provider.registry';
import { FixtureVisionProvider } from './providers/fixture.provider';
import { ClaudeVisionProvider } from './providers/claude-vision.provider';
import { EphemeralImageStore } from './images/ephemeral-image-store';
import { VISION_IMAGE_STORE } from './images/image-store.port';

/**
 * The Vision bounded context (Phase 2D.2) — a severable plug-in. Imports only
 * the sanctioned seams: FoodModule (catalog search/reuse) and LogsModule (the
 * single existing LoggedMeal write path). No other domain imports FROM vision.
 *
 * V0 promised that adding a real vendor adapter would be a one-line change to
 * the registry's provider array. V2 collected on it: `ClaudeVisionProvider` is
 * appended below, and nothing in the pipeline, the service, the eval harness or
 * mobile changed to accommodate it. `VISION_PROVIDER` picks the active one.
 *
 * The image store is bound behind a token for the same reason: swapping the
 * ephemeral store for a durable one (Supabase Storage, S3) is a single line here.
 */
@Module({
  imports: [FoodModule, LogsModule],
  providers: [
    VisionScanService,

    // Image transport — the seam that lets a real provider get bytes without the port carrying them.
    EphemeralImageStore,
    { provide: VISION_IMAGE_STORE, useExisting: EphemeralImageStore },

    // Recognition backends. Interchangeable by config; the fixture always stays
    // registered so development and CI never need a vendor key.
    FixtureVisionProvider,
    ClaudeVisionProvider,
    {
      provide: VisionProviderRegistry,
      useFactory: (config: ConfigService, fixture: FixtureVisionProvider, claude: ClaudeVisionProvider) =>
        new VisionProviderRegistry(config, [fixture, claude]),
      inject: [ConfigService, FixtureVisionProvider, ClaudeVisionProvider],
    },
  ],
  controllers: [VisionController],
  exports: [VisionScanService],
})
export class VisionModule {}
