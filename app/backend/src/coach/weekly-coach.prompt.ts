import { CoachingContext } from '../nutrition-state/types/coaching-context';
import { renderCoachingContext } from '../nutrition-state/coaching-context.render';
import { CoachGrounding } from './types/weekly-coach';

/**
 * The Claude adapter's prompt layer (Phase 2C.1). Model-specific instructions live
 * ONLY here; the data is the model-agnostic CoachingContext rendered canonically.
 * Swapping to another model reuses `renderCoachingContext` verbatim and only
 * re-tunes this instruction text. Versioned so prompt changes are traceable.
 */
export const COACH_PROMPT_VERSION = 1;

export const COACH_SYSTEM_PROMPT = `Eres un analista nutricional serio de Vitals Fit. Recibes un CONTEXTO determinista ya calculado por la plataforma (estado, historia semanal, review y compromisos). NO recalculas nada, NO inventas datos y NO contradices el contexto.

Tu tarea: dar coaching semanal breve y accionable, en español, basado SOLO en el CONTEXTO.

Devuelve EXACTAMENTE estas cuatro líneas, con estas etiquetas, sin markdown ni texto extra:
RESUMEN: <1 frase: qué pasó esta semana>
DIAGNOSTICO: <1-2 frases: el problema principal y por qué importa>
ACCION: <1 acción concreta y específica, con cantidad o alimento>
SEGUIMIENTO: <1 frase reconociendo una mejora, o "-" si no hay>

Reglas:
- Corto y directo. Sin saludos, sin motivación genérica ("¡sigue así!"), sin emojis, sin preguntas.
- Una recomendación fuerte, no varias débiles.
- Respeta el FOCO indicado: tu DIAGNOSTICO y ACCION deben tratar ese tema.`;

/** User prompt = the canonical contract render + the platform's pre-decided focus. */
export function buildCoachUserPrompt(ctx: CoachingContext, grounding: CoachGrounding): string {
  const focus = [
    `FOCO: ${grounding.primaryReason ?? 'STEADY'}`,
    grounding.nextPriorityBasis ? `motivo=${grounding.nextPriorityBasis}` : '',
    grounding.biggestImprovement ? `mejora=${grounding.biggestImprovement}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  return `${renderCoachingContext(ctx)}\n\n${focus}`;
}

export interface ParsedCoach {
  summary: string;
  diagnosis: string;
  nextAction: string;
  optionalFollowUp: string | null;
}

/**
 * Robustly parse the 4 labeled lines. Tolerant of accents/casing/spacing. Returns
 * null if any required section (summary/diagnosis/action) is missing, so the
 * caller falls back to the deterministic coaching rather than shipping a partial.
 */
export function parseCoachResponse(raw: string): ParsedCoach | null {
  const summary = extract(raw, ['RESUMEN']);
  const diagnosis = extract(raw, ['DIAGNOSTICO', 'DIAGNÓSTICO']);
  const nextAction = extract(raw, ['ACCION', 'ACCIÓN']);
  const followUpRaw = extract(raw, ['SEGUIMIENTO']);

  if (!summary || !diagnosis || !nextAction) return null;

  const optionalFollowUp = followUpRaw && followUpRaw !== '-' ? followUpRaw : null;
  return { summary, diagnosis, nextAction, optionalFollowUp };
}

function extract(raw: string, labels: string[]): string | null {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    for (const label of labels) {
      const prefix = `${label}:`;
      if (trimmed.toUpperCase().startsWith(prefix)) {
        return trimmed.slice(prefix.length).trim() || null;
      }
    }
  }
  return null;
}
