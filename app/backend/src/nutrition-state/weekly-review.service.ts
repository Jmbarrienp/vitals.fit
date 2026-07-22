import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addDaysUTC } from '../common/metrics/iso-week';
import { WeeklyLedgerService } from './weekly-ledger.service';
import {
  buildFollowUp,
  buildReview,
  commitmentOutcomesForWeek,
  computeRetention,
  LedgerRec,
  pickNextPriority,
} from './weekly-review.engine';
import { FollowUp, RetentionMetrics, ReviewSnapshot } from './types/weekly-review';

/** How many ledger weeks the review reasons over (bounds the read; plenty for coaching). */
const REVIEW_WINDOW_WEEKS = 12;

const EMPTY_FOLLOW_UP: FollowUp = {
  resolved: [],
  persisting: [],
  emerged: [],
  successfulInterventions: 0,
  repeatedFailures: 0,
};

const EMPTY_RETENTION: RetentionMetrics = {
  weeksTracked: 0,
  recommendationCompletionRate: null,
  commitmentAcceptanceRate: null,
  commitmentCompletionRate: null,
  weeklyConsistency: null,
  improvementVelocity: null,
  interventionSuccessRate: null,
};

/**
 * Weekly Review + Behavior Follow-Up service. A pure CONSUMER: it reads the
 * immutable Weekly Ledger (via WeeklyLedgerService, which also backfills) and the
 * recommendation lifecycle, then delegates all reasoning to the deterministic
 * engine. It writes nothing — the review is a projection, never a stored artifact,
 * and the behavior loop closes when the user commits to the surfaced next priority.
 */
@Injectable()
export class WeeklyReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WeeklyLedgerService,
  ) {}

  async getReviewSnapshot(userId: string): Promise<ReviewSnapshot> {
    // Newest-first ledger history (this also lazily appends any newly-closed weeks).
    const entries = await this.ledger.getHistory(userId, REVIEW_WINDOW_WEEKS);
    if (entries.length === 0) {
      return {
        hasReview: false,
        current: null,
        previous: null,
        followUp: EMPTY_FOLLOW_UP,
        retention: EMPTY_RETENTION,
        nextPriorities: [],
      };
    }

    // Recommendation lifecycle over the same window (+14d lead so a commitment that
    // spans the earliest week's boundary is still counted). No raw logs are read.
    const oldestWeekStart = new Date(`${entries[entries.length - 1].weekStart}T00:00:00.000Z`);
    const recRows = await this.prisma.recommendation.findMany({
      where: { userId, createdAt: { gte: addDaysUTC(oldestWeekStart, -14) } },
      select: {
        reason: true,
        status: true,
        messageForUser: true,
        createdAt: true,
        committedAt: true,
        completedAt: true,
        commitExpiresAt: true,
        respondedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const recs: LedgerRec[] = recRows.map((r) => ({
      reason: r.reason,
      status: r.status,
      message: r.messageForUser,
      createdAt: r.createdAt,
      committedAt: r.committedAt,
      completedAt: r.completedAt,
      commitExpiresAt: r.commitExpiresAt,
      respondedAt: r.respondedAt,
    }));

    const followUp = buildFollowUp(entries, recs);
    const nextPriority = pickNextPriority(followUp);

    const current = buildReview(
      entries[0],
      entries[1] ?? null,
      commitmentOutcomesForWeek(entries[0].weekStart, recs),
      nextPriority,
    );
    const previous = entries[1]
      ? buildReview(entries[1], entries[2] ?? null, commitmentOutcomesForWeek(entries[1].weekStart, recs), null)
      : null;

    const retention = computeRetention(entries, recs, followUp);

    return { hasReview: true, current, previous, followUp, retention, nextPriorities: [nextPriority] };
  }
}
