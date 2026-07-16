import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrustEvidence } from './types/trust-contract';

/**
 * The Runtime Trust Engine's only evidence I/O (V3.6). STRICTLY READ-ONLY:
 * zero write calls, asserted by the smoke suite's row-count guarantee.
 *
 * It reads VisionFeedback — the same corpus V0 has been writing since day one
 * and V3.5 reads as ground truth — but asks a different question: not "how good
 * is this provider?" (aggregate, offline) but "has THIS user, for THIS food,
 * through THIS modality, earned the platform the right to act without asking?"
 * (specific, runtime). Same corpus, different question, no duplication: the
 * V3.5 GroundTruthReader builds evaluation datasets, this builds a trust claim.
 */

/** Actions that count as a clean confirmation — the user took the proposal as offered. */
const CONFIRMING_ACTIONS = ['ACCEPTED'];
/** Actions that mean the platform was close but wrong. */
const CORRECTING_ACTIONS = ['EDITED_PORTION', 'SWAPPED'];
/** V3.6 — the platform acted on its own and the user reverted it. */
const UNDO_ACTION = 'UNDONE';

@Injectable()
export class TrustEvidenceReader {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evidence for one (user, food, modality). `modality` is the scan source,
   * except that a restaurant-context photo is its own modality: someone else's
   * kitchen is not the user's own, and trust earned at home must not silently
   * transfer to a restaurant plate.
   */
  async evidenceFor(userId: string, foodItemId: string | null, modality: string): Promise<TrustEvidence> {
    const empty: TrustEvidence = {
      userId,
      foodItemId,
      modality,
      confirmations: 0,
      corrections: 0,
      undos: 0,
      lastConfirmedAt: null,
      lastUndoAt: null,
      userTotalConfirmations: 0,
    };
    // An unmatched detection (one-off item) has no stable key to accumulate
    // trust against — it can never graduate, by construction.
    if (!foodItemId) return empty;

    try {
      const [rows, userTotalConfirmations] = await Promise.all([
        this.prisma.visionFeedback.findMany({
          where: {
            userId,
            confirmedFoodItemId: foodItemId,
            scan: { source: modality === 'RESTAURANT' ? 'PHOTO' : modality },
          },
          orderBy: { createdAt: 'desc' },
          select: { action: true, createdAt: true, scan: { select: { proposal: true } } },
        }),
        this.prisma.visionFeedback.count({ where: { userId, action: { in: CONFIRMING_ACTIONS } } }),
      ]);

      // Restaurant photos and home photos share a source; the proposal's
      // restaurant block is what separates them.
      const scoped = rows.filter((r) => {
        const isRestaurant = !!(r.scan?.proposal as { restaurant?: unknown } | null)?.restaurant;
        return modality === 'RESTAURANT' ? isRestaurant : !isRestaurant;
      });

      const confirmations = scoped.filter((r) => CONFIRMING_ACTIONS.includes(r.action));
      const undos = scoped.filter((r) => r.action === UNDO_ACTION);

      return {
        ...empty,
        confirmations: confirmations.length,
        corrections: scoped.filter((r) => CORRECTING_ACTIONS.includes(r.action)).length,
        undos: undos.length,
        lastConfirmedAt: confirmations[0]?.createdAt ?? null,
        lastUndoAt: undos[0]?.createdAt ?? null,
        userTotalConfirmations,
      };
    } catch {
      // Trust is an enhancement over the V1 flow: failing to read evidence must
      // degrade to "no trust" (ask the user), never fail the scan.
      return empty;
    }
  }
}
