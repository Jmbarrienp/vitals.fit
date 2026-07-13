import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NutritionStateService } from './nutrition-state.service';
import { WeeklyLedgerService } from './weekly-ledger.service';
import { WeeklyReviewService } from './weekly-review.service';

@UseGuards(JwtAuthGuard)
@Controller('nutrition-state')
export class NutritionStateController {
  constructor(
    private readonly state: NutritionStateService,
    private readonly ledger: WeeklyLedgerService,
    private readonly review: WeeklyReviewService,
  ) {}

  /** Read-only compact intelligence snapshot for the mobile UI (present state). */
  @Get('intelligence')
  getIntelligence(@Request() req: { user: { id: string } }) {
    return this.state.getIntelligenceSnapshot(req.user.id);
  }

  /**
   * Weekly Behavioral Ledger — append-only historical snapshots, newest-first.
   * Backfills any newly-completed weeks on read. Historical foundation for Weekly/
   * Monthly Review, Progress Timeline and Claude Coach.
   */
  @Get('weekly')
  getWeekly(@Request() req: { user: { id: string } }, @Query('limit') limit?: string) {
    const n = limit ? Math.min(Math.max(parseInt(limit, 10) || 26, 1), 52) : 26;
    return this.ledger.getHistory(req.user.id, n);
  }

  /**
   * Weekly Review + Behavior Follow-Up — the closed-loop coaching surface. Read-only
   * projection over the ledger + recommendation lifecycle: last week's performance,
   * what improved/worsened, commitment outcomes, follow-up status, next priority.
   */
  @Get('weekly-review')
  getWeeklyReview(@Request() req: { user: { id: string } }) {
    return this.review.getReviewSnapshot(req.user.id);
  }
}
