import { Injectable, Logger } from '@nestjs/common';
import { AnthropicService } from '../ai/services/anthropic.service';
import { TelemetryService } from '../ai/services/telemetry.service';
import { CoachingContextService } from '../nutrition-state/coaching-context.service';
import { buildDeterministicCoach } from './weekly-coach.builder';
import {
  COACH_PROMPT_VERSION,
  COACH_SYSTEM_PROMPT,
  buildCoachUserPrompt,
  parseCoachResponse,
} from './weekly-coach.prompt';
import { WeeklyCoachOutput, WeeklyCoachResult } from './types/weekly-coach';

/**
 * The Weekly Coach (Phase 2C.1) — the first production AI coach, wired as a
 * CONSUMER of the platform, never a source of truth.
 *
 * Flow: CoachingContext(full) -> deterministic structured coaching (grounding +
 * fallback) -> if a model is configured, ask it to REPHRASE the same grounded
 * sections -> otherwise ship the deterministic version. A model failure always
 * degrades to deterministic; the coach never breaks and never fabricates.
 *
 * Model coupling is confined to the AnthropicService adapter + the prompt module.
 * Replacing Claude with another provider changes only the adapter.
 */
@Injectable()
export class WeeklyCoachService {
  private static readonly MAX_TOKENS = 320;
  private readonly logger = new Logger(WeeklyCoachService.name);

  constructor(
    private readonly coachingContext: CoachingContextService,
    private readonly anthropic: AnthropicService,
    private readonly telemetry: TelemetryService,
  ) {}

  async getWeeklyCoaching(userId: string): Promise<WeeklyCoachResult> {
    const ctx = await this.coachingContext.build(userId, 'full');
    const deterministic = buildDeterministicCoach(ctx);

    // No completed week yet — nothing to coach on.
    if (!deterministic) return { hasCoaching: false, output: null };

    // No model configured — the deterministic coaching is the product.
    if (!this.anthropic.hasKey) return { hasCoaching: true, output: deterministic };

    const startMs = Date.now();
    let outputTokens: number | undefined;
    let cacheHit = false;
    let errorType: string | undefined;
    let output: WeeklyCoachOutput = deterministic;

    try {
      const userPrompt = buildCoachUserPrompt(ctx, deterministic.meta.grounding);
      const response = await this.anthropic.complete({
        systemPrompt: COACH_SYSTEM_PROMPT,
        userPrompt,
        maxTokens: WeeklyCoachService.MAX_TOKENS,
      });
      outputTokens = response.usage.outputTokens;
      cacheHit = response.usage.cacheReadTokens > 0;

      const parsed = parseCoachResponse(response.text);
      if (parsed) {
        // The model rephrases; the STRUCTURE, grounding and fallback stay platform-owned.
        output = {
          summary: parsed.summary,
          diagnosis: parsed.diagnosis,
          nextAction: parsed.nextAction,
          optionalFollowUp: parsed.optionalFollowUp ?? deterministic.optionalFollowUp,
          meta: { ...deterministic.meta, source: 'claude', promptVersion: COACH_PROMPT_VERSION },
        };
      } else {
        errorType = 'ParseMiss'; // malformed -> keep deterministic
      }
    } catch (err) {
      // A model outage must never break the coach: degrade to deterministic.
      errorType = err instanceof Error ? err.constructor.name : 'UnknownError';
      this.logger.warn(`weekly-coach userId=${userId} fell back to deterministic — ${errorType}`);
    } finally {
      this.telemetry.record({
        userId,
        trigger: 'weekly-coach',
        model: this.anthropic.model,
        latencyMs: Date.now() - startMs,
        success: output.meta.source === 'claude',
        fallbackUsed: output.meta.source === 'deterministic',
        outputTokens,
        cacheHit,
        compactSnapshot: { ...output.meta.grounding, coachSource: output.meta.source },
        finalRecommendation: output.summary.slice(0, 200),
        errorType,
      });
    }

    return { hasCoaching: true, output };
  }
}
