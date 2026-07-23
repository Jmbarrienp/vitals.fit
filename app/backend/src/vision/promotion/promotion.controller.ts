import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { parseDays } from '../../common/http/query-parsers';
import { PromotionExecutorEngine } from './promotion-executor.engine';
import { ApiAdminErrors } from '../../common/swagger/error-responses';

const DAYS_QUERY = { name: 'days', required: false, type: String, description: 'Lookback window in days (1–3650).' };

/**
 * Promotion plan API (V4.2) — GET only, read-only by construction. Every route
 * derives a plan (or a slice of one); none can promote a provider, change a
 * flag, or write anything. The plan is a document a human reads; these routes
 * hand it over, they do not act on it.
 */
@ApiTags('vision-promotion')
@ApiBearerAuth()
@ApiAdminErrors()
@ApiQuery(DAYS_QUERY)
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
