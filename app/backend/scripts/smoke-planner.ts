/**
 * Smoke test for the Adaptive Nutrition Planner (Phase 2C.2). The planner engine is
 * a PURE function of the CoachingContext, so most assertions build synthetic
 * contexts (no DB) to exercise every longitudinal decision branch deterministically.
 * One integration case boots an EMBEDDED local Postgres to confirm the service wires
 * the real contract into the engine. NEVER reads .env, NEVER touches production.
 *
 *   npm run smoke:planner
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

const PORT = 59439;
const DB = 'vitals_planner_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { PrismaService } from '../src/prisma/prisma.service';
import { NutritionStateService } from '../src/nutrition-state/nutrition-state.service';
import { WeeklyLedgerService } from '../src/nutrition-state/weekly-ledger.service';
import { WeeklyReviewService } from '../src/nutrition-state/weekly-review.service';
import { CoachingContextService } from '../src/nutrition-state/coaching-context.service';
import { AdaptivePlannerService } from '../src/planner/adaptive-planner.service';
import { decidePlan } from '../src/planner/adaptive-planner.engine';
import { CoachingContext, CtxWeek } from '../src/nutrition-state/types/coaching-context';
import { addDaysUTC, isoWeekStartUTC } from '../src/common/metrics/iso-week';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
}

// ── synthetic CoachingContext builders (the engine's only input) ──
function mkWeek(over: Partial<CtxWeek> = {}): CtxWeek {
  return {
    weekStart: '2026-01-05',
    adherenceScore: 80,
    nutritionScore: 80,
    trendStatus: 'stalled',
    plateauStatus: 'PLATEAU_SUSPECTED',
    behaviorFlags: [],
    daysLogged: 7,
    avgCalories: 2000,
    avgProtein: 150,
    commitmentsCompleted: 0,
    commitmentsExpired: 0,
    primaryIssue: null,
    primaryImprovement: null,
    ...over,
  };
}
function mkCtx(over: any = {}): CoachingContext {
  const base: CoachingContext = {
    meta: { contract: 'vitals-fit.coaching-context', version: 1, depth: 'full', generatedAt: '2026-07-14T00:00:00.000Z', locale: 'es' },
    user: { goal: 'lose', persona: 'beginner', sex: 'male' },
    targets: { tdee: 2400, calories: 2000, proteinG: 150, carbsG: 200, fatG: 65 },
    today: { caloriesLogged: 0, proteinG: 0, carbsG: 0, fatG: 0, mealsLogged: 0, recentMeals: [] },
    currentState: {
      computedAt: '2026-07-14T00:00:00.000Z',
      adherenceScore: 80, nutritionScore: 80, trendStatus: 'stalled', plateauStatus: 'PLATEAU_SUSPECTED',
      behaviorFlags: [], adherencePct7d: 90, daysLogged7d: 7, avgCalories7d: 2000,
      streaks: { loggingDays: 7, proteinDays: 7, calorieDays: 7 },
      weight: { currentKg: 80, trendKgPerWeek: 0.0, dataPoints: 4 },
    },
    history: { weeks: [mkWeek(), mkWeek(), mkWeek()] },
    review: null,
    commitments: { active: [] },
  };
  return { ...base, ...over, currentState: { ...base.currentState, ...(over.currentState ?? {}) }, user: { ...base.user, ...(over.user ?? {}) }, targets: { ...base.targets, ...(over.targets ?? {}) }, history: over.history ?? base.history };
}

async function applyMigrations() {
  const dirs = fs.readdirSync(MIGRATIONS_DIR).filter((d) => fs.existsSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'))).sort();
  const client = new Client({ connectionString: LOCAL_URL });
  await client.connect();
  for (const d of dirs) await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8'));
  await client.end();
}

async function main() {
  // ── PART A: pure engine (no DB) ──
  console.log('── DATA GATE ──');
  const insufficient = decidePlan(mkCtx({ history: { weeks: [mkWeek()] } }));
  check('1 completed week -> WAIT_FOR_MORE_DATA / INSUFFICIENT_DATA', insufficient.headline.code === 'WAIT_FOR_MORE_DATA' && insufficient.posture === 'INSUFFICIENT_DATA', `${insufficient.posture}`);
  check('WAIT decision names the data gap', insufficient.headline.evidence.some((e) => e.code === 'INSUFFICIENT_HISTORY'));

  console.log('\n── CALORIES: LOSE ──');
  const plateau = decidePlan(mkCtx()); // 3 stalled weeks, plateauNow, high adherence
  check('sustained plateau + high adherence -> REDUCE_CALORIES', plateau.headline.code === 'REDUCE_CALORIES', plateau.headline.code);
  check('REDUCE is HIGH confidence at 3 weeks', plateau.headline.confidence === 'HIGH', plateau.headline.confidence);
  check('REDUCE carries -200 kcal adjustment', plateau.headline.adjustment?.calorieDelta === -200 && plateau.headline.adjustment?.newCalorieTarget === 1800);
  check('REDUCE review window = 14 days', plateau.headline.reviewWindowDays === 14);
  check('posture EVOLVING', plateau.posture === 'EVOLVING');
  check('evidence cites sustained plateau + high adherence', plateau.headline.evidence.some((e) => e.code === 'PLATEAU_SUSTAINED') && plateau.headline.evidence.some((e) => e.code === 'HIGH_ADHERENCE'));

  const lowAdh = decidePlan(mkCtx({ currentState: { plateauStatus: 'NONE', adherenceScore: 50 }, history: { weeks: [mkWeek({ adherenceScore: 50, plateauStatus: 'NONE' }), mkWeek({ adherenceScore: 48, plateauStatus: 'NONE' }), mkWeek({ adherenceScore: 52, plateauStatus: 'NONE' })] } }));
  check('sustained stall + LOW adherence -> KEEP_PLAN (adherence first)', lowAdh.headline.code === 'KEEP_PLAN' && lowAdh.posture === 'ADHERENCE_FIRST', `${lowAdh.headline.code}/${lowAdh.posture}`);
  check('adherence-first cites LOW_ADHERENCE, no calorie change', lowAdh.headline.adjustment === null && lowAdh.headline.evidence.some((e) => e.code === 'LOW_ADHERENCE'));

  const fastLoss = decidePlan(mkCtx({ currentState: { weight: { currentKg: 78, trendKgPerWeek: -1.2, dataPoints: 4 } } }));
  check('losing too fast -> INCREASE_CALORIES', fastLoss.headline.code === 'INCREASE_CALORIES' && fastLoss.headline.adjustment?.calorieDelta === 100, fastLoss.headline.code);

  const onTrack = decidePlan(mkCtx({ currentState: { plateauStatus: 'NONE', weight: { currentKg: 79, trendKgPerWeek: -0.5, dataPoints: 4 } }, history: { weeks: [mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE' }), mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE' }), mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE' })] } }));
  check('on track -> KEEP_PLAN / STABLE', onTrack.headline.code === 'KEEP_PLAN' && onTrack.posture === 'STABLE', `${onTrack.headline.code}/${onTrack.posture}`);

  const fewWeightPts = decidePlan(mkCtx({ currentState: { weight: { currentKg: 80, trendKgPerWeek: 0, dataPoints: 1 } } }));
  check('enough weeks but too few weight points -> calorie WAIT / INSUFFICIENT_DATA', fewWeightPts.headline.code === 'WAIT_FOR_MORE_DATA' && fewWeightPts.posture === 'INSUFFICIENT_DATA');

  console.log('\n── CALORIES: GAIN ──');
  const gainStall = decidePlan(mkCtx({ user: { goal: 'gain' }, currentState: { plateauStatus: 'NONE', weight: { currentKg: 75, trendKgPerWeek: 0.0, dataPoints: 4 } }, history: { weeks: [mkWeek({ trendStatus: 'stalled', plateauStatus: 'NONE' }), mkWeek({ trendStatus: 'stalled', plateauStatus: 'NONE' }), mkWeek({ trendStatus: 'stalled', plateauStatus: 'NONE' })] } }));
  check('gain stalled + high adherence -> INCREASE_CALORIES', gainStall.headline.code === 'INCREASE_CALORIES' && gainStall.headline.adjustment?.calorieDelta === 100, gainStall.headline.code);

  console.log('\n── PROTEIN ──');
  const cutProtein = decidePlan(mkCtx()); // plateau cut scenario, protein 150 == target -> has room
  const protDec = cutProtein.decisions.find((d) => d.dimension === 'PROTEIN');
  check('a calorie cut is complemented by INCREASE_PROTEIN', protDec?.code === 'INCREASE_PROTEIN' && protDec?.adjustment?.proteinDelta === 15, protDec?.code);
  check('headline stays the calorie cut, not the protein bump', cutProtein.headline.code === 'REDUCE_CALORIES');

  const reduceProtein = decidePlan(mkCtx({ currentState: { plateauStatus: 'NONE', weight: { currentKg: 79, trendKgPerWeek: -0.4, dataPoints: 4 } }, history: { weeks: [mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE', avgProtein: 70 }), mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE', avgProtein: 68 }), mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE', avgProtein: 72 })] } }));
  const rp = reduceProtein.decisions.find((d) => d.dimension === 'PROTEIN');
  check('adherent but protein chronically unreachable -> REDUCE_PROTEIN', rp?.code === 'REDUCE_PROTEIN' && rp?.adjustment?.newProteinTarget === 135, `${rp?.code}`);

  console.log('\n── INTERVENTION ──');
  const replace = decidePlan(mkCtx({ currentState: { plateauStatus: 'NONE', weight: { currentKg: 79, trendKgPerWeek: -0.4, dataPoints: 4 } }, history: { weeks: [mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE' }), mkWeek({ trendStatus: 'on_track', plateauStatus: 'NONE' })] }, review: { weekStart: '2026-07-06', improvedMetrics: [], worsenedMetrics: [], biggestOpportunity: 'PROTEIN_CHRONIC_LOW', biggestImprovement: null, commitmentOutcomes: [], followUp: { resolved: [], persisting: [{ issue: 'PROTEIN_CHRONIC_LOW', weeksActive: 2, intervention: 'INTERVENED' }], emerged: [] }, nextPriority: { reason: 'PROTEIN_CHRONIC_LOW', basis: 'PERSISTENT_INTERVENED' } } }));
  check('committed intervention still failing -> REPLACE_INTERVENTION', replace.headline.code === 'REPLACE_INTERVENTION' && replace.posture === 'EVOLVING', replace.headline.code);
  check('REPLACE cites the failed intervention', replace.headline.evidence.some((e) => e.code === 'INTERVENTION_FAILED'));

  console.log('\n── DETERMINISM ──');
  check('identical context -> identical plan', JSON.stringify(decidePlan(mkCtx())) === JSON.stringify(decidePlan(mkCtx())));

  // ── PART B: integration (real contract -> engine) ──
  console.log('\n── INTEGRATION (real CoachingContext) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-planner-'));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();
  const state = new NutritionStateService(prisma);
  const ledger = new WeeklyLedgerService(prisma);
  const review = new WeeklyReviewService(prisma, ledger);
  const coaching = new CoachingContextService(prisma, state, ledger, review);
  const planner = new AdaptivePlannerService(coaching);

  const cws = isoWeekStartUTC(new Date());
  const wC = addDaysUTC(cws, -7);
  const wB = addDaysUTC(cws, -14);
  const user = await prisma.user.create({ data: { email: 'planner@test.local' } });
  await prisma.userProfile.create({ data: { userId: user.id, name: 'P', age: 30, weightKg: 80, heightCm: 178, sex: 'MALE', activityLevel: 'MODERATE', fitnessLevel: 'BEGINNER' } });
  await prisma.goal.create({ data: { userId: user.id, type: 'LOSE_FAT', targetCalories: 2000, proteinG: 150, carbsG: 200, fatG: 60, fiberTargetG: 30, waterMl: 2500, bmr: 1600, tdee: 2300, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300 } });
  const logDay = (d: Date) => prisma.dailyLog.create({ data: { userId: user.id, date: d, caloriesLogged: 1980, proteinG: 150, planFollowed: true, adherencePct: 1.0, loggedMeals: { create: [{ mealType: 'BREAKFAST' as const, totalCalories: 700, totalProteinG: 60, totalCarbsG: 60, totalFatG: 18 }, { mealType: 'LUNCH' as const, totalCalories: 1280, totalProteinG: 90, totalCarbsG: 140, totalFatG: 42 }] } } });
  for (let i = 0; i < 7; i++) await logDay(addDaysUTC(wB, i));
  for (let i = 0; i < 7; i++) await logDay(addDaysUTC(wC, i));
  for (const [d, kg] of [[addDaysUTC(wB, 0), 80.0], [addDaysUTC(wB, 4), 80.0], [addDaysUTC(wC, 0), 80.0], [addDaysUTC(wC, 4), 80.0]] as const) {
    await prisma.weightLog.create({ data: { userId: user.id, date: d, weightKg: kg } });
  }

  const plan = await planner.getPlan(user.id);
  check('service builds a plan end-to-end', !!plan.headline && plan.meta.planner === 'vitals-fit.adaptive-planner');
  check('weeksAnalyzed reflects the ledger (2 completed weeks)', plan.meta.weeksAnalyzed === 2, `${plan.meta.weeksAnalyzed}`);
  check('posture is a valid value', ['STABLE', 'EVOLVING', 'ADHERENCE_FIRST', 'INSUFFICIENT_DATA'].includes(plan.posture), plan.posture);
  check('plan is deterministic on rebuild', JSON.stringify(strip(await planner.getPlan(user.id))) === JSON.stringify(strip(plan)));

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Adaptive Planner`);
  process.exit(failures === 0 ? 0 : 1);
}

function strip(plan: any) {
  return { ...plan, meta: { ...plan.meta, generatedAt: 'X' } };
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
