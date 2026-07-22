import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroundTruthReader } from '../learning/ground-truth.reader';
import { EvaluationEngine } from '../learning/evaluation.engine';
import { RolloutDataReader, TrustDecisionRow } from './rollout-data.reader';
import { buildTrustAnalytics, portionExamples } from './pipeline/trust-analytics';
import { buildHealthReport, isHealthGreen } from './pipeline/health';
import { buildGates } from './pipeline/gates';
import { assessRisk } from './pipeline/risk';
import { buildTimeline } from './pipeline/timeline';
import { deriveStage } from './pipeline/rollout-stage';
import { GroundTruthDataset, ProviderComparison } from '../learning/types/eval-contract';
import {
  GatesReport,
  HealthReport,
  ModalityRollout,
  RiskAssessment,
  ROLLOUT_CONTRACT_VERSION,
  RolloutStatus,
  TrustAnalytics,
  TrustTimeline,
} from './types/rollout-contract';

/**
 * The Shadow Rollout + Trust Analytics engine (V4.0). It ORCHESTRATES the
 * owners that already exist — GroundTruthReader (datasets), EvaluationEngine
 * (scorecards + calibration + comparison), the append-only trust audit rows —
 * and derives rollout intelligence through pure pipelines.
 *
 * It observes. It has no write access to anything, no path to a flag, no way
 * to switch a provider, and computes NO metric another module already owns.
 * Every report is versioned, windowed, and byte-identical for the same data.
 */

const DEFAULT_WINDOW_DAYS = 30;
const MODALITIES = ['PHOTO', 'BARCODE', 'LABEL_OCR', 'RESTAURANT'];

interface Loaded {
  window: { from: Date; to: Date };
  dataset: GroundTruthDataset;
  decisions: TrustDecisionRow[];
  undone: Set<string>;
  activeProviderId: string;
  autoAcceptEnabled: boolean;
  health: HealthReport;
  gates: GatesReport;
  comparison: ProviderComparison | null;
}

@Injectable()
export class RolloutEngine {
  constructor(
    private readonly config: ConfigService,
    private readonly groundTruth: GroundTruthReader,
    private readonly evaluation: EvaluationEngine,
    private readonly reader: RolloutDataReader,
  ) {}

  async status(days = DEFAULT_WINDOW_DAYS): Promise<RolloutStatus> {
    const loaded = await this.load(days);
    const green = isHealthGreen(loaded.health).green;

    const perModality: ModalityRollout[] = MODALITIES.map((modality) => {
      const rows = loaded.decisions.filter((d) => d.modality === modality);
      const executedRows = rows.filter((d) => d.executed);
      return deriveStage({
        modality,
        configEnabled: true, // backend infra for all four ships enabled; client flags are additive on top
        autoAcceptEnabled: loaded.autoAcceptEnabled,
        decisions: rows.length,
        wouldAutoAccept: rows.filter((d) => d.action === 'AUTO_ACCEPT').length,
        executed: executedRows.length,
        undoneExecuted: executedRows.filter((d) => loaded.undone.has(d.scanId)).length,
        healthGreen: green,
      });
    });

    // PORTION is a capability, not a decision modality: its shadow evidence is
    // the ground-truth portion corpus (clean portions = would-accepts). The
    // corpus definition is owned by trust-analytics — one filter, one truth.
    const portions = portionExamples(loaded.dataset);
    perModality.push(
      deriveStage({
        modality: 'PORTION',
        configEnabled: true,
        autoAcceptEnabled: loaded.autoAcceptEnabled,
        decisions: portions.length,
        wouldAutoAccept: portions.filter((e) => e.action !== 'EDITED_PORTION').length,
        executed: 0, // portions never execute alone — they ride whole-scan auto-accepts
        undoneExecuted: 0,
        healthGreen: green,
      }),
    );

    // Global = the most conservative non-DISABLED modality stage.
    const order = ['DISABLED', 'SHADOW', 'READY', 'LIMITED', 'ROLLOUT', 'FULL'];
    const activeStages = perModality.filter((m) => m.stage !== 'DISABLED');
    const global = activeStages.reduce(
      (acc, m) => (order.indexOf(m.stage) < order.indexOf(acc.stage) ? { stage: m.stage, holder: m.modality } : acc),
      { stage: 'FULL' as ModalityRollout['stage'], holder: '—' },
    );

    const providers = [...new Set(loaded.dataset.scans.map((s) => s.providerId))].sort();
    return {
      contractVersion: ROLLOUT_CONTRACT_VERSION,
      window: loaded.window,
      generatedFor: { activeProviderId: loaded.activeProviderId, autoAcceptEnabled: loaded.autoAcceptEnabled },
      global: {
        stage: activeStages.length === 0 ? 'SHADOW' : global.stage,
        reasons: [
          activeStages.length === 0
            ? 'sin evidencia todavía — todo en sombra'
            : `etapa global = la modalidad más conservadora (${global.holder})`,
        ],
      },
      perModality,
      perProvider: providers.map((providerId) => {
        const scans = loaded.dataset.scans.filter((s) => s.providerId === providerId).length;
        const isActive = providerId === loaded.activeProviderId;
        return {
          providerId,
          scans,
          stage: isActive ? (activeStages.length === 0 ? 'SHADOW' : global.stage) : 'SHADOW',
          reasons: [
            isActive
              ? 'proveedor activo — hereda la etapa global'
              : 'no es el proveedor activo — solo acumula evidencia histórica',
          ],
        };
      }),
    };
  }

  async trust(days = DEFAULT_WINDOW_DAYS): Promise<TrustAnalytics> {
    const loaded = await this.load(days);
    return buildTrustAnalytics(loaded.decisions, loaded.undone, loaded.dataset, loaded.window);
  }

  async health(days = DEFAULT_WINDOW_DAYS): Promise<HealthReport> {
    return (await this.load(days)).health;
  }

  async gatesReport(days = DEFAULT_WINDOW_DAYS): Promise<GatesReport> {
    return (await this.load(days)).gates;
  }

  async risk(days = DEFAULT_WINDOW_DAYS): Promise<RiskAssessment> {
    const loaded = await this.load(days);
    const scorecard = await this.evaluation.scorecard(loaded.activeProviderId, { days });
    return assessRisk(
      loaded.health,
      loaded.gates,
      scorecard,
      { autoAcceptEnabled: loaded.autoAcceptEnabled, activeProviderId: loaded.activeProviderId },
      loaded.window,
    );
  }

  async timeline(days = DEFAULT_WINDOW_DAYS): Promise<TrustTimeline> {
    const loaded = await this.load(days);
    return buildTimeline(loaded.decisions, loaded.undone, loaded.dataset, loaded.window);
  }

  private async load(days: number): Promise<Loaded> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const prevFrom = new Date(from.getTime() - days * 86_400_000);
    const window = { from, to };

    const activeProviderId = this.config.get<string>('VISION_PROVIDER', 'fixture');
    const autoAcceptEnabled = this.config.get<string>('AUTO_ACCEPT_ENABLED', 'false') === 'true';

    const [dataset, decisions, undone, scorecard, calibrationNow, calibrationPrev] = await Promise.all([
      this.groundTruth.buildDataset({ from, to }),
      this.reader.trustDecisions(from, to),
      this.reader.undoneScanIds(from, to),
      this.evaluation.scorecard(activeProviderId, { days }),
      this.evaluation.calibration(activeProviderId, { from, to }),
      this.evaluation.calibration(activeProviderId, { from: prevFrom, to: from }),
    ]);

    // Deterministic challenger: the non-active provider with the most scans.
    const counts = new Map<string, number>();
    for (const s of dataset.scans) counts.set(s.providerId, (counts.get(s.providerId) ?? 0) + 1);
    const challenger = [...counts.entries()]
      .filter(([id]) => id !== activeProviderId)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const comparison = challenger ? await this.evaluation.compare(activeProviderId, challenger, { days }) : null;

    const promotion = comparison
      ? { status: comparison.decision.verdict, detail: comparison.decision.reasons[0] ?? '' }
      : { status: 'NOT_EVALUATED', detail: 'no hay challenger con datos en esta ventana' };

    const health = buildHealthReport(dataset, decisions, undone, calibrationNow, calibrationPrev, promotion, window);
    const gates = buildGates(
      {
        health,
        shadowDecisions: decisions.length,
        shadowWouldAccept: decisions.filter((d) => d.action === 'AUTO_ACCEPT').length,
        autoAcceptEnabled,
        scorecard,
        calibration: calibrationNow,
        comparison,
      },
      window,
    );

    return { window, dataset, decisions, undone, activeProviderId, autoAcceptEnabled, health, gates, comparison };
  }
}
