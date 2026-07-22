import { ModalityRollout, RolloutStage } from '../types/rollout-contract';

/**
 * Deterministic stage derivation (V4.0). PURE — config flags and append-only
 * counts in, a stage plus its reasons out. There is no "set stage" anywhere:
 * a stage is a STATEMENT ABOUT EVIDENCE, and the only way to change it is to
 * change the evidence (accumulate shadow decisions, flip a flag, sustain
 * health). Rules are ordered and exhaustive; same inputs, same stage, forever.
 */

/** Below this many shadow decisions the policy has not been observed enough to judge. */
export const MIN_SHADOW_DECISIONS = 25;
/** A modality needs at least this many would-accept shadow calls before READY means anything. */
export const MIN_SHADOW_WOULD_ACCEPT = 5;
/** Executed auto-accepts below this = LIMITED (early, watched); above FULL_MIN with health = FULL. */
export const LIMITED_MAX_EXECUTED = 50;
export const FULL_MIN_EXECUTED = 500;
/** An executed-undo share above this is a red flag at any stage. */
export const MAX_UNDO_SHARE = 0.2;

export interface StageInputs {
  modality: string;
  configEnabled: boolean; // the modality's own infra switch (provider/flag)
  autoAcceptEnabled: boolean;
  decisions: number;
  wouldAutoAccept: number;
  executed: number;
  undoneExecuted: number;
  healthGreen: boolean;
}

export function deriveStage(input: StageInputs): ModalityRollout {
  const { reasons, stage } = decide(input);
  return {
    modality: input.modality,
    stage,
    reasons,
    evidence: {
      configEnabled: input.configEnabled,
      autoAcceptEnabled: input.autoAcceptEnabled,
      decisions: input.decisions,
      wouldAutoAccept: input.wouldAutoAccept,
      executed: input.executed,
      undoneExecuted: input.undoneExecuted,
    },
  };
}

function decide(i: StageInputs): { stage: RolloutStage; reasons: string[] } {
  if (!i.configEnabled) {
    return { stage: 'DISABLED', reasons: ['la infraestructura de esta modalidad está apagada por configuración'] };
  }

  const undoShare = i.executed > 0 ? i.undoneExecuted / i.executed : null;

  if (!i.autoAcceptEnabled) {
    // Shadow world: decisions are computed and persisted but never acted on.
    if (i.decisions < MIN_SHADOW_DECISIONS) {
      return {
        stage: 'SHADOW',
        reasons: [`acumulando decisiones en sombra: ${i.decisions}/${MIN_SHADOW_DECISIONS}`],
      };
    }
    if (i.wouldAutoAccept < MIN_SHADOW_WOULD_ACCEPT) {
      return {
        stage: 'SHADOW',
        reasons: [
          `suficientes decisiones (${i.decisions}) pero solo ${i.wouldAutoAccept}/${MIN_SHADOW_WOULD_ACCEPT} habrían auto-aceptado — la política aún no tiene nada que ejecutar aquí`,
        ],
      };
    }
    if (!i.healthGreen) {
      return { stage: 'SHADOW', reasons: ['evidencia suficiente, pero la salud del rollout no está en verde'] };
    }
    return {
      stage: 'READY',
      reasons: [
        `${i.decisions} decisiones en sombra, ${i.wouldAutoAccept} habrían auto-aceptado, salud en verde — lista para habilitar`,
      ],
    };
  }

  // Live world: the flag is on and the platform can act.
  if (undoShare != null && undoShare > MAX_UNDO_SHARE) {
    return {
      stage: 'LIMITED',
      reasons: [
        `tasa de undo ${pct(undoShare)} > ${pct(MAX_UNDO_SHARE)} — contenida hasta que la confianza se recupere`,
      ],
    };
  }
  if (!i.healthGreen) {
    return { stage: 'LIMITED', reasons: ['salud del rollout fuera de verde — contenida'] };
  }
  if (i.executed < LIMITED_MAX_EXECUTED) {
    return {
      stage: 'LIMITED',
      reasons: [`${i.executed}/${LIMITED_MAX_EXECUTED} auto-aceptaciones ejecutadas — fase temprana, vigilada`],
    };
  }
  if (i.executed >= FULL_MIN_EXECUTED) {
    return { stage: 'FULL', reasons: [`${i.executed} ejecuciones con salud sostenida en verde`] };
  }
  return { stage: 'ROLLOUT', reasons: [`${i.executed} ejecuciones, salud en verde — expandiendo`] };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
