import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CanaryEngine } from './canary.engine';

/**
 * Canary progression API (V4.4) — GET only, read-only by construction. Every
 * route derives a recommendation (or a slice of one); none can advance traffic,
 * change a flag, or write anything. The plan is a document a human reads and
 * acts on.
 *
 * `atPercent` is the operator's stated current position (0..100; default 0 =
 * pre-rollout), since the platform persists no live canary state.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('vision')
export class CanaryController {
  constructor(private readonly engine: CanaryEngine) {}

  /** The complete, deterministic canary progression plan. */
  @Get('canary')
  plan(@Query('atPercent') atPercent?: string, @Query('days') days?: string) {
    return this.engine.plan(parsePercent(atPercent), parseDays(days));
  }

  /** The next-move recommendation with its three explained signals. */
  @Get('canary/readiness')
  readiness(@Query('atPercent') atPercent?: string, @Query('days') days?: string) {
    return this.engine.readiness(parsePercent(atPercent), parseDays(days));
  }

  /** Current and next rung, exposure, and what must hold to advance. */
  @Get('canary/stages')
  stages(@Query('atPercent') atPercent?: string, @Query('days') days?: string) {
    return this.engine.stages(parsePercent(atPercent), parseDays(days));
  }

  /** Monitoring and verification checklists. */
  @Get('canary/checklist')
  checklist(@Query('atPercent') atPercent?: string, @Query('days') days?: string) {
    return this.engine.checklist(parsePercent(atPercent), parseDays(days));
  }

  /** The full positioned ladder. */
  @Get('canary/timeline')
  timeline(@Query('atPercent') atPercent?: string, @Query('days') days?: string) {
    return this.engine.timeline(parsePercent(atPercent), parseDays(days));
  }
}

function parsePercent(raw?: string): number {
  if (raw === undefined) return 0;
  const p = Number(raw);
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new BadRequestException('atPercent must be a number between 0 and 100.');
  }
  return p;
}

function parseDays(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new BadRequestException('days must be an integer between 1 and 3650.');
  }
  return days;
}
