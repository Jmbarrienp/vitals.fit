import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { GovernanceEngine } from './governance.engine';

/**
 * Provider governance API (V4.1) — read-only by construction. Every handler
 * derives a report; none can promote a provider, change configuration, or
 * mutate anything. Aggregate output only, and never a raw vendor payload:
 * shadow evidence is stored as platform-shaped detections, so there is nothing
 * vendor-specific here to leak.
 */
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

function parseDays(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new BadRequestException('days must be an integer between 1 and 3650.');
  }
  return days;
}
