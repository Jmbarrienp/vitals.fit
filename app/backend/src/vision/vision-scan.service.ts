import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { FoodService } from '../food/food.service';
import { LogsService } from '../logs/logs.service';
import { VisionProviderRegistry } from './providers/provider.registry';
import { validateRecognitionResult } from './providers/response-validator';
import { buildCandidates, inferMealType } from './pipeline/build-candidates';
import {
  VISION_EVENTS,
  VisionScanConfirmedEvent,
  VisionScanFailedEvent,
  VisionScanProposedEvent,
} from './vision.events';
import {
  ScanConfirmation,
  ScanSource,
  VISION_CONTRACT_VERSION,
  VisionScanProposal,
} from './types/vision-contract';

const PROPOSAL_TTL_MS = 30 * 60 * 1000; // 30 min to confirm before lazy expiry
const RECOGNIZE_TIMEOUT_MS = 10_000; // mirrors AnthropicService's discipline
const SEARCH_LIMIT_PER_DETECTION = 5;

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
  ) {}

  /** CREATED -> PROCESSING -> PROPOSED (or FAILED on a provider error/timeout). */
  async createScan(userId: string, imageRef: string, source: ScanSource): Promise<VisionScanProposal> {
    const scan = await this.prisma.visionScan.create({
      data: { userId, source, status: 'PROCESSING', imageRef, expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS) },
    });

    try {
      const provider = this.providers.active();
      const rawResult = await withTimeout(
        provider.recognize({ imageRef, source, hints: { userId } }),
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

      const proposal: VisionScanProposal = {
        scanId: scan.id,
        status: candidates.length > 0 ? 'PROPOSED' : 'PROPOSED', // empty candidates is still a valid proposal (manual fallback)
        source,
        candidates,
        scanConfidence,
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: candidates.length === 0 ? 'NO_DETECTIONS' : null },
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
        candidates: [],
        scanConfidence: { overall: 0, band: 'LOW' },
        suggestedMealType: inferMealType(new Date()),
        fallback: { reason: 'PROVIDER_ERROR' },
        contractVersion: VISION_CONTRACT_VERSION,
      };
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
      candidates: [],
      scanConfidence: { overall: 0, band: 'LOW' },
      suggestedMealType: inferMealType(new Date()),
      fallback: { reason: scan.failureReason },
      contractVersion: VISION_CONTRACT_VERSION,
    };
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
