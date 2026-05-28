import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicService } from '../../ai/services/anthropic.service';
import { PromptBuilderService } from '../../ai/services/prompt-builder.service';
import { ParserService } from '../../ai/services/parser.service';
import { TelemetryService } from '../../ai/services/telemetry.service';
import { ContextBuilderService } from './context-builder.service';
import { UserSnapshot } from '../types/user-snapshot';

@Injectable()
export class RecommendationService {
  private static readonly FALLBACK = 'Sigue manteniendo tus macros del día.';
  private static readonly MAX_TOKENS = 250;
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly anthropic: AnthropicService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly parser: ParserService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly telemetry: TelemetryService,
  ) {}

  async generateForUser(userId: string, trigger: string): Promise<string> {
    const startMs = Date.now();

    let snap: UserSnapshot | undefined;
    let inputTokenApprox: number | undefined;
    let outputTokens: number | undefined;
    let cacheHit = false;
    let fallbackUsed = false;
    let errorType: string | undefined;
    let result = RecommendationService.FALLBACK;
    let success = false;

    try {
      snap = await this.contextBuilder.buildSnapshot(userId);

      if (!this.anthropic.hasKey) {
        // No API key — use local rules engine (free, swap to Claude on launch)
        result = rulesEngine(snap);
        success = true;
        return result;
      }

      const systemPrompt = this.promptBuilder.getSystemPrompt();
      const userPrompt = this.promptBuilder.buildUserPrompt(snap);
      inputTokenApprox = Math.ceil((systemPrompt.length + userPrompt.length) / 4);

      const response = await this.anthropic.complete({
        systemPrompt,
        userPrompt,
        maxTokens: RecommendationService.MAX_TOKENS,
      });

      outputTokens = response.usage.outputTokens;
      cacheHit = response.usage.cacheReadTokens > 0;
      result = this.parser.clean(response.text);
      success = true;

      return result;
    } catch (err) {
      const isTransient =
        err instanceof Anthropic.APIConnectionError ||
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        (err instanceof Error && err.message.includes('timeout'));

      errorType = err instanceof Error ? err.constructor.name : 'UnknownError';
      fallbackUsed = isTransient;

      if (!isTransient) throw err;
      return result; // FALLBACK
    } finally {
      const latencyMs = Date.now() - startMs;

      if (success) {
        this.logger.log(
          `userId=${userId} trigger=${trigger} latency=${latencyMs}ms ` +
            `tokens=${outputTokens} cache=${cacheHit} success=true`,
        );
      } else {
        this.logger.warn(
          `userId=${userId} trigger=${trigger} fallback=${fallbackUsed} ` +
            `error=${errorType ?? 'none'} latency=${latencyMs}ms`,
        );
      }

      this.telemetry.record({
        userId,
        trigger,
        model: this.anthropic.model,
        latencyMs,
        success,
        fallbackUsed,
        inputTokenApprox,
        outputTokens,
        cacheHit,
        compactSnapshot: snap ? toCompactSnapshot(snap) : undefined,
        finalRecommendation: success || fallbackUsed ? result.slice(0, 200) : undefined,
        errorType,
      });
    }
  }
}

function rulesEngine(snap: UserSnapshot): string {
  const calLogged = snap.today.caloriesLogged;
  const calTarget = snap.targets.calories;
  const calRemaining = calTarget - calLogged;
  const protRemaining = Math.round(snap.targets.proteinG - snap.today.proteinG);
  const meals = snap.today.mealsLogged;
  const streak = snap.streak.currentDays;
  const pct = calTarget > 0 ? Math.round((calLogged / calTarget) * 100) : 0;

  if (meals === 0) return 'Empieza registrando el desayuno — los primeros datos del día son los más importantes.';
  if (calLogged > calTarget + 200) return `Hoy te pasaste ${calLogged - calTarget} kcal de tu meta. Sin drama — mañana retomas el plan.`;
  if (calLogged > calTarget) return `Llegaste a tu meta calórica por hoy. Buen trabajo.`;
  if (pct >= 85 && meals >= 3) return `Estás al ${pct}% de tu meta. Casi llegas — una comida pequeña puede completar el día.`;
  if (protRemaining > 40) return `Te faltan ${protRemaining}g de proteína para hoy. Agrega una fuente proteica en tu próxima comida.`;
  if (calRemaining > 500 && meals >= 3) return `Llevas ${meals} comidas pero te quedan ${calRemaining} kcal. Considera un snack proteico.`;
  if (streak >= 14) return `${streak} días seguidos. Eso ya no es motivación — es un hábito.`;
  if (streak >= 7) return `Una semana completa trackeando. La consistencia es lo que más importa.`;
  if (snap.progress.adherencePct7d < 40) return 'Esta semana fue difícil. No necesitas ser perfecto — solo registrar un poco cada día ya ayuda.';
  if (snap.progress.weightTrendKg !== null && snap.goal === 'lose' && snap.progress.weightTrendKg < -0.1)
    return 'Tus datos muestran progreso en la dirección correcta. Sigue así.';
  return `Llevas ${calLogged} de ${calTarget} kcal hoy (${pct}%). Vas bien.`;
}

function toCompactSnapshot(snap: UserSnapshot): Record<string, unknown> {
  return {
    goal: snap.goal,
    persona: snap.persona,
    calRemaining: snap.targets.calories - snap.today.caloriesLogged,
    protRemaining: snap.targets.proteinG - snap.today.proteinG,
    mealsLogged: snap.today.mealsLogged,
    streak: snap.streak.currentDays,
    adherence7d: snap.progress.adherencePct7d,
    weightTrend: snap.progress.weightTrendKg,
  };
}
