/**
 * Smoke test for Recommendation V2 (Phase 2A.3). Runs entirely against a
 * throwaway EMBEDDED local Postgres. NEVER reads .env, NEVER touches production.
 *
 *   npm run smoke:rec
 *
 * Verifies the structured engine is deterministic, single-output, correctly
 * prioritized, a pure CONSUMER of UserNutritionState (no recompute), and that the
 * reason code persists. The key correctness claim: a flat weight trend alone never
 * triggers a calorie cut — only a real (high-adherence) plateau does.
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

const PORT = 59434;
const DB = 'vitals_rec_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { PrismaService } from '../src/prisma/prisma.service';
import { NutritionStateService } from '../src/nutrition-state/nutrition-state.service';
import { RecommendationsService } from '../src/recommendations/recommendations.service';
import {
  decideNudge,
  decidePlanAdjustment,
  stateToInput,
} from '../src/recommendations/services/recommendation-engine';
import {
  RecommendationInput,
  RecommendationReason,
  REASON_META,
} from '../src/recommendations/recommendation-reason';

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

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Engine input with sensible defaults; override only what a case cares about. */
function mkInput(over: Partial<RecommendationInput> & { state?: Partial<RecommendationInput['state']> } = {}): RecommendationInput {
  const base: RecommendationInput = {
    goal: 'lose',
    targets: { calories: 2000, proteinG: 150 },
    today: { caloriesLogged: 0, proteinG: 0, mealsLogged: 0 },
    state: {
      plateauStatus: 'INSUFFICIENT_DATA',
      behaviorFlags: [],
      trendStatus: null,
      adherenceScore: null,
      adherencePct7d: 100,
      loggingStreak: 0,
      weightTrendKgWk: null,
      weightDataPoints: 0,
    },
  };
  return {
    ...base,
    ...over,
    targets: { ...base.targets, ...over.targets },
    today: { ...base.today, ...over.today },
    state: { ...base.state, ...(over.state ?? {}) },
  };
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-rec-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
  });

  console.log('▶ Booting embedded Postgres…');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  console.log('▶ Applying migrations…');
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();
  const stateSvc = new NutritionStateService(prisma);
  const recsSvc = new RecommendationsService(prisma, stateSvc);

  // ── NUDGE channel: single output, correct priority ──
  console.log('\n── NUDGE ENGINE ──');
  const noMeals = decideNudge(mkInput({ today: { caloriesLogged: 0, proteinG: 0, mealsLogged: 0 } }));
  check('meals=0 → NO_MEALS_LOGGED', noMeals.reason === RecommendationReason.NO_MEALS_LOGGED, noMeals.reason);

  const over = decideNudge(mkInput({ today: { caloriesLogged: 2400, proteinG: 150, mealsLogged: 3 } }));
  check('over target +200 → OVER_TARGET', over.reason === RecommendationReason.OVER_TARGET, over.reason);

  const proteinGap = decideNudge(
    mkInput({ today: { caloriesLogged: 1000, proteinG: 40, mealsLogged: 2 } }),
  );
  check('protein gap today → PROTEIN_GAP_TODAY', proteinGap.reason === RecommendationReason.PROTEIN_GAP_TODAY, proteinGap.reason);

  // calRemaining 400 (<500) + protRemaining 5 (<40) + pct 80 (<85) → today-state quiet, flag surfaces.
  const onlyFlag = decideNudge(
    mkInput({ today: { caloriesLogged: 1600, proteinG: 145, mealsLogged: 3 }, state: { behaviorFlags: ['PROTEIN_CHRONIC_LOW'] } }),
  );
  check('only a habit flag → PROTEIN_CHRONIC_LOW', onlyFlag.reason === RecommendationReason.PROTEIN_CHRONIC_LOW, onlyFlag.reason);

  // Prioritization: plateau (highest impact) beats a concurrent habit flag.
  const plateauWins = decideNudge(
    mkInput({
      today: { caloriesLogged: 1200, proteinG: 40, mealsLogged: 2 },
      state: { plateauStatus: 'PLATEAU_SUSPECTED', behaviorFlags: ['PROTEIN_CHRONIC_LOW'] },
    }),
  );
  check('plateau beats protein flag → PLATEAU_SUSPECTED', plateauWins.reason === RecommendationReason.PLATEAU_SUSPECTED, plateauWins.reason);
  check('nudge always single + typed', typeof plateauWins.message === 'string' && plateauWins.type === 'PLAN_ADJUSTMENT' && plateauWins.priority === 'HIGH');

  const steady = decideNudge(
    mkInput({ today: { caloriesLogged: 1600, proteinG: 145, mealsLogged: 3 } }),
  );
  check('nothing notable → STEADY floor', steady.reason === RecommendationReason.STEADY, steady.reason);

  // ── PLAN-ADJUSTMENT channel ──
  console.log('\n── PLAN-ADJUSTMENT ENGINE ──');
  const planPlateau = decidePlanAdjustment(
    mkInput({ goal: 'lose', targets: { calories: 1900, proteinG: 150 }, state: { plateauStatus: 'PLATEAU_SUSPECTED', trendStatus: 'stalled', adherenceScore: 80, weightDataPoints: 4 } }),
  );
  check('plateau → PLAN cut -200', planPlateau?.reason === RecommendationReason.PLATEAU_SUSPECTED && planPlateau?.calorieAdjustment === -200, `${planPlateau?.reason}/${planPlateau?.calorieAdjustment}`);
  check('plateau plan requiresConfirmation', planPlateau?.requiresConfirmation === true);
  check('plateau plan message has new target (1700)', !!planPlateau && planPlateau.message.includes('1700'));

  // THE correctness gain: flat trend WITHOUT high adherence ≠ calorie cut.
  const flatLowAdh = decidePlanAdjustment(
    mkInput({ goal: 'lose', state: { plateauStatus: 'NONE', trendStatus: 'stalled', adherenceScore: 30, weightTrendKgWk: 0.0, weightDataPoints: 4 } }),
  );
  check('flat trend + low adherence → NO plan change (null)', flatLowAdh === null);

  const fastLoss = decidePlanAdjustment(
    mkInput({ goal: 'lose', state: { plateauStatus: 'NONE', weightTrendKgWk: -1.1, weightDataPoints: 5 } }),
  );
  check('losing too fast → LOSING_TOO_FAST +100', fastLoss?.reason === RecommendationReason.LOSING_TOO_FAST && fastLoss?.calorieAdjustment === 100, `${fastLoss?.reason}/${fastLoss?.calorieAdjustment}`);

  const gainStalled = decidePlanAdjustment(
    mkInput({ goal: 'gain', state: { trendStatus: 'stalled', weightDataPoints: 4 } }),
  );
  check('gain stalled → GAIN_STALLED +100', gainStalled?.reason === RecommendationReason.GAIN_STALLED && gainStalled?.calorieAdjustment === 100, `${gainStalled?.reason}`);

  const fewPoints = decidePlanAdjustment(
    mkInput({ goal: 'lose', state: { plateauStatus: 'PLATEAU_SUSPECTED', weightDataPoints: 2 } }),
  );
  check('insufficient weight points → null', fewPoints === null);

  // ── REASON_META mapping ──
  console.log('\n── REASON META ──');
  check('PLATEAU_SUSPECTED → PLAN_ADJUSTMENT/HIGH', REASON_META.PLATEAU_SUSPECTED.type === 'PLAN_ADJUSTMENT' && REASON_META.PLATEAU_SUSPECTED.priority === 'HIGH');
  check('PROTEIN_CHRONIC_LOW → BEHAVIOR/MEDIUM', REASON_META.PROTEIN_CHRONIC_LOW.type === 'BEHAVIOR_RECOMMENDATION' && REASON_META.PROTEIN_CHRONIC_LOW.priority === 'MEDIUM');

  // ── INTEGRATION: engine consumes the rollup (single source of truth) ──
  console.log('\n── INTEGRATION (rollup-sourced) ──');

  // High-adherence plateau user → rollup sets PLATEAU_SUSPECTED → plan cut.
  const plU = await prisma.user.create({ data: { email: 'rec-plateau@test.local' } });
  await prisma.goal.create({ data: { userId: plU.id, type: 'LOSE_FAT', targetCalories: 1900, proteinG: 150, carbsG: 180, fatG: 60, fiberTargetG: 30, waterMl: 2500, bmr: 1500, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300 } });
  await prisma.userHabits.create({ data: { userId: plU.id, currentStreak: 7 } });
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await prisma.dailyLog.create({
      data: {
        userId: plU.id, date: daysAgo(d), caloriesLogged: 1850, proteinG: 140, planFollowed: true, adherencePct: 1.0,
        loggedMeals: { create: [
          { mealType: 'BREAKFAST', totalCalories: 500, totalProteinG: 40, totalCarbsG: 40, totalFatG: 15 },
          { mealType: 'LUNCH', totalCalories: 1350, totalProteinG: 100, totalCarbsG: 120, totalFatG: 40 },
        ] },
      },
    });
  }
  for (const [d, kg] of [[21, 80], [14, 80.1], [7, 79.9], [1, 80.0]] as const) {
    await prisma.weightLog.create({ data: { userId: plU.id, date: daysAgo(d), weightKg: kg } });
  }
  const plState = await stateSvc.recompute(plU.id);
  check('rollup classifies PLATEAU_SUSPECTED', plState.plateauStatus === 'PLATEAU_SUSPECTED', plState.plateauStatus);

  // ── Phase 2B.1: streaks derived from logs (6 consecutive logged days, ending yesterday) ──
  check('rollup loggingStreak = 6 (log-derived, self-healing)', plState.loggingStreak === 6, `got ${plState.loggingStreak}`);
  check('rollup proteinStreakDays = 6 (140 >= 90% of 150)', plState.proteinStreakDays === 6, `got ${plState.proteinStreakDays}`);
  check('rollup calorieStreakDays = 6 (1850 within target band)', plState.calorieStreakDays === 6, `got ${plState.calorieStreakDays}`);
  const plDecision = decidePlanAdjustment(stateToInput({ goal: 'LOSE_FAT', state: plState, today: { caloriesLogged: 0, proteinG: 0, mealsLogged: 0 } }));
  check('engine (consumer) → cut -200 from rollup state', plDecision?.reason === RecommendationReason.PLATEAU_SUSPECTED && plDecision?.calorieAdjustment === -200, `${plDecision?.reason}`);

  // Low-adherence flat-weight user → rollup withholds plateau → engine withholds cut.
  const loU = await prisma.user.create({ data: { email: 'rec-lowadh@test.local' } });
  await prisma.goal.create({ data: { userId: loU.id, type: 'LOSE_FAT', targetCalories: 1900, proteinG: 150, carbsG: 180, fatG: 60, fiberTargetG: 30, waterMl: 2500, bmr: 1500, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300 } });
  for (const d of [2, 5]) {
    await prisma.dailyLog.create({ data: { userId: loU.id, date: daysAgo(d), caloriesLogged: 1700, proteinG: 90, planFollowed: true, adherencePct: 0.5 } });
  }
  for (const [d, kg] of [[21, 82], [14, 82.1], [7, 81.9], [1, 82.0]] as const) {
    await prisma.weightLog.create({ data: { userId: loU.id, date: daysAgo(d), weightKg: kg } });
  }
  const loState = await stateSvc.recompute(loU.id);
  check('rollup: flat but low adherence → plateau NOT suspected', loState.plateauStatus !== 'PLATEAU_SUSPECTED', loState.plateauStatus);
  check('rollup: non-consecutive logs → loggingStreak 0 (no frozen streak)', loState.loggingStreak === 0, `got ${loState.loggingStreak}`);
  const loDecision = decidePlanAdjustment(stateToInput({ goal: 'LOSE_FAT', state: loState, today: { caloriesLogged: 0, proteinG: 0, mealsLogged: 0 } }));
  check('engine withholds calorie cut for non-adherent user', loDecision === null);

  // ── PERSISTENCE: reason column round-trips ──
  console.log('\n── PERSISTENCE ──');
  const saved = await prisma.recommendation.create({
    data: {
      userId: plU.id, type: plDecision!.type, priority: plDecision!.priority,
      trigger: 'weight.updated', reason: plDecision!.reason,
      messageForUser: plDecision!.message, planChange: true, calorieAdjustment: plDecision!.calorieAdjustment,
      requiresConfirmation: plDecision!.requiresConfirmation,
    },
  });
  check('reason persisted on Recommendation', saved.reason === 'PLATEAU_SUSPECTED', saved.reason ?? 'null');
  const history = await prisma.recommendation.findMany({ where: { userId: plU.id }, select: { reason: true, type: true } });
  check('history query exposes reason', history.length === 1 && history[0].reason === 'PLATEAU_SUSPECTED');

  // ── INTELLIGENCE SNAPSHOT (mobile surface, read-only projection) ──
  console.log('\n── INTELLIGENCE SNAPSHOT ──');
  const snap = await stateSvc.getIntelligenceSnapshot(plU.id);
  check('snapshot: scores present', snap.scores.adherence !== null && snap.scores.nutrition !== null, `adh=${snap.scores.adherence} nut=${snap.scores.nutrition}`);
  check('snapshot: plateauStatus mirrors rollup', snap.plateauStatus === 'PLATEAU_SUSPECTED', snap.plateauStatus);
  check('snapshot: behaviorFlags is array', Array.isArray(snap.behaviorFlags));
  check('snapshot: weekly.daysLogged7d=6', snap.weekly.daysLogged7d === 6, `got ${snap.weekly.daysLogged7d}`);
  check('snapshot: weekly streaks exposed (logging=6)', snap.weekly.loggingStreak === 6 && snap.weekly.proteinStreakDays === 6 && snap.weekly.calorieStreakDays === 6);
  check('snapshot: topRecommendation reason exposed', snap.topRecommendation?.reason === 'PLATEAU_SUSPECTED', snap.topRecommendation?.reason ?? 'null');
  check('snapshot: topRecommendation carries id + status (commit-ready)', typeof snap.topRecommendation?.id === 'string' && snap.topRecommendation?.status === 'PENDING', `${snap.topRecommendation?.status}`);
  check('snapshot: computedAt is ISO string', typeof snap.computedAt === 'string' && snap.computedAt.includes('T'));

  const snapEmpty = await stateSvc.getIntelligenceSnapshot(loU.id);
  check('snapshot: no pending rec → topRecommendation null', snapEmpty.topRecommendation === null);

  // ── Phase 2B.1: COMMITMENT LIFECYCLE (recommendation -> pledge -> done, lazy expiry) ──
  console.log('\n── COMMITMENT LIFECYCLE ──');
  const cU = await prisma.user.create({ data: { email: 'rec-commit@test.local' } });
  const mkRec = (over: any = {}) =>
    prisma.recommendation.create({
      data: {
        userId: cU.id, type: 'BEHAVIOR_RECOMMENDATION', priority: 'MEDIUM',
        trigger: 'meal.logged', reason: 'PROTEIN_CHRONIC_LOW',
        messageForUser: 'Agrega 25g de proteína al desayuno.', planChange: false, requiresConfirmation: false,
        ...over,
      },
    });

  // commit: PENDING -> COMMITTED with a window
  const rec1 = await mkRec();
  const committed: any = await recsSvc.commit(cU.id, rec1.id);
  check('commit: PENDING -> COMMITTED', committed.status === 'COMMITTED', committed.status);
  check('commit: sets committedAt + a future commitExpiresAt', !!committed.committedAt && committed.commitExpiresAt > new Date());

  // commit guard: a non-PENDING rec cannot be re-committed
  const recommit: any = await recsSvc.commit(cU.id, rec1.id);
  check('commit guard: already-committed cannot re-commit', recommit.status === 'COMMITTED' && !!recommit.message);

  // complete: COMMITTED -> COMPLETED
  const completed: any = await recsSvc.complete(cU.id, rec1.id);
  check('complete: COMMITTED -> COMPLETED', completed.status === 'COMPLETED' && !!completed.completedAt, completed.status);

  // complete guard: a non-committed rec cannot be completed
  const rec2 = await mkRec();
  const badComplete: any = await recsSvc.complete(cU.id, rec2.id);
  check('complete guard: PENDING cannot be completed', !!badComplete.message && badComplete.status === 'PENDING');

  // lazy expiry: a COMMITTED rec past its window becomes EXPIRED on the next read
  const stale = await mkRec({ status: 'COMMITTED', committedAt: daysAgo(9), commitExpiresAt: daysAgo(2) });
  await recsSvc.getHistory(cU.id); // sweeps
  const sweptRow = await prisma.recommendation.findUnique({ where: { id: stale.id } });
  check('lazy expiry: stale commitment swept to EXPIRED on read', sweptRow?.status === 'EXPIRED', sweptRow?.status ?? 'null');

  // complete after window: refuses + records the truth (EXPIRED, not COMPLETED)
  const stale2 = await mkRec({ status: 'COMMITTED', committedAt: daysAgo(9), commitExpiresAt: daysAgo(1) });
  const lateComplete: any = await recsSvc.complete(cU.id, stale2.id);
  check('complete after window: refuses and marks EXPIRED', lateComplete.status === 'EXPIRED' && !!lateComplete.message);

  // getActive surfaces live commitments alongside pending nudges
  const active = await recsSvc.getActive(cU.id);
  check('getActive: includes PENDING + live COMMITTED only', active.every((r: any) => r.status === 'PENDING' || r.status === 'COMMITTED'), `n=${active.length}`);

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Recommendation V2`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
