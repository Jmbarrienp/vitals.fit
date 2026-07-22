import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NutritionCopilotRuntime } from './copilot.runtime';

/**
 * Copilot API (V5.0) — GET only, read-only by construction. The session is a
 * derived, versioned contract; nothing here can log a meal, change a plan, or
 * commit to anything. Actions the session recommends are performed through the
 * engines that own them (logs, recommendations, vision), never through the
 * Copilot.
 */
@UseGuards(JwtAuthGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly runtime: NutritionCopilotRuntime) {}

  /**
   * V5.1 — the DAILY session: everything the caller needs today, in the order
   * they need it, with the copy already written. This is what the app opens to.
   */
  @Get('daily')
  daily(@Request() req: { user: { id: string } }) {
    return this.runtime.daily(req.user.id);
  }

  /** The complete coordinated session (the coordination artifact, richer than `daily`). */
  @Get('session')
  session(@Request() req: { user: { id: string } }) {
    return this.runtime.session(req.user.id);
  }

  /** The lightweight projection: focus + next action only. */
  @Get('next-action')
  async nextAction(@Request() req: { user: { id: string } }) {
    const session = await this.runtime.session(req.user.id);
    return {
      version: session.meta.version,
      currentFocus: session.currentFocus,
      nextAction: session.nextAction,
      confidence: session.confidence,
    };
  }
}
