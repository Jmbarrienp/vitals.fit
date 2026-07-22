/**
 * Smoke test for Nutrition Copilot Runtime V5.0. Embedded Postgres for the
 * composition integration; the coordination itself is pure and tested directly
 * with hand-built engine outputs.
 *
 *   npm run smoke:copilot
 *
 * Verifies: the focus ladder (logging > commitment > persisting issue > plan
 * adjustment > maintain), next-action priority (commitment > active nudge >
 * coach > planner), silencing with recorded reasons, redundancy dedupe (one
 * voice per problem), pure composition (every string quoted from its owner),
 * determinism, and — against the real engine graph — that the runtime ADDS no
 * writes beyond its engines' own lazy caches.
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

const PORT = 59449;
const DB = 'vitals_copilot_smoke';
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
import { composeSession, deriveFocus, confidenceLabel } from '../src/copilot/pipeline/session-composer';
import { COPILOT_CONTRACT_VERSION } from '../src/copilot/types/copilot-contract';
import { CoachingContext } from '../src/nutrition-state/types/coaching-context';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const AT = '2026-07-16T12:00:00.000Z';

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
  for (const d of dirs) await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8'));
  await client.end();
}

// ── hand-built engine outputs (the composer must only CONSUME these) ──
function mkCtx(over: any = {}): CoachingContext {
  const base: CoachingContext = {
    meta: { contract: 'vitals-fit.coaching-context', version: 1, depth: 'full', generatedAt: AT, locale: 'es' },
    user: { goal: 'lose', persona: 'beginner', sex: 'male' },
    targets: { tdee: 2300, calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    today: { caloriesLogged: 1200, proteinG: 90, carbsG: 100, fatG: 40, mealsLogged: 2, recentMeals: [] },
    currentState: {
      computedAt: AT,
      adherenceScore: 80,
      nutritionScore: 75,
      trendStatus: 'on_track',
      plateauStatus: 'NONE',
      behaviorFlags: [],
      adherencePct7d: 82,
      daysLogged7d: 6,
      avgCalories7d: 1950,
      streaks: { loggingDays: 6, proteinDays: 4, calorieDays: 5 },
      weight: { currentKg: 80, trendKgPerWeek: -0.4, dataPoints: 5 },
    },
    history: {
      weeks: [
        {
          weekStart: '2026-07-06',
          adherenceScore: 78,
          nutritionScore: 72,
          trendStatus: 'on_track',
          plateauStatus: 'NONE',
          behaviorFlags: [],
          daysLogged: 6,
          avgCalories: 1980,
          avgProtein: 140,
          commitmentsCompleted: 1,
          commitmentsExpired: 0,
          primaryIssue: null,
          primaryImprovement: 'ADHERENCE_IMPROVED',
        } as any,
        {} as any,
        {} as any,
      ].slice(0, 3),
    },
    review: null,
    commitments: { active: [] },
  };
  return {
    ...base,
    ...over,
    currentState: { ...base.currentState, ...(over.currentState ?? {}) },
    today: { ...base.today, ...(over.today ?? {}) },
    commitments: over.commitments ?? base.commitments,
    history: over.history ?? base.history,
  };
}
const mkPlan = (over: any = {}) =>
  ({
    meta: { planner: 'vitals-fit.adaptive-planner', version: 1, contractVersion: 1, weeksAnalyzed: 3, generatedAt: AT },
    posture: 'STABLE',
    headline: {
      code: 'HOLD_PLAN',
      dimension: 'calories',
      confidence: 'HIGH',
      explanation: 'mantener el plan actual',
      evidence: [],
      adjustment: null,
      reviewWindowDays: 14,
    },
    decisions: [
      {
        code: 'HOLD_PLAN',
        dimension: 'calories',
        confidence: 'HIGH',
        explanation: 'mantener el plan actual',
        evidence: [],
        adjustment: null,
        reviewWindowDays: 14,
      },
    ],
    reviewWindowDays: 14,
    ...over,
  }) as any;
const mkMealPlan = () =>
  ({
    meta: { planner: 'vitals-fit.meal-planner', version: 1, contractVersion: 1, plannerVersion: 1, generatedAt: AT },
    targets: { source: 'GOAL', calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    meals: [
      { name: 'Pollo con arroz' },
      { name: 'Avena con fruta' },
      { name: 'Ensalada con atún' },
      { name: 'Yogur griego' },
    ],
    totals: { calories: 1990, proteinG: 148, carbsG: 195, fatG: 58 },
    adaptations: [],
    confidence: 'HIGH',
    rationale: { drivers: [], summary: 'plan según tus comidas habituales' },
    coverage: { fromUserFoods: 3, totalItems: 4 },
    reviewWindowDays: 14,
    reviewDate: AT,
  }) as any;
const mkCoach = (nextAction = 'Sube tu proteína del desayuno a 30g') =>
  ({
    summary: 'Semana sólida: 6/7 días registrados.',
    diagnosis: 'La proteína del desayuno sigue baja.',
    nextAction,
    optionalFollowUp: null,
    meta: { source: 'deterministic', outputVersion: 1, promptVersion: null, grounding: {} },
  }) as any;

async function main() {
  console.log('── V5.0: FOCUS LADDER (first match wins, every rung explained) ──');
  const broken = mkCtx({ today: { mealsLogged: 0 }, currentState: { daysLogged7d: 1 } });
  check('broken logging loop -> LOGGING outranks everything', deriveFocus(broken, mkPlan()).area === 'LOGGING');
  const committed = mkCtx({
    commitments: {
      active: [
        { reason: 'PROTEIN_CHRONIC_LOW', message: 'Comer 30g de proteína al desayuno', expiresAt: '2026-07-18' },
      ],
    },
  });
  check('a live commitment outranks new advice', deriveFocus(committed, mkPlan()).area === 'COMMITMENT');
  const persisting = mkCtx({
    review: {
      weekStart: '2026-07-06',
      improvedMetrics: [],
      worsenedMetrics: [],
      biggestOpportunity: null,
      biggestImprovement: null,
      commitmentOutcomes: [],
      followUp: {
        resolved: [],
        persisting: [{ issue: 'PROTEIN_CHRONIC_LOW', weeksActive: 3, intervention: 'IGNORED' }],
        emerged: [],
      },
      nextPriority: null,
    },
  });
  check(
    'a persisting issue outranks a plan change',
    deriveFocus(persisting, mkPlan({ posture: 'EVOLVING' })).area === 'ISSUE',
  );
  check(
    'an EVOLVING plan outranks maintenance',
    deriveFocus(mkCtx(), mkPlan({ posture: 'EVOLVING' })).area === 'ADJUSTMENT',
  );
  check('all green -> MAINTAIN, protecting the streak', deriveFocus(mkCtx(), mkPlan()).area === 'MAINTAIN');
  check('every focus carries its reason', deriveFocus(broken, mkPlan()).reason.includes('registro'));

  console.log('\n── V5.0: NEXT ACTION PRIORITY (commitment > nudge > coach > planner) ──');
  const sCommit = composeSession(
    {
      ctx: committed,
      plan: mkPlan(),
      mealPlan: mkMealPlan(),
      coach: mkCoach(),
      recommendations: [{ message: 'nudge', reason: null, status: 'PENDING', priority: 1 }],
    },
    AT,
  );
  check(
    'a commitment owns the next action even with nudges present',
    sCommit.nextAction.source === 'COMMITMENTS' && sCommit.nextAction.action.includes('30g'),
  );
  const sRec = composeSession(
    {
      ctx: mkCtx(),
      plan: mkPlan(),
      mealPlan: mkMealPlan(),
      coach: mkCoach(),
      recommendations: [
        { message: 'Reduce el picoteo nocturno', reason: 'X', status: 'PENDING', priority: 1 },
        { message: 'otro', reason: null, status: 'PENDING', priority: 2 },
      ],
    },
    AT,
  );
  check(
    'with no commitment, the top nudge speaks',
    sRec.nextAction.source === 'RECOMMENDATIONS' && sRec.nextAction.action.includes('picoteo'),
  );
  check(
    '…and the extra nudges are held, with the reason recorded',
    sRec.silenced.some((s) => s.module === 'RECOMMENDATIONS' && s.reason.includes('una acción a la vez')),
  );
  const sCoach = composeSession(
    { ctx: mkCtx(), plan: mkPlan(), mealPlan: mkMealPlan(), coach: mkCoach(), recommendations: [] },
    AT,
  );
  check('with nothing else, the coach speaks', sCoach.nextAction.source === 'WEEKLY_COACH');
  const sPlanner = composeSession(
    { ctx: mkCtx(), plan: mkPlan(), mealPlan: mkMealPlan(), coach: null, recommendations: [] },
    AT,
  );
  check('with no coach either, the planner headline guides', sPlanner.nextAction.source === 'PLANNER');

  console.log('\n── V5.0: SILENCE + REDUNDANCY (coordination is auditable) ──');
  const sLogging = composeSession(
    { ctx: broken, plan: mkPlan(), mealPlan: mkMealPlan(), coach: mkCoach(), recommendations: [] },
    AT,
  );
  check(
    'LOGGING focus silences the meal planner (meals before logging = noise)',
    sLogging.mealSuggestions.length === 0 && sLogging.silenced.some((s) => s.module === 'MEAL_PLANNER'),
  );
  check(
    '…and Vision speaks as the low-friction logging affordance',
    sLogging.visionSuggestions.length === 1 && sLogging.visionSuggestions[0].code === 'VISION_CAPTURE_AFFORDANCE',
  );
  check(
    'when logging flows, Vision stays quiet — recorded',
    sCoach.visionSuggestions.length === 0 && sCoach.silenced.some((s) => s.module === 'VISION'),
  );
  const dupCoach = mkCoach('Reduce el picoteo nocturno');
  const sDedupe = composeSession(
    {
      ctx: mkCtx(),
      plan: mkPlan(),
      mealPlan: mkMealPlan(),
      coach: dupCoach,
      recommendations: [{ message: 'Reduce el picoteo nocturno', reason: null, status: 'PENDING', priority: 1 }],
    },
    AT,
  );
  check(
    'REDUNDANCY: the coach repeating the chosen action is silenced — one voice per problem',
    sDedupe.coachSummary === null &&
      sDedupe.silenced.some((s) => s.module === 'WEEKLY_COACH' && s.reason.includes('una sola voz')),
  );
  check('a coach with a DIFFERENT message is not silenced', sRec.coachSummary !== null);
  check(
    'meal suggestions are capped and quoted verbatim',
    sCoach.mealSuggestions.length === 3 && sCoach.mealSuggestions[0].text === 'Pollo con arroz',
  );

  console.log('\n── V5.0: PURE COMPOSITION (quotes owners; adds nothing) ──');
  check(
    "the plan section is the planner's own words",
    sCoach.currentPlan.headlineExplanation === 'mantener el plan actual' &&
      sCoach.currentPlan.headlineCode === 'HOLD_PLAN',
  );
  check("planner recommendations carry the planner's codes", sCoach.plannerRecommendations[0].code === 'HOLD_PLAN');
  check(
    'goals/today come from CoachingContext verbatim',
    sCoach.currentGoals.calories === 2000 && sCoach.currentGoals.mealsLoggedToday === 2,
  );
  check(
    'consumed contract versions are pinned in meta',
    sCoach.meta.consumes.coachingContext === 1 &&
      sCoach.meta.consumes.planner === 1 &&
      sCoach.meta.version === COPILOT_CONTRACT_VERSION,
  );
  check(
    'no weight data -> the platform ASKS instead of guessing',
    composeSession(
      {
        ctx: mkCtx({ currentState: { weight: { currentKg: null, trendKgPerWeek: null, dataPoints: 0 } } }),
        plan: mkPlan(),
        mealPlan: mkMealPlan(),
        coach: null,
        recommendations: [],
      },
      AT,
    ).pendingQuestions.length === 1,
  );
  check(
    'confidence is an evidence count label',
    confidenceLabel(mkCtx()) === 'ALTA' && confidenceLabel(broken) === 'BAJA',
  );
  check(
    'DETERMINISM: same inputs + timestamp -> byte-identical session',
    JSON.stringify(
      composeSession(
        { ctx: mkCtx(), plan: mkPlan(), mealPlan: mkMealPlan(), coach: mkCoach(), recommendations: [] },
        AT,
      ),
    ) === JSON.stringify(sCoach),
  );

  // ── integration: the real engine graph, composed ──
  console.log('\n── V5.0: INTEGRATION (real engines, composed; runtime adds no writes) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-copilot-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
  });
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

  const user = await prisma.user.create({ data: { email: 'copilot@test.local' } });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      name: 'C',
      age: 30,
      weightKg: 80,
      heightCm: 178,
      sex: 'MALE',
      activityLevel: 'MODERATE',
      fitnessLevel: 'BEGINNER',
    },
  });
  await prisma.goal.create({
    data: {
      userId: user.id,
      type: 'LOSE_FAT',
      targetCalories: 2000,
      proteinG: 150,
      carbsG: 200,
      fatG: 60,
      fiberTargetG: 30,
      waterMl: 2500,
      bmr: 1600,
      tdee: 2300,
      formulaUsed: 'mifflin_st_jeor',
      goalAdjustment: -300,
    },
  });

  // Warm the engines' own lazy caches first, so the write-freedom assertion
  // measures the RUNTIME, not its engines' by-design cache fills.
  await runtime.session(user.id, AT);
  const before = {
    state: await prisma.userNutritionState.count(),
    meals: await prisma.loggedMeal.count(),
    recs: await prisma.recommendation.count(),
    goals: await prisma.goal.count(),
  };

  const s1 = await runtime.session(user.id, AT);
  const s2 = await runtime.session(user.id, AT);
  check(
    'the runtime produces a versioned session over the real graph',
    s1.meta.version === COPILOT_CONTRACT_VERSION && s1.meta.generatedAt === AT,
  );
  check(
    'a fresh user with no meals -> focus LOGGING, Vision offered as the affordance',
    s1.currentFocus.area === 'LOGGING' && s1.visionSuggestions.length === 1,
  );
  check(
    'the session composes ALL engines (plan + meal plan + state present)',
    s1.currentPlan.headlineCode.length > 0 && s1.currentGoals.calories === 2000 && s1.meta.consumes.mealPlanner >= 1,
  );
  check('coordination is audited even here (silenced[] populated)', s1.silenced.length > 0);
  check(
    'DETERMINISM against the real graph: two sessions, same timestamp, identical',
    JSON.stringify(s1) === JSON.stringify(s2),
  );

  const after = {
    state: await prisma.userNutritionState.count(),
    meals: await prisma.loggedMeal.count(),
    recs: await prisma.recommendation.count(),
    goals: await prisma.goal.count(),
  };
  check(
    "READ-ONLY: the runtime added ZERO rows beyond its engines' warmed caches",
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );

  await prisma.$disconnect();
  try {
    await pg.stop();
  } catch {
    /* teardown */
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  console.log(
    `\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Nutrition Copilot Runtime (V5.0)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
