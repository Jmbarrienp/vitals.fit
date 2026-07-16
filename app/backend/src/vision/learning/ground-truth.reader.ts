import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VisionScanProposal } from '../types/vision-contract';
import { EVAL_CONTRACT_VERSION, GroundTruthDataset, GroundTruthExample, ScanOutcome } from './types/eval-contract';

/**
 * Layer 1 of the learning system (V3.5): assembles the labeled dataset from
 * corpora the platform ALREADY owns — VisionScan (what was proposed, by which
 * provider, with what confidence) joined with VisionFeedback (what the user,
 * the only supervisor, actually confirmed). STRICTLY READ-ONLY: this class
 * contains zero write calls, and the smoke suite asserts row counts are
 * untouched after a full evaluation pass.
 *
 * Nothing here is a new collection mechanism. V0 built the feedback capture,
 * V3.3 added method attribution, V3.5 finally reads all of it as ground truth.
 */

/** Terminal statuses — a PROCESSING/PROPOSED scan is not an outcome yet. */
const TERMINAL_STATUSES = ['LOGGED', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED', 'FALLBACK_MANUAL'];
/** Failure reasons attributable to the provider, for the availability metric. */
const PROVIDER_FAILURE_PATTERNS = ['VISION_PROVIDER', 'VISION_RECOGNIZE_TIMEOUT', 'VISION_INVALID_PROVIDER_RESPONSE'];

export interface DatasetWindow {
  from: Date;
  to: Date;
  providerId?: string | null;
}

@Injectable()
export class GroundTruthReader {
  constructor(private readonly prisma: PrismaService) {}

  async buildDataset(window: DatasetWindow): Promise<GroundTruthDataset> {
    const scans = await this.prisma.visionScan.findMany({
      where: {
        createdAt: { gte: window.from, lte: window.to },
        status: { in: TERMINAL_STATUSES },
        ...(window.providerId ? { providerId: window.providerId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    const scanIds = scans.map((s) => s.id);
    const feedback = scanIds.length
      ? await this.prisma.visionFeedback.findMany({
          where: { scanId: { in: scanIds } },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    const scansById = new Map(scans.map((s) => [s.id, s]));
    const confirmedCounts = new Map<string, number>();
    for (const f of feedback) confirmedCounts.set(f.scanId, (confirmedCounts.get(f.scanId) ?? 0) + 1);

    const examples: GroundTruthExample[] = feedback.map((f) => {
      const scan = scansById.get(f.scanId)!;
      const proposal = scan.proposal as unknown as VisionScanProposal | null;
      const candidate = proposal?.candidates?.find((c) => c.detectionIndex === f.detectionIndex) ?? null;
      return {
        scanId: f.scanId,
        userId: f.userId,
        providerId: scan.providerId ?? 'unknown',
        providerVersion: scan.providerVersion ?? null,
        source: scan.source,
        detectionIndex: f.detectionIndex,
        action: f.action,
        proposedFoodItemId: f.proposedFoodItemId,
        confirmedFoodItemId: f.confirmedFoodItemId,
        proposedGrams: f.proposedGrams,
        confirmedGrams: f.confirmedGrams,
        proposedMethod: (f as { proposedMethod?: string | null }).proposedMethod ?? null,
        candidateConfidence: candidate?.confidence?.overall ?? null,
        alternateFoodItemIds: candidate?.alternates?.map((a) => a.foodItemId) ?? [],
        foodName: candidate?.displayName ?? null,
        cuisineCategory: proposal?.restaurant?.category ?? null,
        confirmedAt: scan.confirmedAt,
      };
    });

    const outcomes: ScanOutcome[] = scans.map((s) => {
      const proposal = s.proposal as unknown as VisionScanProposal | null;
      return {
        scanId: s.id,
        userId: s.userId,
        providerId: s.providerId ?? 'unknown',
        source: s.source,
        status: s.status,
        failureReason: s.failureReason,
        scanConfidence: s.scanConfidence,
        latencyMs: (s as { latencyMs?: number | null }).latencyMs ?? null,
        tokensIn: (s as { tokensIn?: number | null }).tokensIn ?? null,
        tokensOut: (s as { tokensOut?: number | null }).tokensOut ?? null,
        proposedCandidateCount: proposal?.candidates?.length ?? null,
        confirmedItemCount: confirmedCounts.get(s.id) ?? 0,
        hadRestaurantContext: !!proposal?.restaurant,
        createdAt: s.createdAt,
      };
    });

    return {
      contractVersion: EVAL_CONTRACT_VERSION,
      window: { from: window.from, to: window.to },
      providerId: window.providerId ?? null,
      examples,
      scans: outcomes,
    };
  }
}

/** Shared with the metrics layer: is this failure the provider's fault? */
export function isProviderFailure(failureReason: string | null): boolean {
  if (!failureReason) return false;
  return PROVIDER_FAILURE_PATTERNS.some((p) => failureReason.includes(p));
}
