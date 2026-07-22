import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { FoodService } from '../../food/food.service';
import { EvaluationEngine } from '../learning/evaluation.engine';
import { GroundTruthReader } from '../learning/ground-truth.reader';
import { buildCandidates } from '../pipeline/build-candidates';
import { Detection, FoodCandidate, VisionScanProposal } from '../types/vision-contract';
import { buildComparisonReport } from './pipeline/paired-comparison';
import { detectDrift } from './pipeline/drift';
import { decideGovernance } from './pipeline/governance-decision';
import {
  DriftReport,
  GovernanceRecommendation,
  PairedOutcome,
  ProviderComparisonReport,
  SideOutcome,
} from './types/governance-contract';

/**
 * The Provider Governance engine (V4.1). Assembles PAIRED evidence — the same
 * scan, judged for both providers, against the same user confirmation — and
 * turns it into a comparison, a drift verdict and a human-governed
 * recommendation.
 *
 * READ-ONLY: it contains no write call. The only writer in this subsystem is
 * the shadow runner's append-only evidence table.
 *
 * It duplicates no owner's logic. Ground truth comes from GroundTruthReader,
 * scorecards and calibration from EvaluationEngine, and — critically — the
 * challenger's raw detections are turned into candidates by the SAME
 * `buildCandidates` the production pipeline uses. Scoring a challenger through
 * a different matcher would measure the matcher, not the provider.
 */

const DEFAULT_WINDOW_DAYS = 30;
const SEARCH_LIMIT_PER_DETECTION = 5; // mirrors VisionScanService

@Injectable()
export class GovernanceEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly food: FoodService,
    private readonly groundTruth: GroundTruthReader,
    private readonly evaluation: EvaluationEngine,
  ) {}

  activeProviderId(): string {
    return this.config.get<string>('VISION_PROVIDER', 'fixture');
  }

  /** The configured challenger, or the provider with the most shadow evidence. */
  async challengerId(from: Date, to: Date): Promise<string | null> {
    const configured = this.config.get<string>('SHADOW_CHALLENGER_PROVIDER', '').trim();
    if (configured.length > 0) return configured;
    const rows = await this.prisma.visionShadowRun.groupBy({
      by: ['providerId'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { providerId: true },
    });
    if (rows.length === 0) return null;
    // Deterministic: most evidence wins, ties broken alphabetically.
    return rows.sort((a, b) => b._count.providerId - a._count.providerId || a.providerId.localeCompare(b.providerId))[0]
      .providerId;
  }

  /**
   * The paired comparison. For every scan that has BOTH a shadow run and a user
   * confirmation, score the incumbent's persisted proposal and the challenger's
   * shadow detections against that same confirmation.
   */
  async compare(days = DEFAULT_WINDOW_DAYS): Promise<ProviderComparisonReport | null> {
    const { from, to } = windowOf(days);
    const incumbentId = this.activeProviderId();
    const challengerId = await this.challengerId(from, to);
    if (!challengerId) return null;

    const shadowRuns = await this.prisma.visionShadowRun.findMany({
      where: { providerId: challengerId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
    });
    if (shadowRuns.length === 0) return null;

    const dataset = await this.groundTruth.buildDataset({ from, to });
    const examplesByScan = new Map<string, typeof dataset.examples>();
    for (const e of dataset.examples) {
      const group = examplesByScan.get(e.scanId);
      if (group) group.push(e);
      else examplesByScan.set(e.scanId, [e]);
    }

    const outcomes: PairedOutcome[] = [];
    // Sorted iteration -> deterministic accumulation regardless of DB order.
    for (const run of [...shadowRuns].sort((a, b) => a.scanId.localeCompare(b.scanId))) {
      if (run.status !== 'COMPLETED') continue;
      const examples = examplesByScan.get(run.scanId);
      if (!examples || examples.length === 0) continue; // never confirmed: no label, no comparison

      const scan = await this.prisma.visionScan.findUnique({
        where: { id: run.scanId },
        select: { proposal: true, source: true, userId: true },
      });
      const proposal = scan?.proposal as unknown as VisionScanProposal | null;
      if (!proposal) continue;

      // The challenger's detections through the SAME pipeline the incumbent's
      // went through — otherwise the comparison measures matching, not vision.
      const detections = (run.detections as unknown as Detection[] | null) ?? [];
      const searchResults = await Promise.all(
        detections.map((d) => this.food.search(d.label, SEARCH_LIMIT_PER_DETECTION)),
      );
      const { candidates: challengerCandidates } = buildCandidates(detections, searchResults);

      // One outcome per confirmed item — the user's confirmation is the label.
      for (const example of examples) {
        if (!example.confirmedFoodItemId || example.action === 'ADDED_MANUAL') continue;
        const incumbentCandidate = proposal.candidates.find((c) => c.detectionIndex === example.detectionIndex) ?? null;
        outcomes.push({
          scanId: run.scanId,
          userId: run.userId,
          source: run.source,
          foodName: example.foodName,
          cuisine: example.cuisineCategory,
          confidenceBand: bandOf(example.candidateConfidence),
          confirmedFoodItemId: example.confirmedFoodItemId,
          incumbent: score(incumbentCandidate, example.confirmedFoodItemId, example.confirmedGrams),
          challenger: score(
            bestFor(challengerCandidates, example.confirmedFoodItemId),
            example.confirmedFoodItemId,
            example.confirmedGrams,
          ),
        });
      }
    }

    if (outcomes.length === 0) return null;

    const scanIds = [...new Set(outcomes.map((o) => o.scanId))];
    const incumbentScans = await this.prisma.visionScan.findMany({
      where: { id: { in: scanIds } },
      select: { latencyMs: true, tokensIn: true, tokensOut: true },
    });
    const completed = shadowRuns.filter((r) => r.status === 'COMPLETED');

    return buildComparisonReport(
      outcomes,
      incumbentId,
      challengerId,
      {
        incumbentMeanLatencyMs: mean(incumbentScans.map((s) => s.latencyMs).filter(isNum)),
        challengerMeanLatencyMs: mean(completed.map((r) => r.latencyMs).filter(isNum)),
        incumbentMeanTokens: mean(
          incumbentScans
            .filter((s) => s.tokensIn != null || s.tokensOut != null)
            .map((s) => (s.tokensIn ?? 0) + (s.tokensOut ?? 0)),
        ),
        challengerMeanTokens: mean(
          completed
            .filter((r) => r.tokensIn != null || r.tokensOut != null)
            .map((r) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0)),
        ),
        challengerAvailability: shadowRuns.length === 0 ? null : round4(completed.length / shadowRuns.length),
      },
      { from, to },
    );
  }

  /** Is the incumbent still the provider we promoted? Compares its halves. */
  async drift(days = DEFAULT_WINDOW_DAYS): Promise<DriftReport> {
    const { from, to } = windowOf(days);
    const mid = new Date(from.getTime() + (to.getTime() - from.getTime()) / 2);
    const providerId = this.activeProviderId();

    const [recentCard, recentCal, priorCard, priorCal] = await Promise.all([
      this.evaluation.scorecard(providerId, { from: mid, to }),
      this.evaluation.calibration(providerId, { from: mid, to }),
      this.evaluation.scorecard(providerId, { from, to: mid }),
      this.evaluation.calibration(providerId, { from, to: mid }),
    ]);

    return detectDrift(
      providerId,
      { scorecard: recentCard, calibration: recentCal },
      { scorecard: priorCard, calibration: priorCal },
      { from, to },
    );
  }

  /** The human-governed recommendation. Reports; never acts. */
  async recommend(days = DEFAULT_WINDOW_DAYS): Promise<GovernanceRecommendation> {
    const [comparison, drift] = await Promise.all([this.compare(days), this.drift(days)]);
    return decideGovernance(comparison, drift, windowOf(days));
  }

  /** Shadow ingestion health — how much paired evidence exists, and is it landing? */
  async shadowStatus(days = DEFAULT_WINDOW_DAYS) {
    const { from, to } = windowOf(days);
    const runs = await this.prisma.visionShadowRun.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { providerId: true, status: true, source: true, latencyMs: true },
    });
    const byProvider: Record<
      string,
      { total: number; completed: number; failed: number; meanLatencyMs: number | null }
    > = {};
    for (const providerId of [...new Set(runs.map((r) => r.providerId))].sort()) {
      const mine = runs.filter((r) => r.providerId === providerId);
      byProvider[providerId] = {
        total: mine.length,
        completed: mine.filter((r) => r.status === 'COMPLETED').length,
        failed: mine.filter((r) => r.status === 'FAILED').length,
        meanLatencyMs: mean(mine.map((r) => r.latencyMs).filter(isNum)),
      };
    }
    return {
      window: { from, to },
      activeProviderId: this.activeProviderId(),
      configuredChallenger: this.config.get<string>('SHADOW_CHALLENGER_PROVIDER', '') || null,
      sampleRate: Number(this.config.get<string>('SHADOW_SAMPLE_RATE', '0')) || 0,
      totalRuns: runs.length,
      byProvider,
      bySource: countBy(runs.map((r) => r.source)),
    };
  }
}

/**
 * How one provider's proposal did against what the user confirmed.
 * A null candidate means the provider surfaced nothing for this item at all.
 */
function score(
  candidate: FoodCandidate | null,
  confirmedFoodItemId: string,
  confirmedGrams: number | null,
): SideOutcome {
  if (!candidate) {
    return {
      top1Hit: false,
      top3Hit: false,
      swapped: false,
      missed: true,
      portionErrorPct: null,
      reportedConfidence: null,
    };
  }
  const top1Hit = candidate.foodItemId === confirmedFoodItemId;
  const inAlternates = candidate.alternates.some((a) => a.foodItemId === confirmedFoodItemId);
  const portionErrorPct =
    confirmedGrams != null && confirmedGrams > 0
      ? round4(Math.abs(candidate.portion.grams - confirmedGrams) / confirmedGrams)
      : null;

  return {
    top1Hit,
    top3Hit: top1Hit || inAlternates,
    // Swapped = it confidently proposed the WRONG food (identity error), which
    // is a different failure from proposing nothing (a miss).
    swapped: !top1Hit && candidate.foodItemId !== null,
    missed: candidate.foodItemId === null,
    portionErrorPct,
    reportedConfidence: candidate.confidence.overall,
  };
}

/**
 * The challenger's best shot at this item: the candidate that matched the
 * confirmed food if it produced one, else its top candidate. This is
 * deliberately GENEROUS to the challenger — detection indices don't align
 * across providers, so refusing to look past index 0 would score alignment
 * rather than recognition. Being generous to the challenger keeps a PROMOTE
 * recommendation conservative: the bar it clears is a fair one.
 */
function bestFor(candidates: FoodCandidate[], confirmedFoodItemId: string): FoodCandidate | null {
  return candidates.find((c) => c.foodItemId === confirmedFoodItemId) ?? candidates[0] ?? null;
}

function bandOf(confidence: number | null): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (confidence == null) return 'LOW';
  if (confidence >= 0.75) return 'HIGH';
  if (confidence >= 0.45) return 'MEDIUM';
  return 'LOW';
}

function windowOf(days: number): { from: Date; to: Date } {
  const to = new Date();
  return { from: new Date(to.getTime() - days * 86_400_000), to };
}

function isNum(x: number | null): x is number {
  return x != null && Number.isFinite(x);
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : round4(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of [...xs].sort()) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
