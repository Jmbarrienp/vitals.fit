import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FoodService } from '../../food/food.service';
import { Detection } from '../types/vision-contract';
import { buildCandidates } from '../pipeline/build-candidates';
import { EVAL_CONTRACT_VERSION, GroundTruthDataset, ReplayReport } from './types/eval-contract';
import { median } from './pipeline/metrics';

/**
 * Historical replay (V3.5, Layer 2) — re-runs the CURRENT deterministic
 * pipeline (matching + base portion + confidence) over STORED provider
 * detections and scores the result against user ground truth. READ-ONLY by
 * contract: its only I/O is FoodService.search and a ServingSize lookup, and
 * the smoke suite asserts zero rows change across a full replay.
 *
 * Two deliberate boundaries, both architectural:
 *
 * 1. Replay cannot re-run a PROVIDER over historical user photos — images are
 *    ephemeral BY DESIGN (privacy over replayability). What replay measures is
 *    the platform's own pipeline: "with today's catalog and today's matching,
 *    how well would the platform have served these historical detections?"
 *    Cross-PROVIDER comparison uses each provider's own-production scorecard
 *    plus the synthetic eval harness corpus (vision-eval.harness.ts).
 *
 * 2. Replay runs WITHOUT V3.3 portion priors — on purpose. A prior computed
 *    today includes the very confirmations replay is trying to predict; using
 *    it would leak the answer into the question. Replay therefore scores the
 *    UNPERSONALIZED pipeline floor, which is exactly the comparable quantity
 *    across time.
 */

const SEARCH_LIMIT_PER_DETECTION = 5; // mirrors VisionScanService

@Injectable()
export class ReplayEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly food: FoodService,
  ) {}

  async replay(dataset: GroundTruthDataset): Promise<ReplayReport> {
    const first = await this.replayOnce(dataset);
    const second = await this.replayOnce(dataset);

    return {
      contractVersion: EVAL_CONTRACT_VERSION,
      scansReplayed: first.scansReplayed,
      examplesCompared: first.examplesCompared,
      top1Accuracy: first.top1Accuracy,
      medianPortionErrorPct: first.medianPortionErrorPct,
      // The determinism guarantee, MEASURED rather than asserted: two full
      // passes over identical inputs must produce identical metrics.
      deterministic: JSON.stringify(first) === JSON.stringify(second),
    };
  }

  private async replayOnce(
    dataset: GroundTruthDataset,
  ): Promise<Omit<ReplayReport, 'contractVersion' | 'deterministic'>> {
    const photoScanIds = new Set(dataset.scans.filter((s) => s.source === 'PHOTO').map((s) => s.scanId));
    const examplesByScan = new Map<string, typeof dataset.examples>();
    for (const e of dataset.examples) {
      if (!photoScanIds.has(e.scanId) || e.action === 'ADDED_MANUAL') continue;
      const group = examplesByScan.get(e.scanId);
      if (group) group.push(e);
      else examplesByScan.set(e.scanId, [e]);
    }

    let identityHeld = 0;
    let compared = 0;
    let scansReplayed = 0;
    const portionErrors: number[] = [];

    // Ordered iteration -> deterministic accumulation.
    for (const scanId of [...examplesByScan.keys()].sort()) {
      const scan = await this.prisma.visionScan.findUnique({ where: { id: scanId }, select: { detections: true } });
      const detections = (scan?.detections as unknown as Detection[] | null) ?? null;
      if (!detections || detections.length === 0) continue;
      scansReplayed++;

      const searchResults = await Promise.all(
        detections.map((d) => this.food.search(d.label, SEARCH_LIMIT_PER_DETECTION)),
      );
      const servingDefaults = await Promise.all(
        searchResults.map(async (results) => {
          const top = results[0];
          if (!top) return null;
          const serving = await this.prisma.servingSize.findFirst({
            where: { foodItemId: top.id, isDefault: true },
            select: { grams: true },
          });
          return serving?.grams ?? null;
        }),
      );

      // Current pure pipeline, NO priors (see header: leakage) — read-only throughout.
      const { candidates } = buildCandidates(detections, searchResults, servingDefaults);

      for (const example of examplesByScan.get(scanId)!) {
        const replayed =
          candidates.find((c) => c.detectionIndex === example.detectionIndex) ??
          candidates.find((c) => c.foodItemId === example.proposedFoodItemId);
        if (!replayed || example.confirmedFoodItemId == null) continue;
        compared++;
        if (replayed.foodItemId === example.confirmedFoodItemId) identityHeld++;
        if (example.confirmedGrams != null && example.confirmedGrams > 0) {
          portionErrors.push(Math.abs(replayed.portion.grams - example.confirmedGrams) / example.confirmedGrams);
        }
      }
    }

    return {
      scansReplayed,
      examplesCompared: compared,
      top1Accuracy: compared === 0 ? null : Math.round((identityHeld / compared) * 10000) / 10000,
      medianPortionErrorPct: median(portionErrors),
    };
  }
}
