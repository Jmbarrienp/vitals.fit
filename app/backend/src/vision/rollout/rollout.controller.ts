import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolloutEngine } from './rollout.engine';

/**
 * The Rollout API (V4.0) — five GET routes, all read-only by construction:
 * every handler derives a report; none can mutate anything, flip a flag, or
 * switch a provider. Aggregate data only — no route returns another user's
 * raw rows. Guarded by the platform's JWT guard (first candidates for an
 * admin role when one exists).
 */
@UseGuards(JwtAuthGuard)
@Controller('vision')
export class RolloutController {
  constructor(private readonly engine: RolloutEngine) {}

  /** Global + per-modality + per-provider rollout stages, with reasons. */
  @Get('rollout')
  rollout(@Query('days') days?: string) {
    return this.engine.status(parseDays(days));
  }

  /** Derived trust analytics — user/provider/modality/food/portion. */
  @Get('trust')
  trust(@Query('days') days?: string) {
    return this.engine.trust(parseDays(days));
  }

  /** The daily health report, plus the formal deployment gates. */
  @Get('health')
  async health(@Query('days') days?: string) {
    const d = parseDays(days);
    const [health, gates] = await Promise.all([this.engine.health(d), this.engine.gatesReport(d)]);
    return { health, gates };
  }

  /** Five-dimension deployment risk, every claim with its number. */
  @Get('risk')
  risk(@Query('days') days?: string) {
    return this.engine.risk(parseDays(days));
  }

  /** Weekly trust evolution from append-only history. */
  @Get('timeline')
  timeline(@Query('days') days?: string) {
    return this.engine.timeline(parseDays(days));
  }
}

function parseDays(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new BadRequestException('days must be an integer between 1 and 3650.');
  }
  return days;
}
