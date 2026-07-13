/**
 * ISO-8601 week helpers, all in UTC. Weeks start Monday 00:00 UTC. Used as the
 * stable natural key for the Weekly Behavioral Ledger (Phase 2B.2) so a week's
 * identity never depends on server timezone. Deterministic and pure.
 */

/** Midnight UTC of the calendar day containing `d`. */
export function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** `d` shifted by `n` whole days, normalized to UTC midnight. */
export function addDaysUTC(d: Date, n: number): Date {
  const x = startOfUTCDay(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Monday 00:00 UTC of the ISO week containing `d`. */
export function isoWeekStartUTC(d: Date): Date {
  const day = startOfUTCDay(d);
  const dow = (day.getUTCDay() + 6) % 7; // 0 = Mon .. 6 = Sun
  day.setUTCDate(day.getUTCDate() - dow);
  return day;
}

/** ISO year + week number for a Monday-anchored `weekStart` (UTC). */
export function isoYearWeek(weekStart: Date): { isoYear: number; isoWeek: number } {
  const thursday = addDaysUTC(weekStart, 3); // the week's Thursday fixes its ISO year
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.floor((thursday.getTime() - jan1.getTime()) / (7 * 86400000)) + 1;
  return { isoYear, isoWeek };
}
