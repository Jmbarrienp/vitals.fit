import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RollbackEngine } from './rollback.engine';

/**
 * Safe rollback plan API (V4.3) — GET only, read-only by construction. Every
 * route derives a plan (or a slice of one); none can disable a flag, restore a
 * provider, or write anything. The plan is a document a human reads and acts
 * on; these routes hand it over, they do not act on it.
 */
@UseGuards(JwtAuthGuard)
@Controller('vision')
export class RollbackController {
  constructor(private readonly engine: RollbackEngine) {}

  /** The complete, deterministic rollback execution plan. */
  @Get('rollback')
  plan(@Query('days') days?: string) {
    return this.engine.plan(parseDays(days));
  }

  /** REQUIRED / BLOCKED / NOT_REQUIRED, with target, severity, priority and reasons. */
  @Get('rollback/readiness')
  readiness(@Query('days') days?: string) {
    return this.engine.readiness(parseDays(days));
  }

  /** Verification and post-rollback checklists. */
  @Get('rollback/checklist')
  checklist(@Query('days') days?: string) {
    return this.engine.checklist(parseDays(days));
  }

  /** Monitoring plan, retry conditions and communication plan. */
  @Get('rollback/monitoring')
  monitoring(@Query('days') days?: string) {
    return this.engine.monitoring(parseDays(days));
  }

  /** The condensed summary: reason, evidence, degraded health, risk, impact. */
  @Get('rollback/summary')
  summary(@Query('days') days?: string) {
    return this.engine.summary(parseDays(days));
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
