import { BadRequestException } from '@nestjs/common';

/**
 * V5.5 — extracted from six governance-family controllers (rollout, governance,
 * canary, promotion, rollback, learning), each of which had defined this exact
 * function byte-for-byte since V4.0. A duplicated validator is a duplicated
 * place to drift: one copy fixed would leave five others silently wrong. Pure,
 * so it needs no DI and is trivial to pin with a contract test.
 */
export function parseDays(raw?: string): number | undefined {
  if (raw === undefined) return undefined;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new BadRequestException('days must be an integer between 1 and 3650.');
  }
  return days;
}

/** Same origin as {@link parseDays} — previously duplicated only in CanaryController. */
export function parsePercent(raw?: string): number {
  if (raw === undefined) return 0;
  const p = Number(raw);
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new BadRequestException('atPercent must be a number between 0 and 100.');
  }
  return p;
}
