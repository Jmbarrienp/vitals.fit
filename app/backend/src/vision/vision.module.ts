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
import { RestaurantMenuProviderRegistry } from './restaurant/restaurant-menu.registry';
import { NullRestaurantMenuProvider } from './restaurant/null-restaurant-menu.provider';
import { FixtureRestaurantMenuProvider } from './restaurant/fixture-restaurant-menu.provider';
import { GroundTruthReader } from './learning/ground-truth.reader';
import { ReplayEngine } from './learning/replay.engine';
import { EvaluationEngine } from './learning/evaluation.engine';
import { LearningController } from './learning/learning.controller';
import { TrustEvidenceReader } from './learning/trust-evidence.reader';
import { TrustEngine } from './learning/trust.engine';
import { TrustAuditService } from './learning/trust-audit.service';
import { PromotionExecutor } from './learning/promotion.executor';
import { RolloutDataReader } from './rollout/rollout-data.reader';
import { RolloutEngine } from './rollout/rollout.engine';
import { RolloutController } from './rollout/rollout.controller';
import { ShadowEvaluationRunner } from './governance/shadow-evaluation.runner';
import { GovernanceEngine } from './governance/governance.engine';
import { GovernanceController } from './governance/governance.controller';
import { PromotionExecutorEngine } from './promotion/promotion-executor.engine';
import { PromotionController } from './promotion/promotion.controller';
import { RollbackEngine } from './rollback/rollback.engine';
import { RollbackController } from './rollback/rollback.controller';

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

    // Restaurant menu sources (V3.4) — fourth registry, same swap-by-config
    // pattern. Default is 'none' (always not-found): no free keyless menu API
    // exists today, so production stays inert until one is deliberately
    // configured. Restaurant CONTEXT still works with it — only the menu
    // candidates are absent.
    NullRestaurantMenuProvider,
    FixtureRestaurantMenuProvider,
    {
      provide: RestaurantMenuProviderRegistry,
      useFactory: (config: ConfigService, none: NullRestaurantMenuProvider, fixture: FixtureRestaurantMenuProvider) =>
        new RestaurantMenuProviderRegistry(config, [none, fixture]),
      inject: [ConfigService, NullRestaurantMenuProvider, FixtureRestaurantMenuProvider],
    },

    // Continuous Learning & Evaluation (V3.5) — the permanent, read-only
    // subsystem that turns user confirmations into provider scorecards,
    // calibration curves and promotion decisions. Providers are temporary;
    // this data is permanent.
    GroundTruthReader,
    ReplayEngine,
    EvaluationEngine,

    // Runtime trust (V3.6) — the learning subsystem made actionable. The engine
    // consumes V3.5's calibration and the user's own confirmations to decide
    // whether the platform has EARNED the right to log without asking. Ships
    // inert: AUTO_ACCEPT_ENABLED defaults to false (shadow mode — decide,
    // persist and report, never act). PromotionExecutor recommends only; it has
    // no path to switching a provider.
    TrustEvidenceReader,
    TrustAuditService,
    TrustEngine,
    PromotionExecutor,

    // Shadow rollout + trust analytics (V4.0) — observes only. Derives rollout
    // stages, health, gates, risk and timelines from append-only data through
    // the owners above; has no write access and no path to any flag.
    RolloutDataReader,
    RolloutEngine,

    // Provider governance (V4.1) — PAIRED comparison on identical inputs. The
    // shadow runner is the subsystem's only writer (append-only evidence); the
    // engine is read-only and cannot promote anything. Ships inert: shadow runs
    // require BOTH a configured challenger and a sample rate above zero.
    // Production still runs exactly ONE provider — no ensembles, no voting.
    ShadowEvaluationRunner,
    GovernanceEngine,

    // Promotion Executor (V4.2) — a PURE CONSUMER. Turns the owners' verdicts
    // (Governance recommendation + Rollout risk/gates/health/status) into an
    // auditable execution plan. Recomputes no statistic, writes nothing,
    // executes nothing — it builds a document a human acts on.
    PromotionExecutorEngine,

    // Safe Rollback (V4.3) — the mirror of the Promotion Executor and equally a
    // pure consumer. Consumes the ROLLBACK_REQUIRED gate, governance drift/
    // DEMOTE, health and risk to decide WHICH safe lever to pull and HOW.
    // Recomputes no metric, writes nothing, rolls back nothing.
    RollbackEngine,
  ],
  controllers: [VisionController, LearningController, RolloutController, GovernanceController, PromotionController, RollbackController],
  exports: [VisionScanService],
})
export class VisionModule {}
