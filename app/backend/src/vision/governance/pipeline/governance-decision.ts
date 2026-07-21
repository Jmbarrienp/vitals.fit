import {
  DriftReport,
  GOVERNANCE_CONTRACT_VERSION,
  GovernanceAction,
  GovernanceRecommendation,
  ProviderComparisonReport,
} from '../types/governance-contract';
import { generalizes } from './paired-comparison';

/**
 * The governance decision (V4.1) — PURE, and a RECOMMENDATION only. Nothing in
 * this subsystem can change production configuration: a human flips
 * VISION_PROVIDER, and this exists so that decision rests on evidence instead
 * of intuition.
 *
 * Order matters and is deliberate. DEMOTE is evaluated BEFORE PROMOTE because
 * a drifting incumbent is a live user-facing problem, while a promising
 * challenger is an opportunity — and an opportunity must never distract from a
 * problem. HOLD sits between them: when both signals fire at once, the honest
 * answer is "something is wrong here, stop and look", not a confident swap.
 *
 * The bar for PROMOTE is deliberately high and asymmetric, matching V3.5's
 * promotion policy: a provider switch resets the challenger's calibration
 * curve, which resets auto-accept graduation for every user (V3.6). Users pay
 * for a promotion in re-earned trust; the challenger pays for it in proof.
 */

/** Below this many paired scans the comparison is an anecdote. */
export const MIN_PAIRED_SCANS = 30;
/** The challenger must not cost more than this multiple of the incumbent's latency. */
export const MAX_LATENCY_MULTIPLE = 1.5;
/** Nor this multiple of its cost per scan. */
export const MAX_TOKEN_MULTIPLE = 1.5;
/** A challenger that fails this often is not deployable whatever its accuracy. */
export const MIN_CHALLENGER_AVAILABILITY = 0.95;

export function decideGovernance(
  comparison: ProviderComparisonReport | null,
  drift: DriftReport,
  window: { from: Date; to: Date },
): GovernanceRecommendation {
  const reasons: string[] = [];
  const incumbentId = drift.providerId;
  const challengerId = comparison?.challengerId ?? null;

  const overall = comparison?.overall;
  const acrossModalities = comparison ? generalizes(comparison.perModality) : null;
  const acrossUsers = comparison ? generalizes(comparison.perUserSegment) : null;
  const ops = comparison?.operations;
  const latencyDelta =
    ops?.challengerMeanLatencyMs != null && ops?.incumbentMeanLatencyMs != null
      ? round2(ops.challengerMeanLatencyMs - ops.incumbentMeanLatencyMs)
      : null;
  const tokenDelta =
    ops?.challengerMeanTokens != null && ops?.incumbentMeanTokens != null
      ? round2(ops.challengerMeanTokens - ops.incumbentMeanTokens)
      : null;

  const build = (action: GovernanceAction): GovernanceRecommendation => ({
    contractVersion: GOVERNANCE_CONTRACT_VERSION,
    window,
    incumbentId,
    challengerId,
    action,
    reasons,
    evidence: {
      pairedScans: comparison?.pairedScans ?? 0,
      top1Delta: overall?.top1Delta ?? null,
      top1DeltaCi: overall?.top1DeltaCi ?? null,
      mcNemarZ: overall?.mcNemarZ ?? null,
      generalizesAcrossModalities: acrossModalities,
      generalizesAcrossUsers: acrossUsers,
      latencyDeltaMs: latencyDelta,
      tokenDeltaPerScan: tokenDelta,
      challengerAvailability: ops?.challengerAvailability ?? null,
      incumbentDrift: drift.verdict,
    },
    checklist: checklist(action, incumbentId, challengerId),
  });

  // ── 1. Is the incumbent itself failing? That outranks any opportunity. ──
  const drifting = drift.verdict === 'DRIFTING';
  if (drifting) reasons.push(...drift.reasons.map((r) => `incumbente '${incumbentId}' a la deriva: ${r}`));

  // ── 2. Do we have paired evidence at all? ──
  if (!comparison || comparison.pairedScans < MIN_PAIRED_SCANS) {
    reasons.push(
      comparison
        ? `evidencia pareada insuficiente: ${comparison.pairedScans}/${MIN_PAIRED_SCANS} scans con ambos proveedores`
        : 'no hay challenger con evidencia en sombra en esta ventana',
    );
    // A drifting incumbent with nothing to replace it is a DEMOTE signal: the
    // problem is real even though the remedy is not a swap.
    return build(drifting ? 'DEMOTE' : 'REQUIRE_MORE_DATA');
  }

  // ── 3. Is the challenger's advantage real, or noise? ──
  if (!overall || !overall.significant) {
    reasons.push(
      overall?.top1Delta != null
        ? `la diferencia de top-1 (${pctDelta(overall.top1Delta)}) no es estadísticamente distinguible del ruido (IC ${ci(overall.top1DeltaCi)}, McNemar z=${overall.mcNemarZ ?? 'n/d'})`
        : 'no hay suficientes desacuerdos entre proveedores para medir una diferencia',
    );
    return build(drifting ? 'DEMOTE' : 'MAINTAIN');
  }
  reasons.push(
    `el challenger '${challengerId}' supera al incumbente en top-1 por ${pctDelta(overall.top1Delta)} sobre ${comparison.pairedScans} scans PAREADOS (IC ${ci(overall.top1DeltaCi)}, McNemar z=${overall.mcNemarZ})`,
  );

  // ── 4. Does the advantage generalize, or is it one lucky slice? ──
  if (acrossModalities === false || acrossUsers === false) {
    if (acrossModalities === false) reasons.push('la ventaja NO generaliza entre modalidades — mejora en unas y regresa en otras');
    if (acrossUsers === false) reasons.push('la ventaja NO generaliza entre usuarios — parece concentrada en un segmento');
    return build('HOLD');
  }

  // ── 5. Is it deployable, and is the gain worth its price? ──
  if (ops?.challengerAvailability != null && ops.challengerAvailability < MIN_CHALLENGER_AVAILABILITY) {
    reasons.push(`disponibilidad del challenger ${pct(ops.challengerAvailability)} < ${pct(MIN_CHALLENGER_AVAILABILITY)} — más preciso pero no desplegable`);
    return build('HOLD');
  }
  if (
    ops?.challengerMeanLatencyMs != null &&
    ops?.incumbentMeanLatencyMs != null &&
    ops.challengerMeanLatencyMs > ops.incumbentMeanLatencyMs * MAX_LATENCY_MULTIPLE
  ) {
    reasons.push(`la latencia sube de ${ms(ops.incumbentMeanLatencyMs)} a ${ms(ops.challengerMeanLatencyMs)} (>${MAX_LATENCY_MULTIPLE}×) — la ganancia no compensa la espera del usuario`);
    return build('HOLD');
  }
  if (
    ops?.challengerMeanTokens != null &&
    ops?.incumbentMeanTokens != null &&
    ops.challengerMeanTokens > ops.incumbentMeanTokens * MAX_TOKEN_MULTIPLE
  ) {
    reasons.push(`el coste por scan sube de ${Math.round(ops.incumbentMeanTokens)} a ${Math.round(ops.challengerMeanTokens)} tokens (>${MAX_TOKEN_MULTIPLE}×) — evaluar si la precisión lo justifica`);
    return build('HOLD');
  }

  reasons.push('la ventaja generaliza, el challenger es desplegable, y el coste y la latencia se mantienen dentro de los límites');
  if (drifting) reasons.push('además, el incumbente está a la deriva — la promoción también resuelve un problema activo');
  return build('PROMOTE');
}

function checklist(action: GovernanceAction, incumbentId: string, challengerId: string | null): string[] {
  const base = [`☐ revisar este informe con la ventana explícita, no la de por defecto`];
  switch (action) {
    case 'PROMOTE':
      return [
        ...base,
        `☐ confirmar que '${challengerId}' está registrado y con credencial en producción`,
        `☐ correr smoke:vision y smoke:governance`,
        `☐ cambiar VISION_PROVIDER=${challengerId} y redesplegar`,
        `☐ recordar: la curva de calibración del nuevo proveedor arranca vacía — auto-accept deja de graduar hasta que acumule evidencia propia (V3.6)`,
        `☐ vigilar salud y deriva 48h`,
        `☐ plan de reversión: VISION_PROVIDER=${incumbentId}`,
      ];
    case 'DEMOTE':
      return [
        ...base,
        `☐ investigar la causa de la deriva de '${incumbentId}' (¿cambió el modelo del vendor? ¿la versión del prompt?)`,
        `☐ considerar apagar AUTO_ACCEPT_ENABLED mientras se diagnostica`,
        `☐ acumular evidencia en sombra de un challenger antes de reemplazar`,
      ];
    case 'HOLD':
      return [...base, `☐ seguir acumulando evidencia en sombra`, `☐ re-evaluar cuando la ventana cubra las modalidades y segmentos que hoy regresan`];
    case 'REQUIRE_MORE_DATA':
      return [...base, `☐ verificar SHADOW_CHALLENGER_PROVIDER y SHADOW_SAMPLE_RATE`, `☐ dejar correr hasta alcanzar ${MIN_PAIRED_SCANS} scans pareados`];
    default:
      return [...base, `☐ ninguna acción requerida — '${incumbentId}' sigue siendo la elección correcta`];
  }
}

function ci(x: { low: number; high: number } | null | undefined): string {
  return x == null ? 'n/d' : `[${pctDelta(x.low)}, ${pctDelta(x.high)}]`;
}
function pctDelta(x: number | null | undefined): string {
  return x == null ? 'n/d' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
}
function pct(x: number | null | undefined): string {
  return x == null ? 'n/d' : `${(x * 100).toFixed(1)}%`;
}
function ms(x: number): string {
  return `${Math.round(x)}ms`;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
