import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The rollout subsystem's only raw I/O (V4.0). STRICTLY READ-ONLY — zero write
 * calls, proven by smoke:rollout's row-count guarantee.
 *
 * Deliberately narrow: it reads ONLY what no existing owner answers.
 * TrustAuditService owns trust statistics; GroundTruthReader owns evaluation
 * datasets; EvaluationEngine owns scorecards and calibration. This reader
 * fetches raw VisionTrustDecision rows solely for the questions those owners
 * don't ask — weekly timelines, per-slice trust aggregation, and joining
 * executed auto-accepts against UNDONE scans (false positives).
 */

export interface TrustDecisionRow {
  scanId: string;
  userId: string;
  providerId: string;
  modality: string;
  foodItemId: string | null;
  action: string;
  executed: boolean;
  trustScore: number;
  trustLevel: string;
  policyVersion: number;
  createdAt: Date;
}

@Injectable()
export class RolloutDataReader {
  constructor(private readonly prisma: PrismaService) {}

  async trustDecisions(from: Date, to: Date): Promise<TrustDecisionRow[]> {
    return this.prisma.visionTrustDecision.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
      select: {
        scanId: true,
        userId: true,
        providerId: true,
        modality: true,
        foodItemId: true,
        action: true,
        executed: true,
        trustScore: true,
        trustLevel: true,
        policyVersion: true,
        createdAt: true,
      },
    });
  }

  /** Scan ids that ended UNDONE in the window — the false-positive join key. */
  async undoneScanIds(from: Date, to: Date): Promise<Set<string>> {
    const rows = await this.prisma.visionScan.findMany({
      where: { status: 'UNDONE', createdAt: { gte: from, lte: to } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }
}
