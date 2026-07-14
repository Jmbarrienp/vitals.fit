import { Injectable } from '@nestjs/common';
import { CoachingContext } from '../../nutrition-state/types/coaching-context';
import { renderCoachingContext } from '../../nutrition-state/coaching-context.render';

/**
 * Prompt assembly for the model adapter (Phase 2C.0). Data selection no longer
 * lives here: the user prompt body is the CANONICAL rendering of the
 * CoachingContext (the model-agnostic contract), so this service only owns the
 * INSTRUCTIONS — the one piece that is per-task, not per-model or per-schema.
 */
@Injectable()
export class PromptBuilderService {
  private static readonly SYSTEM_PROMPT = `Eres el motor de recomendaciones de Vitals Fit.
Tu función es generar UNA recomendación nutricional concreta basada en los datos del usuario.

REGLAS ESTRICTAS DE SALIDA:
- MÁXIMO 2-3 frases. NUNCA más.
- Sin saludos, sin despedidas, sin emojis, sin markdown, sin preguntas.
- Sin frases motivacionales genéricas ("¡Sigue así!", "¡Buen trabajo!").
- Texto plano, directo, accionable.
- Siempre menciona un alimento concreto o una cantidad específica.
- Si el usuario va bien, confirma qué mantener. Si va mal, di exactamente qué ajustar.
- Si hay un compromiso activo o un próximo foco, tu recomendación debe apuntar a eso.`;

  getSystemPrompt(): string {
    return PromptBuilderService.SYSTEM_PROMPT;
  }

  /** The user prompt = the contract, rendered canonically. Deterministic. */
  buildUserPrompt(ctx: CoachingContext): string {
    return renderCoachingContext(ctx);
  }
}
