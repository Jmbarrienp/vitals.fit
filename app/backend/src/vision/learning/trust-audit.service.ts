import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAcceptDecision } from './types/trust-contract';

/**
 * Subsystem 4 (V3.6) — the Trust Audit. Append-only: the ONLY writer in the
 * learning subsystem, and it writes exactly one kind of row — a record of why
 * the platform trusted (or didn't trust) itself on one scan.
 *
 * This is deliberately not "logging". An auto-accepted meal is the platform
 * acting on a user's behalf; six months later, "why is this chicken in my log?"
 * must have a complete, versioned answer: which policy, which evidence, which
 * calibrated confidence, which provider, and whether it actually acted. Rows
 * are never updated and never deleted (they cascade with their scan) — an audit
 * trail that can be rewritten is not an audit trail.
 */
@Injectable()
export class TrustAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records the decision. Fails SOFT: an audit write must never fail a scan the
   * user is waiting on — but note the ordering guarantee its caller provides,
   * which is that nothing is auto-accepted before its reason is recorded.
   */
  async record(params: {
    scanId: string;
    userId: string;
    decision: AutoAcceptDecision;
    providerId: string;
    modality: string;
    foodItemId: string | null;
    reportedConfidence: number | null;
  }): Promise<void> {
    const { decision } = params;
    try {
      await this.prisma.visionTrustDecision.create({
        data: {
          scanId: params.scanId,
          userId: params.userId,
          policyVersion: decision.policyVersion,
          action: decision.action,
          executed: decision.executed,
          trustLevel: decision.trust.level,
          trustScore: decision.trust.score,
          calibratedConfidence: decision.trust.calibratedConfidence,
          reportedConfidence: params.reportedConfidence,
          providerId: params.providerId,
          modality: params.modality,
          foodItemId: params.foodItemId,
          signals: decision.signals,
          reasons: [decision.reason, ...decision.trust.reasons],
        },
      });
    } catch {
      /* never fail a user's scan over telemetry */
    }
  }

  /** Every trust decision for one scan — the explainability surface. Read-only. */
  async forScan(scanId: string) {
    return this.prisma.visionTrustDecision.findMany({ where: { scanId }, orderBy: { createdAt: 'asc' } });
  }

  /** What this user has graduated, what is still pending, and how it's going. Read-only. */
  async userTrustReport(userId: string) {
    const rows = await this.prisma.visionTrustDecision.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const byKey = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.foodItemId ?? 'one-off'}::${r.modality}`;
      const group = byKey.get(key);
      if (group) group.push(r);
      else byKey.set(key, [r]);
    }

    const graduated: unknown[] = [];
    const pending: unknown[] = [];
    // Sorted keys -> deterministic report ordering.
    for (const key of [...byKey.keys()].sort()) {
      const latest = byKey.get(key)![0]; // rows are desc — [0] is the current state
      const entry = {
        foodItemId: latest.foodItemId,
        modality: latest.modality,
        action: latest.action,
        trustLevel: latest.trustLevel,
        trustScore: latest.trustScore,
        executed: latest.executed,
        lastReason: latest.reasons[0] ?? null,
        decidedAt: latest.createdAt,
      };
      if (latest.action === 'AUTO_ACCEPT') graduated.push(entry);
      else pending.push(entry);
    }

    return {
      userId,
      graduated,
      pending,
      statistics: {
        totalDecisions: rows.length,
        autoAccepted: rows.filter((r) => r.action === 'AUTO_ACCEPT').length,
        actuallyExecuted: rows.filter((r) => r.executed).length,
        reviewRequired: rows.filter((r) => r.action === 'REVIEW_REQUIRED').length,
        manualReview: rows.filter((r) => r.action === 'MANUAL_REVIEW').length,
      },
    };
  }

  /**
   * Platform-wide trust statistics. `shadowOnly` is the rollout signal: how many
   * decisions the policy WOULD have acted on while the flag was off.
   */
  async statistics(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.visionTrustDecision.findMany({
      where: { createdAt: { gte: from } },
      select: { action: true, executed: true, trustLevel: true, modality: true, policyVersion: true },
    });

    const countBy = <T extends string | number>(keyOf: (r: (typeof rows)[number]) => T) => {
      const out: Record<string, number> = {};
      for (const key of rows.map((r) => String(keyOf(r))).sort()) out[key] = (out[key] ?? 0) + 1;
      return out;
    };

    const wouldAutoAccept = rows.filter((r) => r.action === 'AUTO_ACCEPT');
    return {
      windowDays: days,
      totalDecisions: rows.length,
      byAction: countBy((r) => r.action),
      byTrustLevel: countBy((r) => r.trustLevel),
      byModality: countBy((r) => r.modality),
      byPolicyVersion: countBy((r) => r.policyVersion),
      autoAcceptRate: rows.length === 0 ? null : round4(wouldAutoAccept.length / rows.length),
      shadowOnly: wouldAutoAccept.filter((r) => !r.executed).length,
      executed: rows.filter((r) => r.executed).length,
    };
  }
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
