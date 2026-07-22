import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PromotionExecutorEngine } from './promotion-executor.engine';

/**
 * Promotion plan API (V4.2) — GET only, read-only by construction. Every route
 * derives a plan (or a slice of one); none can promote a provider, change a
 * flag, or write anything. The plan is a document a human reads; these routes
 * hand it over, they do not act on it.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('vision')
export class PromotionController {
  constructor(private readonly engine: PromotionExecutorEngine) {}

  /** The complete, deterministic promotion execution plan. */
  @Get('promotion-plan')
  plan(@Query('days') days?: string) {
    return this.engine.plan(parseDays(days));
  }

  /** Structured checklists: validation, monitoring, approval. */
  @Get('promotion/checklist')
  checklist(@Query('days') days?: string) {
    return this.engine.checklist(parseDays(days));
  }

  /** READY / BLOCKED / NOT_APPLICABLE, with the blocking reasons and risk summary. */
  @Get('promotion/readiness')
  readiness(@Query('days') days?: string) {
    return this.engine.readiness(parseDays(days));
  }

  /** The rollout ladder and ordered execution steps. */
  @Get('promotion/execution')
  execution(@Query('days') days?: string) {
    return this.engine.execution(parseDays(days));
  }

  /** Rollback criteria and steps. */
  @Get('promotion/rollback')
  rollback(@Query('days') days?: string) {
    return this.engine.rollback(parseDays(days));
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
