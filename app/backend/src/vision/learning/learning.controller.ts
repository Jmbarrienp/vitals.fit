import { BadRequestException, Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { EvaluationEngine } from './evaluation.engine';
import { TrustAuditService } from './trust-audit.service';
import { PromotionExecutor } from './promotion.executor';

/**
 * Endpoints for the learning subsystem (V3.5). Read-only by construction —
 * every route derives a report; none can mutate anything.
 *
 * V5.3 — this controller is deliberately MIXED, so the operator gate is
 * applied per ROUTE rather than to the class: `trust` and `trust/scan/:id`
 * return the CALLER'S OWN data and must stay available to ordinary users,
 * while every platform-wide analytic (statistics, scorecards, calibration,
 * comparison, replay, promotion) is operator-only. Guarding the whole class
 * would have silently removed a user-facing feature.
 */
@UseGuards(JwtAuthGuard)
@Controller('vision/learning')
export class LearningController {
  constructor(
    private readonly engine: EvaluationEngine,
    private readonly audit: TrustAuditService,
    private readonly promotion: PromotionExecutor,
  ) {}

  // ── V3.6 trust surfaces ────────────────────────────────────────────────────

  /**
   * The caller's OWN trust state: what has graduated, what is still pending,
   * and why. Scoped to the authenticated user — this is the one trust surface
   * that returns per-user rows, so it may only ever return the caller's.
   */
  @Get('trust')
  trust(@Request() req: { user: { id: string } }) {
    return this.audit.userTrustReport(req.user.id);
  }

  /** Why the platform did (or didn't) trust itself on one scan. Ownership-checked. */
  @Get('trust/scan/:scanId')
  async trustForScan(@Request() req: { user: { id: string } }, @Param('scanId') scanId: string) {
    const rows = await this.audit.forScan(scanId);
    return rows.filter((r) => r.userId === req.user.id);
  }

  /** Platform-wide trust statistics — aggregate only, never another user's rows. */
  @UseGuards(AdminGuard)
  @Get('trust/statistics')
  trustStatistics(@Query('days') days?: string) {
    return this.audit.statistics(parseDays(days) ?? 30);
  }

  /**
   * A promotion RECOMMENDATION — never an action. Consumes V3.5's statistical
   * verdict and adds risk, impact and a human checklist. Nothing here can
   * switch a provider; that stays a human flipping VISION_PROVIDER.
   */
  @UseGuards(AdminGuard)
  @Get('promotion')
  promotionRecommendation(
    @Query('incumbent') incumbent?: string,
    @Query('challenger') challenger?: string,
    @Query('days') days?: string,
  ) {
    if (!incumbent || !challenger) throw new BadRequestException('incumbent and challenger are required.');
    return this.promotion.recommend(incumbent, challenger, parseDays(days));
  }

  /**
   * Calibration health — is this provider's confidence honest right now? The
   * auto-accept policy consumes exactly this signal, so operators need to see
   * it directly.
   */
  @UseGuards(AdminGuard)
  @Get('calibration/health')
  async calibrationHealth(@Query('providerId') providerId?: string, @Query('days') days?: string) {
    if (!providerId) throw new BadRequestException('providerId is required.');
    const report = await this.engine.calibration(providerId, { days: parseDays(days) });
    const usableBins = report.curve.bins.filter((b) => b.n >= 5).length;
    return {
      providerId,
      expectedCalibrationError: report.expectedCalibrationError,
      overconfident: report.overconfident,
      examples: report.curve.builtFrom.examples,
      usableBins,
      /** Auto-accept can only graduate through bins that have evidence. */
      autoAcceptCapable: usableBins > 0,
      bins: report.curve.bins,
    };
  }

  // ── V3.5 evaluation surfaces ───────────────────────────────────────────────

  @UseGuards(AdminGuard)
  @Get('summary')
  summary(@Query('days') days?: string) {
    return this.engine.summary({ days: parseDays(days) });
  }

  @UseGuards(AdminGuard)
  @Get('scorecard')
  scorecard(@Query('providerId') providerId?: string, @Query('days') days?: string) {
    if (!providerId) throw new BadRequestException('providerId is required.');
    return this.engine.scorecard(providerId, { days: parseDays(days) });
  }

  @UseGuards(AdminGuard)
  @Get('calibration')
  calibration(@Query('providerId') providerId?: string, @Query('days') days?: string) {
    if (!providerId) throw new BadRequestException('providerId is required.');
    return this.engine.calibration(providerId, { days: parseDays(days) });
  }

  @UseGuards(AdminGuard)
  @Get('comparison')
  comparison(
    @Query('incumbent') incumbent?: string,
    @Query('challenger') challenger?: string,
    @Query('days') days?: string,
  ) {
    if (!incumbent || !challenger) throw new BadRequestException('incumbent and challenger are required.');
    return this.engine.compare(incumbent, challenger, { days: parseDays(days) });
  }

  @UseGuards(AdminGuard)
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
