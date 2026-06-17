import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Priority, RecommendationType } from '@prisma/client';
import { AnthropicService } from '../../ai/services/anthropic.service';
import { PromptBuilderService } from '../../ai/services/prompt-builder.service';
import { ParserService } from '../../ai/services/parser.service';
import { TelemetryService } from '../../ai/services/telemetry.service';
import { ContextBuilderService } from './context-builder.service';
import { decideNudge } from './recommendation-engine';
import { RecommendationInput, RecommendationReason } from '../recommendation-reason';
import { UserSnapshot } from '../types/user-snapshot';

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
    private readonly contextBuilder: ContextBuilderService,
    private readonly telemetry: TelemetryService,
  ) {}

  async generateForUser(userId: string, trigger: string): Promise<GeneratedRecommendation> {
    const startMs = Date.now();

    let snap: UserSnapshot | undefined;
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
      snap = await this.contextBuilder.buildSnapshot(userId);
      decided = decideNudge(snapshotToInput(snap));
      text = decided.message;

      if (!this.anthropic.hasKey) {
        // No API key — ship the deterministic rule (free, swap to Claude on launch).
        success = true;
        return this.result(decided, text);
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
        compactSnapshot: snap ? toCompactSnapshot(snap, decided.reason) : undefined,
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

/** UserSnapshot → engine input. The snapshot already carries rollup-sourced state. */
export function snapshotToInput(snap: UserSnapshot): RecommendationInput {
  return {
    goal: snap.goal,
    targets: { calories: snap.targets.calories, proteinG: snap.targets.proteinG },
    today: {
      caloriesLogged: snap.today.caloriesLogged,
      proteinG: snap.today.proteinG,
      mealsLogged: snap.today.mealsLogged,
    },
    state: {
      plateauStatus: snap.state.plateauStatus,
      behaviorFlags: snap.state.behaviorFlags,
      trendStatus: snap.state.trendStatus,
      adherenceScore: snap.state.adherenceScore,
      adherencePct7d: snap.progress.adherencePct7d,
      loggingStreak: snap.streak.currentDays,
      weightTrendKgWk: snap.progress.weightTrendKg,
      // The nudge channel never makes a plan change, so weight-point count is moot here.
      weightDataPoints: snap.progress.weightTrendKg === null ? 0 : 3,
    },
  };
}

/** Empty-state input so a decision (STEADY) exists even before the snapshot loads. */
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

function toCompactSnapshot(snap: UserSnapshot, reason: RecommendationReason): Record<string, unknown> {
  return {
    reason,
    goal: snap.goal,
    persona: snap.persona,
    calRemaining: snap.targets.calories - snap.today.caloriesLogged,
    protRemaining: snap.targets.proteinG - snap.today.proteinG,
    mealsLogged: snap.today.mealsLogged,
    streak: snap.streak.currentDays,
    adherence7d: snap.progress.adherencePct7d,
    weightTrend: snap.progress.weightTrendKg,
    adherenceScore: snap.state.adherenceScore,
    nutritionScore: snap.state.nutritionScore,
    plateauStatus: snap.state.plateauStatus,
    behaviorFlags: snap.state.behaviorFlags,
    trendStatus: snap.state.trendStatus,
  };
}
