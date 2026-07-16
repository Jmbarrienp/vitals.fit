import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VisionProviderRegistry } from '../providers/provider.registry';
import { EvaluationEngine } from './evaluation.engine';
import { ProviderComparison } from './types/eval-contract';
import { PromotionRecommendation, PromotionRisk, TRUST_POLICY_VERSION } from './types/trust-contract';

/**
 * Subsystem 3 (V3.6) — the Provider Promotion Executor. The name is aspirational
 * on purpose: it executes NOTHING. It consumes V3.5's `PromotionDecision`
 * (which it never recomputes — the statistics live there and only there) and
 * dresses the verdict with the operational context a human needs: what the
 * evidence is, what the risk is, what would change, and what to check before
 * flipping a switch.
 *
 * Provider promotion stays offline and human-approved. This class has no write
 * access to configuration and no reference to anything that could switch a
 * provider — the registry is injected READ-ONLY, to answer "is the challenger
 * even registered?" and "what is actually running right now?".
 *
 * The reason is not caution for its own sake. Production runs exactly ONE
 * provider; a switch changes every future user's experience at once, invalidates
 * the incumbent's calibration curve, and resets the trust the auto-accept policy
 * depends on. That decision belongs to a human reading evidence, not to a cron.
 */
@Injectable()
export class PromotionExecutor {
  constructor(
    private readonly evaluation: EvaluationEngine,
    private readonly providers: VisionProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  async recommend(incumbentId: string, challengerId: string, days?: number): Promise<PromotionRecommendation> {
    const comparison = await this.evaluation.compare(incumbentId, challengerId, { days });
    return this.buildRecommendation(comparison);
  }

  /** PURE given the comparison + registry state — same evidence, same recommendation. */
  buildRecommendation(comparison: ProviderComparison): PromotionRecommendation {
    const { incumbent, challenger, decision } = comparison;
    const challengerRegistered = !!this.providers.get(challenger.providerId);
    const activeProviderId = this.config.get<string>('VISION_PROVIDER', 'fixture');
    const recommend = decision.verdict === 'PROMOTE_CHALLENGER' && challengerRegistered;

    const evidence = [
      ...decision.reasons,
      `muestra: incumbente ${incumbent.sampleSizes.scans} scans / ${incumbent.sampleSizes.examples} ejemplos · challenger ${challenger.sampleSizes.scans} / ${challenger.sampleSizes.examples}`,
      `top-1: ${pct(incumbent.top1Accuracy)} -> ${pct(challenger.top1Accuracy)}`,
      `error de porción (mediana): ${pct(incumbent.medianPortionErrorPct)} -> ${pct(challenger.medianPortionErrorPct)}`,
      `tasa de fallo: ${pct(incumbent.failureRate)} -> ${pct(challenger.failureRate)}`,
      `error de calibración (ECE): ${pct(incumbent.calibrationError)} -> ${pct(challenger.calibrationError)}`,
      `latencia media: ${ms(incumbent.meanLatencyMs)} -> ${ms(challenger.meanLatencyMs)}`,
      `tokens por scan: ${num(incumbent.meanTokensPerScan)} -> ${num(challenger.meanTokensPerScan)}`,
    ];

    const { risk, riskFactors } = assessRisk(comparison, challengerRegistered, activeProviderId);

    return {
      policyVersion: TRUST_POLICY_VERSION,
      incumbentId: incumbent.providerId,
      challengerId: challenger.providerId,
      verdict: decision.verdict,
      recommend,
      explanation: explain(decision.verdict, challengerRegistered, incumbent.providerId, challenger.providerId),
      evidence,
      risk,
      riskFactors,
      impact: impacts(comparison, activeProviderId),
      checklist: checklist(comparison, challengerRegistered, activeProviderId),
      challengerRegistered,
      activeProviderId,
    };
  }
}

function explain(verdict: string, registered: boolean, incumbentId: string, challengerId: string): string {
  if (!registered) {
    return `'${challengerId}' no está registrado en el VisionProviderRegistry: aunque los números lo respalden, nadie podría activarlo sin desplegar primero el adapter.`;
  }
  switch (verdict) {
    case 'PROMOTE_CHALLENGER':
      return `Los datos respaldan promover '${challengerId}' sobre '${incumbentId}': gana en top-1 con significancia estadística y no regresa en porción ni en fallos. La decisión final es humana — este informe no cambia nada.`;
    case 'KEEP_INCUMBENT':
      return `'${incumbentId}' sigue siendo el proveedor correcto. El challenger no superó la barra, y en ausencia de evidencia el incumbente se queda: cambiar de proveedor cuesta confianza del usuario, invalida la curva de calibración y reinicia la graduación de auto-accept.`;
    default:
      return `No hay evidencia suficiente para decidir entre '${incumbentId}' y '${challengerId}'. Acumular tráfico real es el siguiente paso — no una opinión sobre cuál "se siente mejor".`;
  }
}

function assessRisk(
  comparison: ProviderComparison,
  registered: boolean,
  activeProviderId: string,
): { risk: PromotionRisk; riskFactors: string[] } {
  const { incumbent, challenger, decision } = comparison;
  const factors: string[] = [];
  let risk: PromotionRisk = 'LOW';

  if (!registered) {
    factors.push(`el challenger no está registrado — promoverlo requiere desplegar código, no solo cambiar config`);
    risk = 'HIGH';
  }
  if (decision.verdict === 'INSUFFICIENT_DATA') {
    factors.push('muestra insuficiente: cualquier cambio sería una apuesta, no una decisión');
    risk = 'HIGH';
  }
  if (challenger.calibrationError != null && incumbent.calibrationError != null && challenger.calibrationError > incumbent.calibrationError) {
    factors.push(`el challenger está peor calibrado (ECE ${pct(challenger.calibrationError)} vs ${pct(incumbent.calibrationError)}) — auto-accept depende de la calibración, así que la graduación se volvería más conservadora`);
    risk = risk === 'HIGH' ? 'HIGH' : 'MEDIUM';
  }
  if (challenger.meanTokensPerScan != null && incumbent.meanTokensPerScan != null && challenger.meanTokensPerScan > incumbent.meanTokensPerScan * 1.5) {
    factors.push(`coste por scan >50% mayor (${num(incumbent.meanTokensPerScan)} -> ${num(challenger.meanTokensPerScan)} tokens)`);
    risk = risk === 'HIGH' ? 'HIGH' : 'MEDIUM';
  }
  if (challenger.meanLatencyMs != null && incumbent.meanLatencyMs != null && challenger.meanLatencyMs > incumbent.meanLatencyMs * 1.5) {
    factors.push(`latencia >50% mayor (${ms(incumbent.meanLatencyMs)} -> ${ms(challenger.meanLatencyMs)})`);
    risk = risk === 'HIGH' ? 'HIGH' : 'MEDIUM';
  }
  if (activeProviderId !== incumbent.providerId) {
    factors.push(`el proveedor activo ('${activeProviderId}') no es el incumbente evaluado ('${incumbent.providerId}') — la comparación no describe lo que corre hoy en producción`);
    risk = 'HIGH';
  }
  if (factors.length === 0) factors.push('sin factores de riesgo detectados en los datos disponibles');
  return { risk, riskFactors: factors };
}

function impacts(comparison: ProviderComparison, activeProviderId: string): string[] {
  const { challenger } = comparison;
  return [
    `cada scan futuro pasaría por '${challenger.providerId}' (producción corre UN proveedor; no hay ensembles ni voting)`,
    `la curva de calibración del nuevo proveedor arranca vacía: auto-accept deja de graduar hasta que acumule evidencia propia (por diseño — la calibración es por proveedor)`,
    `la confianza YA ganada por cada usuario sobre cada alimento se conserva: vive en VisionFeedback, no en el proveedor`,
    `revertir es cambiar ${activeProviderId === challenger.providerId ? 'de vuelta' : ''} una variable de entorno — sin migración, sin pérdida de datos`,
  ];
}

function checklist(comparison: ProviderComparison, registered: boolean, activeProviderId: string): string[] {
  const { challenger, incumbent } = comparison;
  return [
    registered
      ? `✓ '${challenger.providerId}' está registrado en el VisionProviderRegistry`
      : `☐ registrar y desplegar el adapter de '${challenger.providerId}'`,
    `☐ confirmar que la key/credencial del proveedor está en el entorno de producción`,
    `☐ correr el harness sintético (npm run smoke:vision) y la comparación (npm run eval:vision -- --compare=${incumbent.providerId},${challenger.providerId})`,
    `☐ revisar este informe con la ventana de evaluación explícita (no la de por defecto)`,
    `☐ cambiar VISION_PROVIDER=${challenger.providerId} (activo hoy: '${activeProviderId}') y redesplegar`,
    `☐ vigilar la tasa de fallo y la salud de calibración durante 48h`,
    `☐ plan de reversión: VISION_PROVIDER=${incumbent.providerId}`,
  ];
}

function pct(x: number | null): string {
  return x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;
}
function ms(x: number | null): string {
  return x == null ? 'n/d' : `${Math.round(x)}ms`;
}
function num(x: number | null): string {
  return x == null ? 'n/d' : String(Math.round(x));
}
