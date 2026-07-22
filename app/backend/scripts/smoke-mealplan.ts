/**
 * Smoke test for the Adaptive Meal Planning engine (Phase 2D.1). The engine is a
 * PURE function of (planner strategy + targets + behaviour + food pool), so most
 * assertions build synthetic inputs to exercise every adaptation deterministically.
 * One integration case boots an EMBEDDED local Postgres to confirm the service
 * wires the real context + planner + food catalog into the engine. NEVER reads
 * .env, NEVER touches production.
 *
 *   npm run smoke:mealplan
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

const PORT = 59440;
const DB = 'vitals_mealplan_smoke';
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
import { FoodService } from '../src/food/food.service';
import { LocalFoodAdapter } from '../src/food/adapters/local.adapter';
import { MealPlannerService } from '../src/meal-planner/meal-planner.service';
import { buildMealPlan, MealCandidate, MealPlanInput } from '../src/meal-planner/meal-planner.engine';
import { NutritionPlan, PlanDecision, PlanDecisionCode } from '../src/planner/types/nutrition-plan';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
}

// ── synthetic inputs ──
function pool(): MealCandidate[] {
  return [
    {
      id: 'chicken',
      name: 'Pollo',
      kcal100: 165,
      prot100: 31,
      carb100: 0,
      fat100: 3.6,
      priorityRank: 0,
      userOwned: true,
    },
    {
      id: 'rice',
      name: 'Arroz',
      kcal100: 130,
      prot100: 2.7,
      carb100: 28,
      fat100: 0.3,
      priorityRank: 1,
      userOwned: true,
    },
    {
      id: 'egg',
      name: 'Huevo',
      kcal100: 143,
      prot100: 13,
      carb100: 1.1,
      fat100: 9.5,
      priorityRank: 2,
      userOwned: true,
    },
    {
      id: 'broccoli',
      name: 'Brocoli',
      kcal100: 34,
      prot100: 2.8,
      carb100: 7,
      fat100: 0.4,
      priorityRank: 2,
      userOwned: true,
    },
    { id: 'oats', name: 'Avena', kcal100: 389, prot100: 17, carb100: 66, fat100: 7, priorityRank: 4, userOwned: false },
    {
      id: 'sweetpotato',
      name: 'Camote',
      kcal100: 86,
      prot100: 1.6,
      carb100: 20,
      fat100: 0.1,
      priorityRank: 4,
      userOwned: false,
    },
  ];
}
function mkDecision(code: PlanDecisionCode, over: Partial<PlanDecision> = {}): PlanDecision {
  return {
    code,
    dimension: 'CALORIES',
    confidence: 'MEDIUM',
    explanation: '',
    evidence: [],
    adjustment: null,
    reviewWindowDays: 7,
    ...over,
  };
}
function mkPlan(headline: PlanDecision, decisions: PlanDecision[], posture: any = 'STABLE'): NutritionPlan {
  return {
    meta: {
      planner: 'vitals-fit.adaptive-planner',
      version: 1,
      contractVersion: 1,
      weeksAnalyzed: 3,
      generatedAt: '2026-07-14T00:00:00.000Z',
    },
    posture,
    headline,
    decisions,
    reviewWindowDays: headline.reviewWindowDays,
  };
}
function mkInput(over: Partial<MealPlanInput> = {}): MealPlanInput {
  const keep = mkDecision('KEEP_PLAN');
  return {
    contractVersion: 1,
    plannerVersion: 1,
    generatedAt: '2026-07-14T00:00:00.000Z',
    goalDirection: 'lose',
    goalTargets: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
    plan: mkPlan(keep, [keep]),
    behaviorFlags: [],
    nutritionScore: 80,
    pool: pool(),
    ...over,
  };
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

function strip(p: any) {
  return { ...p, meta: { ...p.meta, generatedAt: 'X' }, reviewDate: 'X' };
}

async function main() {
  // ── PART A: pure engine ──
  console.log('── STRUCTURE ──');
  const base = buildMealPlan(mkInput());
  check(
    '3 meals for a standard lose plan',
    base.meals.length === 3 && base.meals.map((m) => m.slot).join(',') === 'BREAKFAST,LUNCH,DINNER',
  );
  check(
    'targets source = current-goal (no planner change)',
    base.targets.source === 'current-goal' && base.targets.calories === 2000,
  );
  check(
    'every meal has at least a protein anchor',
    base.meals.every((m) => m.items.length >= 1),
  );
  check(
    'totals land near the calorie target',
    Math.abs(base.totals.calories - 2000) / 2000 <= 0.25,
    `${base.totals.calories}`,
  );
  check(
    'coverage counts user-owned foods',
    base.coverage.fromUserFoods > 0 && base.coverage.totalItems >= base.coverage.fromUserFoods,
  );
  check(
    'protein anchor is the favorite (Pollo)',
    base.meals[0].items[0].name === 'Pollo' && base.meals[0].items[0].source === 'favorite',
  );
  check('variety: breakfast and lunch anchors differ', base.meals[0].items[0].foodId !== base.meals[1].items[0].foodId);

  console.log('\n── EXECUTES PLANNER STRATEGY ──');
  const cut = mkDecision('REDUCE_CALORIES', {
    adjustment: { calorieDelta: -200, newCalorieTarget: 1800 },
    reviewWindowDays: 14,
  });
  const reducePlan = buildMealPlan(mkInput({ plan: mkPlan(cut, [cut], 'EVOLVING') }));
  check(
    'meal plan executes the planner-adjusted calories (1800)',
    reducePlan.targets.source === 'planner-adjusted' && reducePlan.targets.calories === 1800,
    `${reducePlan.targets.calories}`,
  );
  check('REDUCE_CALORIES -> LIGHTER_MEALS adaptation', reducePlan.adaptations.includes('LIGHTER_MEALS'));
  check('review window inherited from the planner (14d)', reducePlan.reviewWindowDays === 14);
  check('rationale drivers include the planner decision', reducePlan.rationale.drivers.includes('REDUCE_CALORIES'));

  console.log('\n── ADAPTATIONS ──');
  const proteinLow = buildMealPlan(mkInput({ behaviorFlags: ['PROTEIN_CHRONIC_LOW'] }));
  check('PROTEIN_CHRONIC_LOW -> PROTEIN_TO_BREAKFAST', proteinLow.adaptations.includes('PROTEIN_TO_BREAKFAST'));
  check(
    'breakfast gets more protein than dinner',
    proteinLow.meals[0].targetProteinG > proteinLow.meals[2].targetProteinG,
    `${proteinLow.meals[0].targetProteinG} vs ${proteinLow.meals[2].targetProteinG}`,
  );

  const adherenceFirst = buildMealPlan(
    mkInput({ plan: mkPlan(mkDecision('KEEP_PLAN'), [mkDecision('KEEP_PLAN')], 'ADHERENCE_FIRST') }),
  );
  check('ADHERENCE_FIRST -> SIMPLER_STRUCTURE', adherenceFirst.adaptations.includes('SIMPLER_STRUCTURE'));
  check(
    'simpler = at most 2 items per meal',
    adherenceFirst.meals.every((m) => m.items.length <= 2),
  );

  const gain = buildMealPlan(
    mkInput({ goalDirection: 'gain', goalTargets: { calories: 2900, proteinG: 160, carbsG: 320, fatG: 80 } }),
  );
  check(
    'gain (not simpler) -> EXTRA_SNACK, 4 meals',
    gain.adaptations.includes('EXTRA_SNACK') && gain.meals.length === 4,
  );

  console.log('\n── DETERMINISM & HYGIENE ──');
  check(
    'identical input -> identical plan',
    JSON.stringify(strip(buildMealPlan(mkInput()))) === JSON.stringify(strip(buildMealPlan(mkInput()))),
  );
  const json = JSON.stringify(base);
  check(
    'no userId / raw-log keys leaked',
    !json.includes('userId') && !json.includes('dailyLog') && !json.includes('loggedMeal'),
  );

  // ── PART B: integration (real context + planner + catalog) ──
  console.log('\n── INTEGRATION (real service) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-meal-'));
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
  const foodSvc = new FoodService(new LocalFoodAdapter(prisma));
  const mealPlanner = new MealPlannerService(coaching, foodSvc);

  const user = await prisma.user.create({ data: { email: 'meal@test.local' } });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      name: 'M',
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

  const mkFood = (name: string, kcal: number, p: number, c: number, f: number) =>
    prisma.foodItem.create({
      data: {
        name,
        nameLower: name.toLowerCase(),
        nameNormalized: name.toLowerCase(),
        nameAliases: [],
        caloriesPer100g: kcal,
        proteinPer100g: p,
        carbsPer100g: c,
        fatPer100g: f,
        fiberPer100g: 0,
        source: 'curated_latam',
        isCommon: true,
      },
    });
  const pollo = await mkFood('Pollo', 165, 31, 0, 3.6);
  await mkFood('Arroz', 130, 2.7, 28, 0.3);
  await mkFood('Brocoli', 34, 2.8, 7, 0.4);
  await prisma.foodFavorite.create({ data: { userId: user.id, foodItemId: pollo.id } });

  const mp = await mealPlanner.getMealPlan(user.id);
  check('service returns a meal plan', mp.meta.planner === 'vitals-fit.meal-planner' && mp.meals.length === 3);
  check(
    'targets from current goal (no completed weeks -> planner WAITs)',
    mp.targets.source === 'current-goal' && mp.targets.calories === 2000,
    `${mp.targets.calories}`,
  );
  check(
    'plan uses the favorited food (Pollo, source favorite)',
    mp.meals.some((m) => m.items.some((it) => it.name === 'Pollo' && it.source === 'favorite')),
  );
  check('coverage counts the user food', mp.coverage.fromUserFoods > 0);
  check(
    'service plan is deterministic on rebuild',
    JSON.stringify(strip(await mealPlanner.getMealPlan(user.id))) === JSON.stringify(strip(mp)),
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

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Adaptive Meal Planner`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
