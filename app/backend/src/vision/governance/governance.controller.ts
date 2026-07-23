import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { parseDays } from '../../common/http/query-parsers';
import { GovernanceEngine } from './governance.engine';
import { ApiAdminErrors } from '../../common/swagger/error-responses';

const DAYS_QUERY = { name: 'days', required: false, type: String, description: 'Lookback window in days (1–3650).' };

/**
 * Provider governance API (V4.1) — read-only by construction. Every handler
 * derives a report; none can promote a provider, change configuration, or
 * mutate anything. Aggregate output only, and never a raw vendor payload:
 * shadow evidence is stored as platform-shaped detections, so there is nothing
 * vendor-specific here to leak.
 */
@ApiTags('vision-governance')
@ApiBearerAuth()
@ApiAdminErrors()
@ApiQuery(DAYS_QUERY)
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('vision/governance')
export class GovernanceController {
  constructor(private readonly engine: GovernanceEngine) {}

  /** Is shadow ingestion configured and landing? */
  @Get('shadow')
  shadow(@Query('days') days?: string) {
    return this.engine.shadowStatus(parseDays(days));
  }

  /** The paired comparison: same scans, same ground truth, both providers. */
  @Get('comparison')
  async comparison(@Query('days') days?: string) {
    const report = await this.engine.compare(parseDays(days));
    return report ?? { comparison: null, reason: 'no hay evidencia pareada en sombra en esta ventana' };
  }

  /** Is the incumbent still the provider we promoted? */
  @Get('drift')
  drift(@Query('days') days?: string) {
    return this.engine.drift(parseDays(days));
  }

  /** PROMOTE / MAINTAIN / DEMOTE / HOLD / REQUIRE_MORE_DATA — with its evidence. */
  @Get('recommendation')
  recommendation(@Query('days') days?: string) {
    return this.engine.recommend(parseDays(days));
  }
}
