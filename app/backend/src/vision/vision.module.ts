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
import { BarcodeLookupProviderRegistry } from './barcode/barcode-lookup.registry';
import { FixtureBarcodeLookupProvider } from './barcode/fixture-barcode-lookup.provider';
import { OpenFoodFactsLookupProvider } from './barcode/openfoodfacts-lookup.provider';
import { OCRProviderRegistry } from './ocr/ocr-provider.registry';
import { FixtureOCRProvider } from './ocr/fixture-ocr.provider';
import { ClaudeOCRProvider } from './ocr/claude-ocr.provider';
import { PortionPriorReader } from './priors/portion-prior.reader';

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

    // Portion priors (V3.3) — the engine's only I/O. Reads corpora the platform
    // already owns (LoggedMealItem, VisionFeedback, PlannedMealItem); the blend
    // itself is pure and lives in pipeline/portion-engine.ts.
    PortionPriorReader,

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

    // Barcode lookup backends (V3.1) — a sibling registry, not an extension of
    // the vision one: decoding is on-device, so this port takes a barcode
    // string, never an image. Default is 'openfoodfacts', not 'fixture' — a
    // real lookup is free and keyless, unlike a vision model call.
    FixtureBarcodeLookupProvider,
    OpenFoodFactsLookupProvider,
    {
      provide: BarcodeLookupProviderRegistry,
      useFactory: (config: ConfigService, fixture: FixtureBarcodeLookupProvider, off: OpenFoodFactsLookupProvider) =>
        new BarcodeLookupProviderRegistry(config, [fixture, off]),
      inject: [ConfigService, FixtureBarcodeLookupProvider, OpenFoodFactsLookupProvider],
    },

    // Nutrition-label OCR backends (V3.2) — a third registry, same swap-by-config
    // pattern. Defaults to 'fixture' like Vision (a real OCR call costs money),
    // not to the real provider like Barcode (whose lookup is free and keyless).
    FixtureOCRProvider,
    ClaudeOCRProvider,
    {
      provide: OCRProviderRegistry,
      useFactory: (config: ConfigService, fixture: FixtureOCRProvider, claude: ClaudeOCRProvider) =>
        new OCRProviderRegistry(config, [fixture, claude]),
      inject: [ConfigService, FixtureOCRProvider, ClaudeOCRProvider],
    },
  ],
  controllers: [VisionController],
  exports: [VisionScanService],
})
export class VisionModule {}
