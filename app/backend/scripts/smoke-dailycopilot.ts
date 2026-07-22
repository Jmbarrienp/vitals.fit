/**
 * Smoke test for Nutrition Copilot V5.1 — Unified Daily Experience.
 * The projection is pure and tested directly against hand-built coordination
 * sessions; the integration half runs the real engine graph on embedded
 * Postgres.
 *
 *   npm run smoke:dailycopilot
 *
 * Verifies: EXACTLY ONE focus (never two), no duplication between sections,
 * determinism, correct composition (every value traceable to an owner), pure
 * rendering (the contract carries the copy so the screen needs no logic), zero
 * writes, and integration with the Runtime, Planner, Meal Planner, Commitments,
 * Vision and Weekly Review.
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

const PORT = 59450;
const DB = 'vitals_daily_smoke';
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
import { MealPlannerService } from '../src/meal-planner/meal-planner.service';
import { RecommendationsService } from '../src/recommendations/recommendations.service';
import { FoodService } from '../src/food/food.service';
import { LocalFoodAdapter } from '../src/food/adapters/local.adapter';
import { NutritionCopilotRuntime } from '../src/copilot/copilot.runtime';
import { projectDailySession } from '../src/copilot/pipeline/daily-projection';
import { DAILY_COPILOT_CONTRACT_VERSION } from '../src/copilot/types/daily-copilot-contract';
import { CopilotSession } from '../src/copilot/types/copilot-contract';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const AT = '2026-07-16T12:00:00.000Z';

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function applyMigrations() {
  const dirs = fs.readdirSync(MIGRATIONS_DIR).filter((d) => fs.existsSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'))).sort();
  const client = new Client({ connectionString: LOCAL_URL });
  await client.connect();
  for (const d of dirs) await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8'));
  await client.end();
}

/** A hand-built COORDINATION session — the projection must only consume it. */
function mkSession(over: Partial<CopilotSession> = {}): CopilotSession {
  return {
    meta: { contract: 'vitals-fit.copilot-session', version: 1, generatedAt: AT, consumes: { coachingContext: 1, planner: 1, mealPlanner: 1 } },
    currentFocus: { area: 'MAINTAIN', reason: 'todo en verde — proteger la racha es el mejor movimiento' },
    currentGoals: { goal: 'lose', calories: 2000, proteinG: 150, todayCalories: 1200, todayProteinG: 90, mealsLoggedToday: 2 },
    currentPlan: { posture: 'STABLE', headlineCode: 'HOLD_PLAN', headlineExplanation: 'mantener el plan actual', decisions: 1, reviewWindowDays: 14 },
    activeCommitments: [],
    unresolvedIssues: [],
    recentProgress: { trend: 'on_track', adherence7d: 82, loggingStreakDays: 6, lastWeek: { adherenceScore: 78, biggestImprovement: 'ADHERENCE_IMPROVED' } },
    mealSuggestions: [
      { source: 'MEAL_PLANNER', text: 'Pollo con arroz', code: null },
      { source: 'MEAL_PLANNER', text: 'Avena con fruta', code: null },
    ],
    visionSuggestions: [],
    plannerRecommendations: [{ source: 'PLANNER', text: 'mantener el plan actual', code: 'HOLD_PLAN' }],
    coachSummary: { summary: 'Semana sólida.', diagnosis: 'La proteína del desayuno sigue baja.', source: 'deterministic' },
    nextAction: { source: 'WEEKLY_COACH', action: 'Sube tu proteína del desayuno a 30g', reason: 'la próxima acción del coach es la más fundamentada' },
    pendingQuestions: [],
    confidence: 'ALTA',
    silenced: [{ module: 'VISION', reason: 'el registro fluye — no hace falta empujar la cámara hoy' }],
    ...over,
  };
}

async function main() {
  console.log('── V5.1: EXACTLY ONE FOCUS (never two, never three) ──');
  const daily = projectDailySession(mkSession(), AT);
  check('the projection exposes ONE focus object, not a list', typeof daily.focus === 'object' && !Array.isArray(daily.focus) && !!daily.focus.area);
  check('the focus area comes from the runtime verbatim', daily.focus.area === 'MAINTAIN');
  check('the WHY is the runtime\'s evidence-based reason, verbatim', daily.focus.why === 'todo en verde — proteger la racha es el mejor movimiento');
  check('the title is presentation copy the SCREEN does not have to know', daily.focus.title === 'Vas bien — mantén el ritmo');
  const logging = projectDailySession(mkSession({ currentFocus: { area: 'LOGGING', reason: 'sin comidas hoy' } }), AT);
  check('a different focus area yields a different title, still exactly one', logging.focus.title === 'Retoma tu registro' && typeof logging.focus === 'object');

  console.log('\n── V5.1: TODAY\'S PLAN (priority first, deduplicated) ──');
  check('the priority action is ALWAYS position 1', daily.todaysPlan.actions[0].kind === 'PRIORITY' && daily.todaysPlan.actions[0].text.includes('proteína del desayuno'));
  check('…and it carries its owning source', daily.todaysPlan.actions[0].source === 'WEEKLY_COACH');
  const withCommitment = projectDailySession(mkSession({ activeCommitments: [{ message: 'Comer 30g de proteína al desayuno', reason: 'P', expiresAt: '2026-07-18' }] }), AT);
  check('a live pledge is added as a second concrete step', withCommitment.todaysPlan.actions.length === 2 && withCommitment.todaysPlan.actions[1].kind === 'COMMITMENT');
  const dupCommitment = projectDailySession(mkSession({
    activeCommitments: [{ message: 'Sube tu proteína del desayuno a 30g', reason: 'P', expiresAt: '2026-07-18' }],
  }), AT);
  check('NO DUPLICATION: a pledge identical to the priority is not repeated', dupCommitment.todaysPlan.actions.length === 1);
  const withVision = projectDailySession(mkSession({
    visionSuggestions: [{ source: 'VISION', text: 'Registra con la cámara — menos fricción', code: 'VISION_CAPTURE_AFFORDANCE' }],
  }), AT);
  check('the logging affordance becomes a LOG step when the runtime offered it', withVision.todaysPlan.actions.some((a) => a.kind === 'LOG'));

  console.log('\n── V5.1: SECTIONS (each traceable to its owner) ──');
  check('meals are the Meal Planner\'s, verbatim', daily.meals.items.length === 2 && daily.meals.items[0].name === 'Pollo con arroz');
  const noMeals = projectDailySession(mkSession({
    mealSuggestions: [],
    silenced: [{ module: 'MEAL_PLANNER', reason: 'el foco es reparar el registro — sugerir comidas antes de eso es ruido' }],
  }), AT);
  check('an empty meal list QUOTES the coordination audit instead of inventing a reason', noMeals.meals.note?.includes('reparar el registro') === true);
  check('commitments project with their expiry; empty state has its own note', daily.commitments.active.length === 0 && !!daily.commitments.note && withCommitment.commitments.active[0].expiresAt === '2026-07-18');
  check('progress headline is copy over the ALREADY-COMPUTED trend', daily.progress.headline === 'Vas en camino');
  check('progress metrics are pre-formatted — the screen prints, never computes', daily.progress.metrics.some((m) => m.value === '1200 / 2000 kcal') && daily.progress.metrics.some((m) => m.value === '82%'));
  check('last week\'s score appears only when the review produced one', daily.progress.metrics.some((m) => m.label === 'Semana pasada') && !projectDailySession(mkSession({ recentProgress: { trend: 'on_track', adherence7d: 80, loggingStreakDays: 3, lastWeek: null } }), AT).progress.metrics.some((m) => m.label === 'Semana pasada'));
  check('the Vision CTA appears ONLY when the runtime decided it lowers friction', daily.visionCta === null && withVision.visionCta?.target === 'LOG');
  check('confidence is inherited, not recomputed', daily.confidence === 'ALTA');

  console.log('\n── V5.1: PURE PROJECTION + DETERMINISM ──');
  check('the source contract version is pinned (provenance)', daily.meta.source.copilotSessionVersion === 1 && daily.meta.version === DAILY_COPILOT_CONTRACT_VERSION);
  check('generatedAt is an INPUT — reproducible', daily.meta.generatedAt === AT);
  check('same session + same timestamp -> byte-identical daily', JSON.stringify(projectDailySession(mkSession(), AT)) === JSON.stringify(daily));
  const trends = ['on_track', 'stalled', 'regressing', 'insufficient_data'];
  check('every trend the platform can emit has copy (no unlabeled state)', trends.every((t) => {
    const d = projectDailySession(mkSession({ recentProgress: { trend: t, adherence7d: null, loggingStreakDays: 0, lastWeek: null } }), AT);
    return d.progress.headline.length > 0 && d.progress.headline !== 'Tu progreso';
  }));
  check('an unknown trend degrades to a safe headline instead of crashing', projectDailySession(mkSession({ recentProgress: { trend: 'martian', adherence7d: null, loggingStreakDays: 0, lastWeek: null } } as any), AT).progress.headline === 'Tu progreso');
  check('adherence with no data reads "sin datos", never 0%', projectDailySession(mkSession({ recentProgress: { trend: 'on_track', adherence7d: null, loggingStreakDays: 0, lastWeek: null } }), AT).progress.metrics.some((m) => m.value === 'sin datos'));

  // ── integration: the real engine graph ──
  console.log('\n── V5.1: INTEGRATION (real engines; runtime, planner, meals, commitments, vision, review) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-daily-'));
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
  const foodSvc = new FoodService(new LocalFoodAdapter(prisma));
  const mealPlanner = new MealPlannerService(coaching, foodSvc);
  const recommendations = new RecommendationsService(prisma, state);
  const runtime = new NutritionCopilotRuntime(coaching, planner, mealPlanner, recommendations);

  const user = await prisma.user.create({ data: { email: 'daily@test.local' } });
  await prisma.userProfile.create({ data: { userId: user.id, name: 'D', age: 30, weightKg: 80, heightCm: 178, sex: 'MALE', activityLevel: 'MODERATE', fitnessLevel: 'BEGINNER' } });
  await prisma.goal.create({ data: { userId: user.id, type: 'LOSE_FAT', targetCalories: 2000, proteinG: 150, carbsG: 200, fatG: 60, fiberTargetG: 30, waterMl: 2500, bmr: 1600, tdee: 2300, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300 } });

  // Warm the engines' own lazy caches so the write assertion measures V5.1.
  await runtime.daily(user.id, AT);
  const before = { state: await prisma.userNutritionState.count(), meals: await prisma.loggedMeal.count(), recs: await prisma.recommendation.count(), goals: await prisma.goal.count() };

  const d1 = await runtime.daily(user.id, AT);
  const d2 = await runtime.daily(user.id, AT);
  check('the runtime produces a versioned daily session over the real graph', d1.meta.version === DAILY_COPILOT_CONTRACT_VERSION && d1.meta.generatedAt === AT);
  check('EXACTLY ONE focus, with a title and a why', !!d1.focus.area && d1.focus.title.length > 0 && d1.focus.why.length > 0);
  check('a fresh user (no meals) focuses on logging and gets the Vision CTA', d1.focus.area === 'LOGGING' && d1.visionCta !== null);
  check('…and the meal list is empty WITH the audited reason (Meal Planner silenced)', d1.meals.items.length === 0 && !!d1.meals.note);
  check('the plan always has at least the priority action', d1.todaysPlan.actions.length >= 1 && d1.todaysPlan.actions[0].kind === 'PRIORITY');
  check('no duplicate action text within the plan', new Set(d1.todaysPlan.actions.map((a) => a.text.toLowerCase())).size === d1.todaysPlan.actions.length);
  check('progress carries real metrics from the state engine', d1.progress.metrics.length >= 4 && d1.progress.headline.length > 0);
  check('the coordination session stays available alongside the daily one', (await runtime.session(user.id, AT)).silenced.length > 0);
  check('DETERMINISM against the real graph', JSON.stringify(d1) === JSON.stringify(d2));

  const after = { state: await prisma.userNutritionState.count(), meals: await prisma.loggedMeal.count(), recs: await prisma.recommendation.count(), goals: await prisma.goal.count() };
  check('ZERO WRITES: the daily projection added no rows', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Unified Daily Copilot (V5.1)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
