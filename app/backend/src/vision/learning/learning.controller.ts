import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { EvaluationEngine } from './evaluation.engine';

/**
 * Admin/eval endpoints for the learning subsystem (V3.5). Read-only by
 * construction — every route derives a report; none can mutate anything.
 *
 * Guarded with the platform's JWT guard (the only auth seam that exists
 * today). When a role system lands, these routes are the first candidates for
 * an admin role — they expose aggregate metrics, so they must never leak
 * another user's raw rows: everything returned is already aggregated.
 */
@UseGuards(JwtAuthGuard)
@Controller('vision/learning')
export class LearningController {
  constructor(private readonly engine: EvaluationEngine) {}

  @Get('summary')
  summary(@Query('days') days?: string) {
    return this.engine.summary({ days: parseDays(days) });
  }

  @Get('scorecard')
  scorecard(@Query('providerId') providerId?: string, @Query('days') days?: string) {
    if (!providerId) throw new BadRequestException('providerId is required.');
    return this.engine.scorecard(providerId, { days: parseDays(days) });
  }

  @Get('calibration')
  calibration(@Query('providerId') providerId?: string, @Query('days') days?: string) {
    if (!providerId) throw new BadRequestException('providerId is required.');
    return this.engine.calibration(providerId, { days: parseDays(days) });
  }

  @Get('comparison')
  comparison(
    @Query('incumbent') incumbent?: string,
    @Query('challenger') challenger?: string,
    @Query('days') days?: string,
  ) {
    if (!incumbent || !challenger) throw new BadRequestException('incumbent and challenger are required.');
    return this.engine.compare(incumbent, challenger, { days: parseDays(days) });
  }

  @Get('replay')
  replay(@Query('days') days?: string) {
    return this.engine.replay({ days: parseDays(days) });
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
