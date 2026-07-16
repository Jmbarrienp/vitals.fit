import { Injectable } from '@nestjs/common';
import { GroundTruthReader } from './ground-truth.reader';
import { ReplayEngine } from './replay.engine';
import { buildScorecard } from './pipeline/metrics';
import { buildCalibrationReport } from './pipeline/calibration';
import { decidePromotion } from './pipeline/promotion';
import {
  CalibrationReport,
  EVAL_CONTRACT_VERSION,
  ProviderComparison,
  ProviderScorecard,
  ReplayReport,
} from './types/eval-contract';

/**
 * The Continuous Learning & Evaluation Engine (V3.5) — the orchestrator over
 * the four layers: ground truth (reader), evaluation (metrics + replay),
 * calibration, and promotion. Entirely READ-ONLY against production data;
 * every output is a derived, versioned, deterministic report.
 *
 * This is the permanent subsystem the platform answers provider questions
 * with — which provider, for which foods, which cuisines, which confidence
 * ranges, which users — WITHOUT changing production code. Providers come and
 * go behind their registries; the ground truth, the metric definitions and
 * the calibration interface stay.
 */

export interface EvalWindowQuery {
  from?: Date;
  to?: Date;
  days?: number;
}

const DEFAULT_WINDOW_DAYS = 90;

@Injectable()
export class EvaluationEngine {
  constructor(
    private readonly groundTruth: GroundTruthReader,
    private readonly replayEngine: ReplayEngine,
  ) {}

  /** Scorecard for one provider over one window, with its calibration error attached. */
  async scorecard(providerId: string, query: EvalWindowQuery = {}): Promise<ProviderScorecard> {
    const window = resolveWindow(query);
    const dataset = await this.groundTruth.buildDataset({ ...window, providerId });
    const card = buildScorecard(dataset, providerId);
    const calibration = buildCalibrationReport(dataset, providerId);
    return { ...card, calibrationError: calibration.expectedCalibrationError };
  }

  async calibration(providerId: string, query: EvalWindowQuery = {}): Promise<CalibrationReport> {
    const window = resolveWindow(query);
    const dataset = await this.groundTruth.buildDataset({ ...window, providerId });
    return buildCalibrationReport(dataset, providerId);
  }

  /**
   * Offline provider comparison + promotion decision. Each provider is scored
   * on its OWN production traffic in the window; the decision reports, a human
   * flips VISION_PROVIDER. Production always runs exactly one provider.
   */
  async compare(incumbentId: string, challengerId: string, query: EvalWindowQuery = {}): Promise<ProviderComparison> {
    const [incumbent, challenger] = await Promise.all([
      this.scorecard(incumbentId, query),
      this.scorecard(challengerId, query),
    ]);
    return {
      contractVersion: EVAL_CONTRACT_VERSION,
      incumbent,
      challenger,
      decision: decidePromotion(incumbent, challenger),
    };
  }

  /** Re-run the current pipeline over historical detections vs ground truth. Read-only. */
  async replay(query: EvalWindowQuery = {}): Promise<ReplayReport> {
    const window = resolveWindow(query);
    const dataset = await this.groundTruth.buildDataset(window);
    return this.replayEngine.replay(dataset);
  }

  /** How much labeled knowledge the platform has accumulated — the moat, counted. */
  async summary(query: EvalWindowQuery = {}) {
    const window = resolveWindow(query);
    const dataset = await this.groundTruth.buildDataset(window);
    const providers = [...new Set(dataset.scans.map((s) => s.providerId))].sort();
    return {
      contractVersion: EVAL_CONTRACT_VERSION,
      window: dataset.window,
      totalScans: dataset.scans.length,
      totalExamples: dataset.examples.length,
      providers,
      examplesByAction: countBy(dataset.examples, (e) => e.action),
      scansByStatus: countBy(dataset.scans, (s) => s.status),
      scansBySource: countBy(dataset.scans, (s) => s.source),
    };
  }
}

function resolveWindow(query: EvalWindowQuery): { from: Date; to: Date } {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - (query.days ?? DEFAULT_WINDOW_DAYS) * 24 * 60 * 60 * 1000);
  return { from, to };
}

function countBy<T>(xs: T[], keyOf: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of xs.map(keyOf).sort()) out[key] = (out[key] ?? 0) + 1;
  return out;
}
