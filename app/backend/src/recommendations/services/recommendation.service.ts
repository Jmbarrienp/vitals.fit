import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { BehaviorFlag, PlateauStatus, Priority, RecommendationType } from '@prisma/client';
import { AnthropicService } from '../../ai/services/anthropic.service';
import { PromptBuilderService } from '../../ai/services/prompt-builder.service';
import { ParserService } from '../../ai/services/parser.service';
import { TelemetryService } from '../../ai/services/telemetry.service';
import { CoachingContextService } from '../../nutrition-state/coaching-context.service';
import { CoachingContext } from '../../nutrition-state/types/coaching-context';
import { decideNudge } from './recommendation-engine';
import { RecommendationInput, RecommendationReason } from '../recommendation-reason';

/** What the listener persists + pushes: text plus its structured classification. */
export interface GeneratedRecommendation {
  text: string;
  reason: RecommendationReason;
  type: RecommendationType;
  priority: Priority;
}

@Injectable()
export class RecommendationService {
  private static readonly MAX_TOKENS = 250;
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly anthropic: AnthropicService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly parser: ParserService,
    private readonly coachingContext: CoachingContextService,
    private readonly telemetry: TelemetryService,
  ) {}

  async generateForUser(userId: string, trigger: string): Promise<GeneratedRecommendation> {
    const startMs = Date.now();

    let ctx: CoachingContext | undefined;
    let inputTokenApprox: number | undefined;
    let outputTokens: number | undefined;
    let cacheHit = false;
    let fallbackUsed = false;
    let errorType: string | undefined;
    // Deterministic structured decision — also the fallback when Claude is off/failing.
    let decided = decideNudge(neutralInput());
    let text = decided.message;
    let success = false;

    try {
      // The model-agnostic contract at daily depth (no history fetch per meal log).
      ctx = await this.coachingContext.build(userId, 'today');
      decided = decideNudge(contextToInput(ctx));
      text = decided.message;

      if (!this.anthropic.hasKey) {
        // No API key — ship the deterministic rule (free, swap to Claude on launch).
        success = true;
        return this.result(decided, text);
      }

      const systemPrompt = this.promptBuilder.getSystemPrompt();
      const userPrompt = this.promptBuilder.buildUserPrompt(ctx);
      inputTokenApprox = Math.ceil((systemPrompt.length + userPrompt.length) / 4);

      const response = await this.anthropic.complete({
        systemPrompt,
        userPrompt,
        maxTokens: RecommendationService.MAX_TOKENS,
      });

      outputTokens = response.usage.outputTokens;
      cacheHit = response.usage.cacheReadTokens > 0;
      // Claude phrases it; the structured reason/type/priority stay deterministic.
      text = this.parser.clean(response.text);
      success = true;

      return this.result(decided, text);
    } catch (err) {
      const isTransient =
        err instanceof Anthropic.APIConnectionError ||
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        (err instanceof Error && err.message.includes('timeout'));

      errorType = err instanceof Error ? err.constructor.name : 'UnknownError';
      fallbackUsed = isTransient;

      if (!isTransient) throw err;
      return this.result(decided, decided.message); // deterministic fallback
    } finally {
      const latencyMs = Date.now() - startMs;

      if (success) {
        this.logger.log(
          `userId=${userId} trigger=${trigger} reason=${decided.reason} latency=${latencyMs}ms ` +
            `tokens=${outputTokens} cache=${cacheHit} success=true`,
        );
      } else {
        this.logger.warn(
          `userId=${userId} trigger=${trigger} reason=${decided.reason} fallback=${fallbackUsed} ` +
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
        compactSnapshot: ctx ? toCompactSnapshot(ctx, decided.reason) : undefined,
        finalRecommendation: success || fallbackUsed ? text.slice(0, 200) : undefined,
        errorType,
      });
    }
  }

  private result(
    decided: { reason: RecommendationReason; type: RecommendationType; priority: Priority },
    text: string,
  ): GeneratedRecommendation {
    return { text, reason: decided.reason, type: decided.type, priority: decided.priority };
  }
}

/**
 * CoachingContext -> engine input. The contract's codes are value-identical to
 * the internal enums (pinned in the contract), so this cast is the one narrow
 * bridge back from the model-agnostic boundary into the typed engine.
 */
export function contextToInput(ctx: CoachingContext): RecommendationInput {
  const s = ctx.currentState;
  return {
    goal: ctx.user.goal,
    targets: { calories: ctx.targets.calories, proteinG: ctx.targets.proteinG },
    today: {
      caloriesLogged: ctx.today.caloriesLogged,
      proteinG: ctx.today.proteinG,
      mealsLogged: ctx.today.mealsLogged,
    },
    state: {
      plateauStatus: s.plateauStatus as PlateauStatus,
      behaviorFlags: s.behaviorFlags as BehaviorFlag[],
      trendStatus: s.trendStatus,
      adherenceScore: s.adherenceScore,
      adherencePct7d: s.adherencePct7d ?? 0,
      loggingStreak: s.streaks.loggingDays,
      weightTrendKgWk: s.weight.trendKgPerWeek,
      weightDataPoints: s.weight.dataPoints,
    },
  };
}

/** Empty-state input so a decision (STEADY) exists even before the context loads. */
function neutralInput(): RecommendationInput {
  return {
    goal: 'maintain',
    targets: { calories: 2000, proteinG: 150 },
    today: { caloriesLogged: 0, proteinG: 0, mealsLogged: 0 },
    state: {
      plateauStatus: 'INSUFFICIENT_DATA',
      behaviorFlags: [],
      trendStatus: null,
      adherenceScore: null,
      adherencePct7d: 100,
      loggingStreak: 0,
      weightTrendKgWk: null,
      weightDataPoints: 0,
    },
  };
}

function toCompactSnapshot(ctx: CoachingContext, reason: RecommendationReason): Record<string, unknown> {
  return {
    reason,
    contractVersion: ctx.meta.version,
    goal: ctx.user.goal,
    persona: ctx.user.persona,
    calRemaining: ctx.targets.calories - ctx.today.caloriesLogged,
    protRemaining: ctx.targets.proteinG - ctx.today.proteinG,
    mealsLogged: ctx.today.mealsLogged,
    streak: ctx.currentState.streaks.loggingDays,
    adherence7d: ctx.currentState.adherencePct7d,
    weightTrend: ctx.currentState.weight.trendKgPerWeek,
    adherenceScore: ctx.currentState.adherenceScore,
    nutritionScore: ctx.currentState.nutritionScore,
    plateauStatus: ctx.currentState.plateauStatus,
    behaviorFlags: ctx.currentState.behaviorFlags,
    trendStatus: ctx.currentState.trendStatus,
  };
}
