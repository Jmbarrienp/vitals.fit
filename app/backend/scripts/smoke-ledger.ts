/**
 * Smoke test for the Weekly Behavioral Ledger (Phase 2B.2). Runs entirely against
 * a throwaway EMBEDDED local Postgres. NEVER reads .env, NEVER touches production.
 *
 *   npm run smoke:ledger
 *
 * Verifies the ledger is append-only, immutable, deterministic, excludes the
 * in-progress week, reuses the shared derivation, and aggregates commitments/recs.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ignoreTeardownNoise = (e: any) => {
  if (String(e?.message ?? e).includes('Connection terminated')) return;
  throw e;
};
process.on('uncaughtException', ignoreTeardownNoise);
process.on('unhandledRejection', ignoreTeardownNoise);

const PORT = 59435;
const DB = 'vitals_ledger_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { PrismaService } from '../src/prisma/prisma.service';
import { WeeklyLedgerService } from '../src/nutrition-state/weekly-ledger.service';
import { addDaysUTC, isoWeekStartUTC } from '../src/common/metrics/iso-week';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function applyMigrations() {
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((d) => fs.existsSync(path.join(MIGRATIONS_DIR, d, 'migration.sql')))
    .sort();
  const client = new Client({ connectionString: LOCAL_URL });
  await client.connect();
  for (const d of dirs) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8');
    await client.query(sql);
  }
  await client.end();
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-ledger-'));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });

  console.log('▶ Booting embedded Postgres…');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  console.log('▶ Applying migrations…');
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();
  const ledger = new WeeklyLedgerService(prisma);

  // ── Week anchors (UTC, ISO) relative to now ──
  const currentWeekStart = isoWeekStartUTC(new Date());
  const weekC = addDaysUTC(currentWeekStart, -7);  // last completed week
  const weekB = addDaysUTC(currentWeekStart, -14); // two weeks ago
  const dayC = (i: number) => addDaysUTC(weekC, i);
  const dayB = (i: number) => addDaysUTC(weekB, i);

  const user = await prisma.user.create({ data: { email: 'ledger@test.local' } });
  await prisma.goal.create({ data: { userId: user.id, type: 'LOSE_FAT', targetCalories: 2000, proteinG: 150, carbsG: 200, fatG: 60, fiberTargetG: 30, waterMl: 2500, bmr: 1600, tdee: 2300, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300 } });

  const fullDay = (date: Date) => ({
    userId: user.id, date, caloriesLogged: 2000, proteinG: 150, planFollowed: true, adherencePct: 1.0,
    loggedMeals: { create: [
      { mealType: 'BREAKFAST' as const, totalCalories: 600, totalProteinG: 45, totalCarbsG: 60, totalFatG: 18 },
      { mealType: 'LUNCH' as const, totalCalories: 1400, totalProteinG: 105, totalCarbsG: 140, totalFatG: 42 },
    ] },
  });

  // weekC: 7 full days (Mon..Sun). weekB: 3 days (Mon..Wed). Current week: 2 days (must be ignored).
  for (let i = 0; i < 7; i++) await prisma.dailyLog.create({ data: fullDay(dayC(i)) });
  for (let i = 0; i < 3; i++) await prisma.dailyLog.create({ data: fullDay(dayB(i)) });
  for (let i = 0; i < 2; i++) await prisma.dailyLog.create({ data: fullDay(addDaysUTC(currentWeekStart, i)) });

  // Weights: decreasing across weekB..weekC → LOSE_FAT on_track.
  for (const [d, kg] of [[dayB(0), 80.0], [dayB(3), 79.7], [dayC(0), 79.3], [dayC(3), 79.0]] as const) {
    await prisma.weightLog.create({ data: { userId: user.id, date: d, weightKg: kg } });
  }

  // Recommendations/commitments landing in weekC.
  const mkRec = (over: any) => prisma.recommendation.create({ data: { userId: user.id, type: 'BEHAVIOR_RECOMMENDATION', priority: 'MEDIUM', trigger: 'meal.logged', messageForUser: 'x', ...over } });
  await mkRec({ status: 'COMPLETED', createdAt: dayC(0), committedAt: dayC(1), commitExpiresAt: dayC(5), completedAt: dayC(3) }); // completed commitment
  await mkRec({ status: 'EXPIRED', createdAt: dayC(0), committedAt: dayC(1), commitExpiresAt: dayC(4) });                        // expired commitment
  await mkRec({ status: 'ACCEPTED', createdAt: dayC(0), respondedAt: dayC(2), planChange: true, calorieAdjustment: -200 });      // accepted plan change
  await mkRec({ status: 'PENDING', createdAt: dayC(2) });                                                                         // plain generated

  // ── APPEND-ONLY BACKFILL ──
  console.log('\n── BACKFILL ──');
  const appended = await ledger.ensureBackfilled(user.id);
  check('backfill appends the 2 completed weeks (not the current one)', appended === 2, `got ${appended}`);

  const again = await ledger.ensureBackfilled(user.id);
  check('idempotent: second backfill appends 0', again === 0, `got ${again}`);

  const all = await prisma.weeklyNutritionSnapshot.findMany({ where: { userId: user.id }, orderBy: { weekStart: 'asc' } });
  check('exactly 2 rows persisted', all.length === 2, `got ${all.length}`);

  const current = await prisma.weeklyNutritionSnapshot.findFirst({ where: { userId: user.id, weekStart: currentWeekStart } });
  check('in-progress week is NOT snapshotted (immutability guarantee)', current === null);

  const rowB = all.find((r) => r.weekStart.toISOString().slice(0, 10) === weekB.toISOString().slice(0, 10))!;
  const rowC = all.find((r) => r.weekStart.toISOString().slice(0, 10) === weekC.toISOString().slice(0, 10))!;

  // ── DETERMINISTIC DERIVATION (shared deriveState, anchor = week end) ──
  console.log('\n── DERIVED WEEK (weekC, full 7 days) ──');
  check('weekC daysLogged=7', rowC.daysLogged === 7, `got ${rowC.daysLogged}`);
  check('weekC loggingStreak=7 (alive through Sunday, no grace)', rowC.loggingStreak === 7, `got ${rowC.loggingStreak}`);
  check('weekC protein+calorie streaks=7', rowC.proteinStreakDays === 7 && rowC.calorieStreakDays === 7, `${rowC.proteinStreakDays}/${rowC.calorieStreakDays}`);
  check('weekC adherenceScore=100', rowC.adherenceScore === 100, `got ${rowC.adherenceScore}`);
  check('weekC nutritionScore=100', rowC.nutritionScore === 100, `got ${rowC.nutritionScore}`);
  check('weekC avgCalories=2000, adherencePct=100', rowC.avgCalories === 2000 && rowC.adherencePct === 100, `${rowC.avgCalories}/${rowC.adherencePct}`);
  check('weekC trendStatus=on_track (LOSE_FAT, weight falling)', rowC.trendStatus === 'on_track', `got ${rowC.trendStatus}`);
  check('weekC plateau NONE, no primaryIssue', rowC.plateauStatus === 'NONE' && rowC.primaryIssue === null, `${rowC.plateauStatus}/${rowC.primaryIssue}`);
  check('weekC isoWeek matches its Monday', rowC.isoWeek >= 1 && rowC.isoWeek <= 53);

  console.log('\n── DERIVED WEEK (weekB, partial 3 days) ──');
  check('weekB daysLogged=3', rowB.daysLogged === 3, `got ${rowB.daysLogged}`);
  check('weekB loggingStreak=0 (Sunday not logged, no grace)', rowB.loggingStreak === 0, `got ${rowB.loggingStreak}`);

  // ── BEHAVIOR FOLLOW-UP (primaryImprovement consumes the prior ledger week) ──
  console.log('\n── FOLLOW-UP ──');
  check('weekB primaryImprovement null (no prior week)', rowB.primaryImprovement === null, `${rowB.primaryImprovement}`);
  check('weekC primaryImprovement = ADHERENCE_IMPROVED (vs weekB)', rowC.primaryImprovement === 'ADHERENCE_IMPROVED', `${rowC.primaryImprovement}`);

  // ── COMMITMENT / RECOMMENDATION AGGREGATES (weekC) ──
  console.log('\n── AGGREGATES ──');
  check('weekC generatedRecommendations=4', rowC.generatedRecommendations === 4, `got ${rowC.generatedRecommendations}`);
  check('weekC acceptedRecommendations=1', rowC.acceptedRecommendations === 1, `got ${rowC.acceptedRecommendations}`);
  check('weekC completedCommitments=1', rowC.completedCommitments === 1, `got ${rowC.completedCommitments}`);
  check('weekC expiredCommitments=1', rowC.expiredCommitments === 1, `got ${rowC.expiredCommitments}`);
  check('weekC completionRate=0.5', rowC.completionRate === 0.5, `got ${rowC.completionRate}`);
  check('weekB aggregates all zero', rowB.generatedRecommendations === 0 && rowB.completedCommitments === 0);

  // ── IMMUTABILITY: mutating raw logs after the fact never rewrites history ──
  console.log('\n── IMMUTABILITY ──');
  const beforeCreatedAt = rowC.createdAt.getTime();
  const beforeAvg = rowC.avgCalories;
  await prisma.dailyLog.updateMany({ where: { userId: user.id, date: dayC(0) }, data: { caloriesLogged: 9000 } });
  const reappended = await ledger.ensureBackfilled(user.id);
  const rowCAfter = await prisma.weeklyNutritionSnapshot.findFirst({ where: { userId: user.id, weekStart: weekC } });
  check('re-backfill after mutating a past log appends 0', reappended === 0, `got ${reappended}`);
  check('weekC row unchanged (avgCalories + createdAt frozen)', rowCAfter?.avgCalories === beforeAvg && rowCAfter?.createdAt.getTime() === beforeCreatedAt, `${rowCAfter?.avgCalories}`);

  // ── READ API (projection, newest-first) ──
  console.log('\n── READ API ──');
  const history = await ledger.getHistory(user.id);
  check('getHistory newest-first', history.length === 2 && history[0].weekStart > history[1].weekStart, history.map((h) => h.weekStart).join(','));
  check('getHistory weekStart is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(history[0].weekStart), history[0].weekStart);

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Weekly Ledger`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
