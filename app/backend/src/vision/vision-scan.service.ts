import { Inject, Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { FoodService } from '../food/food.service';
import { LogsService } from '../logs/logs.service';
import { VisionProviderRegistry } from './providers/provider.registry';
import { VISION_IMAGE_STORE, VisionImageStore } from './images/image-store.port';
import { validateRecognitionResult } from './providers/response-validator';
import { buildCandidates, inferMealType } from './pipeline/build-candidates';
import { buildBarcodeCandidate } from './pipeline/barcode-candidate';
import { buildLabelCandidate } from './pipeline/label-candidate';
import { parseLabel } from './pipeline/label-parser';
import { validateNutritionLabel } from './pipeline/label-validator';
import { deriveUxMode } from './pipeline/confidence';
import { BarcodeLookupProviderRegistry } from './barcode/barcode-lookup.registry';
import { OCRProviderRegistry } from './ocr/ocr-provider.registry';
import {
  VISION_EVENTS,
  VisionScanConfirmedEvent,
  VisionScanFailedEvent,
  VisionScanFallbackEvent,
  VisionScanProposedEvent,
} from './vision.events';
import {
  ScanConfirmation,
  ScanSource,
  VISION_CONTRACT_VERSION,
  VisionScanProposal,
} from './types/vision-contract';

const PROPOSAL_TTL_MS = 30 * 60 * 1000; // 30 min to confirm before lazy expiry
/**
 * Outer backstop for a provider that ignores its own deadline. It must stay
 * LOOSER than any adapter's internal timeout (Claude's is 25s), never tighter:
 * a tighter outer guard would fire first on every slow call and replace the
 * adapter's specific error with a generic one. V0's 10s was sized for the
 * fixture; a real vision call with a full image needs the headroom.
 */
const RECOGNIZE_TIMEOUT_MS = 30_000;
const SEARCH_LIMIT_PER_DETECTION = 5;
/** Outer backstop for a barcode lookup, looser than any adapter's own timeout (OpenFoodFacts' is 8s). */
const BARCODE_LOOKUP_TIMEOUT_MS = 15_000;
/** VisionScan.imageRef has no meaning for a barcode scan (no image exists); barcodeValue carries the real payload. */
const BARCODE_SCAN_IMAGE_REF_PLACEHOLDER = 'barcode-scan';
/** Outer backstop for OCR, looser than the adapter's own 25s — same discipline as RECOGNIZE_TIMEOUT_MS. */
const OCR_TIMEOUT_MS = 30_000;
/** How many catalog matches to offer as alternates when a label carries a product name. */
const LABEL_ALTERNATE_LIMIT = 3;

/**
 * The Vision scan lifecycle (Phase 2D.2 V0): CREATED -> PROCESSING -> PROPOSED ->
 * CONFIRMED -> LOGGED (or REJECTED / EXPIRED / FAILED). A CONSUMER of the food
 * catalog (`FoodService.search`, reused verbatim) and a producer FOR the existing
 * write path (`LogsService.logMeal` — the only place a LoggedMeal is created).
 * Vision never inserts into LoggedMeal itself.
 *
 * No cron: expired PROPOSED scans are swept lazily on read, matching the
 * platform's established pattern (commitments, weekly ledger backfill).
 */
@Injectable()
export class VisionScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly food: FoodService,
    private readonly logs: LogsService,
    private readonly providers: VisionProviderRegistry,
    private readonly events: EventEmitter2,
    @Inject(VISION_IMAGE_STORE) private readonly images: VisionImageStore,
    private readonly barcodeLookups: BarcodeLookupProviderRegistry,
    private readonly ocrProviders: OCRProviderRegistry,
  ) {}

  /**
   * CREATED -> PROCESSING -> PROPOSED (or FAILED on a provider error/timeout).
   *
   * `image` (V2) carries the actual captured photo. When present it is handed to
   * the image store, and the ref the store returns — never the bytes — is what
   * the scan row persists. When absent, `imageRef` is used verbatim, which keeps
   * the V0/V1 fixture path (keyword refs like `chicken-plate.jpg`) working
   * untouched: that is what lets dev, CI and the smoke run with no vendor key.
   */
  async createScan(
    userId: string,
    imageRef: string,
    source: ScanSource,
    image?: { base64: string; mimeType: string },
  ): Promise<VisionScanProposal> {
    // Store the payload BEFORE the scan row exists: a rejected image (too large,
    // wrong type) is a bad request, not a failed scan, and shouldn't leave a row.
    const storedRef = image ? await this.images.put(image.base64, image.mimeType) : null;
    const ref = storedRef ?? imageRef;

    const scan = await this.prisma.visionScan.create({
      data: { userId, source, status: 'PROCESSING', imageRef: ref, expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS) },
    });

    try {
      const provider = this.providers.active();
      const rawResult = await withTimeout(
        provider.recognize({ imageRef: ref, source, hints: { userId } }),
        RECOGNIZE_TIMEOUT_MS,
      );

      // Validation gate: no malformed provider response may reach the pipeline or
      // Nutrition. An invalid result fails safe — treated exactly like a provider error.
      const validation = validateRecognitionResult(rawResult);
      if (!validation.valid || !validation.result) {
        throw new Error(`VISION_INVALID_PROVIDER_RESPONSE: ${validation.errors.join('; ')}`);
      }
      const result = validation.result;

      const searchResultsByIndex = await Promise.all(
        result.detections.map((d) => this.food.search(d.label, SEARCH_LIMIT_PER_DETECTION, userId)),
      );
      const defaultServingByIndex = await Promise.all(
        searchResultsByIndex.map(async (results) => {
          const top = results[0];
          if (!top) return null;
          const serving = await this.prisma.servingSize.findFirst({
            where: { foodItemId: top.id, isDefault: true },
            select: { grams: true },
          });
          return serving?.grams ?? null;
        }),
      );

      const { candidates, scanConfidence } = buildCandidates(result.detections, searchResultsByIndex, defaultServingByIndex);
      const fallbackReason = candidates.length === 0 ? 'NO_DETECTIONS' : null;

      const proposal: VisionScanProposal = {
        scanId: scan.id,
        status: 'PROPOSED', // even empty candidates is a valid proposal — mode steers to manual fallback
        source,
        mode: deriveUxMode(scanConfidence.band, fallbackReason, candidates.length),
        candidates,
        scanConfidence,
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: fallbackReason },
        contractVersion: VISION_CONTRACT_VERSION,
      };

      await this.prisma.visionScan.update({
        where: { id: scan.id },
        data: {
          status: 'PROPOSED',
          providerId: result.providerId,
          providerModel: result.model,
          providerVersion: result.providerVersion,
          detections: result.detections as any,
          proposal: proposal as any,
          scanConfidence: scanConfidence.overall,
          processedAt: new Date(),
        },
      });

      this.events.emit(
        VISION_EVENTS.PROPOSED,
        new VisionScanProposedEvent(userId, scan.id, source, candidates.length, scanConfidence),
      );
      return proposal;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      await this.prisma.visionScan.update({
        where: { id: scan.id },
        data: { status: 'FAILED', failureReason: reason, processedAt: new Date() },
      });
      this.events.emit(VISION_EVENTS.FAILED, new VisionScanFailedEvent(userId, scan.id, reason));
      // A provider failure degrades to the manual flow — never a broken scan.
      return {
        scanId: scan.id,
        status: 'FAILED',
        source,
        mode: 'FALLBACK',
        candidates: [],
        scanConfidence: { overall: 0, band: 'LOW' },
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: 'PROVIDER_ERROR' },
        contractVersion: VISION_CONTRACT_VERSION,
      };
    } finally {
      // Recognition is the only consumer of the pixels — everything downstream
      // reads derived data. Release them on both paths; the ref stays on the row
      // as provenance. A durable store would keep the bytes here instead.
      if (storedRef) await this.images.discard(storedRef);
    }
  }

  /**
   * CREATED -> PROCESSING -> PROPOSED, the barcode sibling of `createScan`
   * (Phase 2D.2 V3.1). No `VisionProvider` involved: decoding already happened
   * on-device, so this method starts from a decoded barcode string, not an
   * image. Reuses the SAME `VisionScan` lifecycle, the SAME confirm/reject/
   * fallback methods, and the SAME `meal.logged` convergence — a barcode scan
   * is a different producer feeding the identical write path, never a parallel
   * nutrition system.
   *
   * Resolution order (search order §food_matching, collapsed for exact
   * identity): local exact-barcode match (global catalog + this user's own
   * custom foods) -> external lookup provider -> upsert a new global catalog
   * row on success. "Not found" is a valid, handled outcome — status stays
   * PROPOSED with empty candidates, mirroring how `createScan` treats zero
   * detections. A real lookup failure (timeout, network, malformed) falls
   * through to the same FAILED path as an image-based scan.
   */
  async createBarcodeScan(userId: string, barcode: string): Promise<VisionScanProposal> {
    const source: ScanSource = 'BARCODE';
    const scan = await this.prisma.visionScan.create({
      data: {
        userId,
        source,
        status: 'PROCESSING',
        imageRef: BARCODE_SCAN_IMAGE_REF_PLACEHOLDER,
        barcodeValue: barcode,
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS),
      },
    });

    try {
      let food = await this.food.findByBarcode(barcode, userId);
      let providerId = 'local-cache'; // no external call was made — the exact product was already ours
      let providerVersion = '1';
      let servingHintGrams: number | null = null;

      if (!food) {
        const provider = this.barcodeLookups.active();
        const lookup = await withTimeout(provider.lookup(barcode), BARCODE_LOOKUP_TIMEOUT_MS);
        providerId = lookup.providerId;
        providerVersion = lookup.providerVersion;

        if (!lookup.found || !lookup.product) {
          const proposal: VisionScanProposal = {
            scanId: scan.id,
            status: 'PROPOSED', // a decodable-but-unregistered barcode is a valid, handled outcome — not a failure
            source,
            mode: deriveUxMode('LOW', 'BARCODE_NOT_FOUND', 0),
            candidates: [],
            scanConfidence: { overall: 0, band: 'LOW' },
            suggestedMealType: inferMealType(new Date()),
            fallback: { reason: 'BARCODE_NOT_FOUND' },
            contractVersion: VISION_CONTRACT_VERSION,
          };
          await this.prisma.visionScan.update({
            where: { id: scan.id },
            data: { status: 'PROPOSED', providerId, providerVersion, proposal: proposal as any, scanConfidence: 0, processedAt: new Date() },
          });
          this.events.emit(
            VISION_EVENTS.PROPOSED,
            new VisionScanProposedEvent(userId, scan.id, source, 0, proposal.scanConfidence),
          );
          return proposal;
        }

        servingHintGrams = lookup.product.servingGrams;
        food = await this.food.upsertFromBarcode(barcode, lookup.product);
      }

      const defaultServing = await this.prisma.servingSize.findFirst({
        where: { foodItemId: food.id, isDefault: true },
        select: { grams: true },
      });
      const { candidate, scanConfidence } = buildBarcodeCandidate(
        food,
        servingHintGrams !== null ? { servingGrams: servingHintGrams } : null,
        defaultServing?.grams ?? null,
      );

      const proposal: VisionScanProposal = {
        scanId: scan.id,
        status: 'PROPOSED',
        source,
        mode: deriveUxMode(scanConfidence.band, null, 1),
        candidates: [candidate],
        scanConfidence,
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: null },
        contractVersion: VISION_CONTRACT_VERSION,
      };

      await this.prisma.visionScan.update({
        where: { id: scan.id },
        data: {
          status: 'PROPOSED',
          providerId,
          providerVersion,
          proposal: proposal as any,
          scanConfidence: scanConfidence.overall,
          processedAt: new Date(),
        },
      });

      this.events.emit(VISION_EVENTS.PROPOSED, new VisionScanProposedEvent(userId, scan.id, source, 1, scanConfidence));
      return proposal;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      await this.prisma.visionScan.update({
        where: { id: scan.id },
        data: { status: 'FAILED', failureReason: reason, processedAt: new Date() },
      });
      this.events.emit(VISION_EVENTS.FAILED, new VisionScanFailedEvent(userId, scan.id, reason));
      // Same degradation contract as createScan: a lookup failure (timeout,
      // network, malformed response) never traps the user — it hands back a
      // FALLBACK proposal so mobile opens manual search, barcode prefilled.
      return {
        scanId: scan.id,
        status: 'FAILED',
        source,
        mode: 'FALLBACK',
        candidates: [],
        scanConfidence: { overall: 0, band: 'LOW' },
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: 'PROVIDER_ERROR' },
        contractVersion: VISION_CONTRACT_VERSION,
      };
    }
  }

  /**
   * CREATED -> PROCESSING -> PROPOSED, the nutrition-label sibling of
   * `createScan` (Phase 2D.2 V3.2). Reuses the image transport seam and the
   * SAME scan lifecycle; confirm/reject/fallback are untouched.
   *
   * The modality's defining property: the provider TRANSCRIBES printed facts, so
   * the proposal carries `label` (the normalized nutrition facts) alongside a
   * one-off candidate. It never links the candidate to a catalog FoodItem —
   * doing so would make `LogsService.resolveItem` recompute macros from that
   * item's per-100g values and silently discard the printed numbers. Catalog
   * matches ride along as `alternates` so a swap stays a deliberate user choice.
   *
   * Pipeline: extract (provider) -> parse (pure, all normalization) -> validate
   * (pure gate) -> candidate (pure). An invalid label degrades to manual rather
   * than proposing impossible numbers.
   */
  async createLabelScan(
    userId: string,
    imageRef: string,
    image?: { base64: string; mimeType: string },
  ): Promise<VisionScanProposal> {
    const source: ScanSource = 'LABEL_OCR';
    const storedRef = image ? await this.images.put(image.base64, image.mimeType) : null;
    const ref = storedRef ?? imageRef;

    const scan = await this.prisma.visionScan.create({
      data: { userId, source, status: 'PROCESSING', imageRef: ref, expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS) },
    });

    try {
      const provider = this.ocrProviders.active();
      const extraction = await withTimeout(provider.extract({ imageRef: ref, hints: { userId } }), OCR_TIMEOUT_MS);

      // All normalization is platform-side and pure — the provider only transcribed.
      const label = parseLabel(extraction.fields, extraction.providerId);

      // Validation gate: no impossible label may reach Nutrition. Fails safe,
      // exactly like the recognition validator does for photo scans.
      const validation = validateNutritionLabel(label);
      if (!validation.valid) {
        throw new Error(`OCR_INVALID_LABEL: ${validation.errors.join('; ')}`);
      }

      // Reuse the catalog matcher — never a parallel search. Offered as alternates only.
      const alternates = label.productName
        ? (await this.food.search(label.productName, LABEL_ALTERNATE_LIMIT, userId)).map((f) => ({
            foodItemId: f.id,
            displayName: f.name,
            matchScore: f.isFavorite ? 1 : 0.75,
          }))
        : [];

      const { candidate, scanConfidence } = buildLabelCandidate(label, validation.plausibility, alternates);

      const proposal: VisionScanProposal = {
        scanId: scan.id,
        status: 'PROPOSED',
        source,
        mode: deriveUxMode(scanConfidence.band, null, 1),
        candidates: [candidate],
        scanConfidence,
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: null },
        contractVersion: VISION_CONTRACT_VERSION,
        label,
      };

      await this.prisma.visionScan.update({
        where: { id: scan.id },
        data: {
          status: 'PROPOSED',
          providerId: extraction.providerId,
          providerModel: extraction.model,
          providerVersion: extraction.providerVersion,
          // The label rides inside `proposal` (Json) — no new column, no new table.
          proposal: proposal as any,
          scanConfidence: scanConfidence.overall,
          processedAt: new Date(),
        },
      });

      this.events.emit(VISION_EVENTS.PROPOSED, new VisionScanProposedEvent(userId, scan.id, source, 1, scanConfidence));
      return proposal;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      await this.prisma.visionScan.update({
        where: { id: scan.id },
        data: { status: 'FAILED', failureReason: reason, processedAt: new Date() },
      });
      this.events.emit(VISION_EVENTS.FAILED, new VisionScanFailedEvent(userId, scan.id, reason));
      return {
        scanId: scan.id,
        status: 'FAILED',
        source,
        mode: 'FALLBACK',
        candidates: [],
        scanConfidence: { overall: 0, band: 'LOW' },
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: 'PROVIDER_ERROR' },
        contractVersion: VISION_CONTRACT_VERSION,
      };
    } finally {
      if (storedRef) await this.images.discard(storedRef);
    }
  }

  /** Read-only fetch. Sweeps this scan to EXPIRED first if its proposal window lapsed. */
  async getScan(userId: string, scanId: string): Promise<VisionScanProposal> {
    await this.sweepExpired(userId);
    const scan = await this.getOwnedScan(userId, scanId);
    if (scan.proposal) return scan.proposal as unknown as VisionScanProposal;
    return {
      scanId: scan.id,
      status: scan.status as VisionScanProposal['status'],
      source: scan.source as ScanSource,
      mode: 'FALLBACK',
      candidates: [],
      scanConfidence: { overall: 0, band: 'LOW' },
      suggestedMealType: inferMealType(new Date()),
      fallback: { reason: scan.failureReason },
      contractVersion: VISION_CONTRACT_VERSION,
    };
  }

  /**
   * The user abandoned the proposal and logged manually instead (V1). Marks the
   * scan FALLBACK_MANUAL for telemetry — it creates NO LoggedMeal (the manual flow
   * does that through the existing path). Friction can only go down: this is the
   * degradation escape hatch, never a failure.
   */
  async markFallbackManual(userId: string, scanId: string): Promise<void> {
    const scan = await this.getOwnedScan(userId, scanId);
    if (scan.status === 'LOGGED' || scan.status === 'CONFIRMED') {
      throw new BadRequestException(`Scan is ${scan.status}, cannot fall back (already committed).`);
    }
    await this.prisma.visionScan.update({
      where: { id: scanId },
      data: { status: 'FALLBACK_MANUAL', failureReason: scan.failureReason ?? 'USER_CHOSE_MANUAL' },
    });
    this.events.emit(VISION_EVENTS.FALLBACK, new VisionScanFallbackEvent(userId, scanId, scan.status));
  }

  /**
   * PROPOSED -> CONFIRMED -> LOGGED. Hands off to LogsService.logMeal — the
   * platform's single existing write path — then stamps provenance and captures
   * feedback (proposal vs what the user actually confirmed).
   */
  async confirmScan(userId: string, confirmation: ScanConfirmation) {
    await this.sweepExpired(userId);
    const scan = await this.getOwnedScan(userId, confirmation.scanId);
    if (scan.status !== 'PROPOSED') {
      throw new BadRequestException(`Scan is ${scan.status}, cannot confirm (must be PROPOSED).`);
    }
    if (confirmation.items.length === 0) {
      throw new BadRequestException('At least one item is required to confirm a scan.');
    }

    await this.prisma.visionScan.update({ where: { id: scan.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } });

    const result = await this.logs.logMeal(userId, {
      mealType: confirmation.mealType as any,
      items: confirmation.items.map((it) => ({
        foodItemId: it.foodItemId ?? undefined,
        customName: it.foodItemId ? undefined : (it.customName ?? 'Alimento'),
        quantity: it.foodItemId ? (it.grams ?? it.quantity) : it.quantity,
        unit: it.foodItemId ? 'g' : (it.unit ?? 'g'),
        calories: it.calories,
        proteinG: it.proteinG,
        carbsG: it.carbsG,
        fatG: it.fatG,
      })),
    } as any);

    const loggedMeal = await this.prisma.loggedMeal.findFirst({
      where: { dailyLog: { userId } },
      orderBy: { loggedAt: 'desc' },
    });
    if (loggedMeal) {
      await this.prisma.loggedMeal.update({ where: { id: loggedMeal.id }, data: { source: 'vision', visionScanId: scan.id } });
    }
    await this.prisma.visionScan.update({ where: { id: scan.id }, data: { status: 'LOGGED' } });

    await this.captureFeedback(scan.id, userId, scan.proposal as unknown as VisionScanProposal | null, confirmation);

    this.events.emit(
      VISION_EVENTS.CONFIRMED,
      new VisionScanConfirmedEvent(userId, scan.id, loggedMeal?.id ?? null, confirmation.items.length),
    );
    return result;
  }

  async rejectScan(userId: string, scanId: string): Promise<void> {
    const scan = await this.getOwnedScan(userId, scanId);
    if (scan.status !== 'PROPOSED') {
      throw new BadRequestException(`Scan is ${scan.status}, cannot reject (must be PROPOSED).`);
    }
    await this.prisma.visionScan.update({ where: { id: scanId }, data: { status: 'REJECTED' } });
  }

  /** Lazy expiry — no cron. Called at the start of every read/confirm, like the ledger's backfill. */
  private async sweepExpired(userId: string): Promise<void> {
    await this.prisma.visionScan.updateMany({
      where: { userId, status: 'PROPOSED', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', failureReason: 'CONFIRMATION_WINDOW_ELAPSED' },
    });
  }

  private async getOwnedScan(userId: string, scanId: string) {
    const scan = await this.prisma.visionScan.findUnique({ where: { id: scanId } });
    if (!scan) throw new NotFoundException('Scan not found.');
    if (scan.userId !== userId) throw new ForbiddenException('Scan does not belong to this user.');
    return scan;
  }

  /** One VisionFeedback row per confirmed item — the continuous-improvement corpus. */
  private async captureFeedback(
    scanId: string,
    userId: string,
    proposal: VisionScanProposal | null,
    confirmation: ScanConfirmation,
  ): Promise<void> {
    const rows = confirmation.items.map((item) => {
      const candidate = proposal?.candidates.find((c) => c.detectionIndex === item.acceptedFromCandidate) ?? null;
      const action =
        item.acceptedFromCandidate === null
          ? 'ADDED_MANUAL'
          : candidate && candidate.foodItemId === item.foodItemId
            ? candidate.portion.grams === item.grams
              ? 'ACCEPTED'
              : 'EDITED_PORTION'
            : 'SWAPPED';
      return {
        scanId,
        userId,
        detectionIndex: item.acceptedFromCandidate ?? -1,
        proposedFoodItemId: candidate?.foodItemId ?? null,
        confirmedFoodItemId: item.foodItemId,
        proposedGrams: candidate?.portion.grams ?? null,
        confirmedGrams: item.grams ?? null,
        action,
      };
    });
    if (rows.length > 0) await this.prisma.visionFeedback.createMany({ data: rows });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('VISION_RECOGNIZE_TIMEOUT')), ms)),
  ]);
}
