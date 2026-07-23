import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { parseDays } from '../../common/http/query-parsers';
import { RollbackEngine } from './rollback.engine';
import { ApiAdminErrors } from '../../common/swagger/error-responses';

const DAYS_QUERY = { name: 'days', required: false, type: String, description: 'Lookback window in days (1–3650).' };

/**
 * Safe rollback plan API (V4.3) — GET only, read-only by construction. Every
 * route derives a plan (or a slice of one); none can disable a flag, restore a
 * provider, or write anything. The plan is a document a human reads and acts
 * on; these routes hand it over, they do not act on it.
 */
@ApiTags('vision-rollback')
@ApiBearerAuth()
@ApiAdminErrors()
@ApiQuery(DAYS_QUERY)
@UseGuards(JwtAuthGuard, AdminGuard)
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
