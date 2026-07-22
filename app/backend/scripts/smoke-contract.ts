/**
 * Smoke test for the CoachingContext — the model-agnostic intelligence contract
 * (Phase 2C.0). Runs entirely against a throwaway EMBEDDED local Postgres. NEVER
 * reads .env, NEVER touches production.
 *
 *   npm run smoke:contract
 *
 * Verifies the north star: a single deterministic snapshot any LLM can consume
 * with zero knowledge of the database schema — versioned, id-free, aggregate-only,
 * retention-free, with a pure canonical renderer.
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

const PORT = 59437;
const DB = 'vitals_contract_smoke';
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
import { renderCoachingContext } from '../src/nutrition-state/coaching-context.render';
import { COACHING_CONTRACT_VERSION, CoachingContext } from '../src/nutrition-state/types/coaching-context';
import { contextToInput } from '../src/recommendations/services/recommendation.service';
import { decideNudge } from '../src/recommendations/services/recommendation-engine';
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

/** Contract serialized with the informational generatedAt neutralized. */
function stableJson(ctx: CoachingContext): string {
  return JSON.stringify({ ...ctx, meta: { ...ctx.meta, generatedAt: 'X' } });
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-contract-'));
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
  const state = new NutritionStateService(prisma);
  const ledger = new WeeklyLedgerService(prisma);
  const review = new WeeklyReviewService(prisma, ledger);
  const coaching = new CoachingContextService(prisma, state, ledger, review);

  // ── Seed: protein issue in weekB, resolved in weekC via a completed commitment;
  //    one LIVE commitment; one meal logged today. ──
  const currentWeekStart = isoWeekStartUTC(new Date());
  const weekC = addDaysUTC(currentWeekStart, -7);
  const weekB = addDaysUTC(currentWeekStart, -14);

  const user = await prisma.user.create({ data: { email: 'contract@test.local' } });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      name: 'Contract Tester',
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

  const logDay = (date: Date, proteinG: number) =>
    prisma.dailyLog.create({
      data: {
        userId: user.id,
        date,
        caloriesLogged: 2000,
        proteinG,
        planFollowed: true,
        adherencePct: 1.0,
        loggedMeals: {
          create: [
            {
              mealType: 'BREAKFAST' as const,
              totalCalories: 600,
              totalProteinG: proteinG * 0.4,
              totalCarbsG: 60,
              totalFatG: 18,
            },
            {
              mealType: 'LUNCH' as const,
              totalCalories: 1400,
              totalProteinG: proteinG * 0.6,
              totalCarbsG: 140,
              totalFatG: 42,
            },
          ],
        },
      },
    });

  for (let i = 0; i < 5; i++) await logDay(addDaysUTC(weekB, i), 60); // low protein
  for (let i = 0; i < 7; i++) await logDay(addDaysUTC(weekC, i), 150); // resolved

  const localToday = new Date();
  localToday.setHours(0, 0, 0, 0);
  await prisma.dailyLog.create({
    data: {
      userId: user.id,
      date: localToday,
      caloriesLogged: 700,
      proteinG: 50,
      loggedMeals: {
        create: [
          {
            mealType: 'LUNCH' as const,
            totalCalories: 700,
            totalProteinG: 50,
            totalCarbsG: 70,
            totalFatG: 20,
            name: 'Pollo con arroz',
          },
        ],
      },
    },
  });

  for (const [d, kg] of [
    [addDaysUTC(weekB, 0), 80.0],
    [addDaysUTC(weekB, 3), 79.7],
    [addDaysUTC(weekC, 0), 79.3],
    [addDaysUTC(weekC, 3), 79.0],
  ] as const) {
    await prisma.weightLog.create({ data: { userId: user.id, date: d, weightKg: kg } });
  }

  // Completed intervention (weekB commit -> weekC completion) + one LIVE commitment.
  await prisma.recommendation.create({
    data: {
      userId: user.id,
      type: 'BEHAVIOR_RECOMMENDATION',
      priority: 'MEDIUM',
      trigger: 'meal.logged',
      reason: 'PROTEIN_CHRONIC_LOW',
      messageForUser: 'Sube 25g de proteina al desayuno.',
      status: 'COMPLETED',
      createdAt: addDaysUTC(weekB, 1),
      committedAt: addDaysUTC(weekB, 2),
      commitExpiresAt: addDaysUTC(weekC, 2),
      completedAt: addDaysUTC(weekC, 2),
    },
  });
  await prisma.recommendation.create({
    data: {
      userId: user.id,
      type: 'BEHAVIOR_RECOMMENDATION',
      priority: 'LOW',
      trigger: 'meal.logged',
      reason: 'BREAKFAST_SKIPPED',
      messageForUser: 'Desayuna con proteina antes de las 10am.',
      status: 'COMMITTED',
      createdAt: addDaysUTC(currentWeekStart, 0),
      committedAt: addDaysUTC(currentWeekStart, 0),
      commitExpiresAt: addDaysUTC(currentWeekStart, 14),
    },
  });

  // ── CONTRACT SHAPE + VERSIONING ──
  console.log('\n── CONTRACT ──');
  const full = await coaching.build(user.id, 'full');
  check(
    'meta: name + version pinned',
    full.meta.contract === 'vitals-fit.coaching-context' && full.meta.version === COACHING_CONTRACT_VERSION,
    `v${full.meta.version}`,
  );
  check(
    'user mapped to neutral vocabulary',
    full.user.goal === 'lose' && full.user.persona === 'beginner' && full.user.sex === 'male',
  );
  check('targets from goal', full.targets.calories === 2000 && full.targets.proteinG === 150);
  check(
    'today: 1 meal, 700 kcal, meal name present',
    full.today.mealsLogged === 1 && full.today.recentMeals[0]?.calories === 700,
  );
  check(
    'currentState: streaks + weight + scores present',
    full.currentState.streaks.loggingDays >= 0 &&
      full.currentState.weight.dataPoints === 4 &&
      full.currentState.adherenceScore !== null,
  );
  check(
    'history: 2 completed weeks, newest first',
    full.history.weeks.length === 2 && full.history.weeks[0].weekStart > full.history.weeks[1].weekStart,
    `${full.history.weeks.length}`,
  );
  check(
    'history week carries primaryIssue code',
    full.history.weeks[1].primaryIssue === 'PROTEIN_CHRONIC_LOW',
    `${full.history.weeks[1].primaryIssue}`,
  );
  check(
    'review present with resolved follow-up',
    !!full.review &&
      full.review.followUp.resolved.some((i) => i.issue === 'PROTEIN_CHRONIC_LOW' && i.intervention === 'INTERVENED'),
  );
  check(
    'review nextPriority RESOLVED_NEXT',
    full.review?.nextPriority?.basis === 'RESOLVED_NEXT',
    `${full.review?.nextPriority?.basis}`,
  );
  check(
    'commitments: 1 active with absolute expiry date',
    full.commitments.active.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(full.commitments.active[0].expiresAt),
  );

  // ── DECOUPLING: no schema leakage ──
  console.log('\n── DECOUPLING ──');
  const json = JSON.stringify(full);
  check(
    'no UUIDs anywhere in the payload',
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(json),
  );
  check('no userId key in the payload', !json.includes('"userId"'));
  check('no retention section (2B.3 constraint)', !json.includes('retention'));
  check(
    'no raw-log tables leaked (dailyLog/loggedMeal keys absent)',
    !json.includes('dailyLog') && !json.includes('loggedMeal'),
  );
  check('payload within size budget (<8KB)', json.length < 8192, `${json.length} bytes`);

  // ── DETERMINISM ──
  console.log('\n── DETERMINISM ──');
  const full2 = await coaching.build(user.id, 'full');
  check('same DB state -> identical contract (modulo generatedAt)', stableJson(full2) === stableJson(full));

  // ── DEPTH GATING ──
  console.log('\n── DEPTH ──');
  const daily = await coaching.build(user.id, 'today');
  check("depth 'today': no history, no review", daily.history.weeks.length === 0 && daily.review === null);
  check(
    "depth 'today': today/state/commitments still present",
    daily.today.mealsLogged === 1 &&
      daily.currentState.adherenceScore !== null &&
      daily.commitments.active.length === 1,
  );
  check('depth recorded in meta', daily.meta.depth === 'today' && full.meta.depth === 'full');

  // ── CANONICAL RENDERER (pure) ──
  console.log('\n── RENDERER ──');
  const prompt = renderCoachingContext(full);
  const prompt2 = renderCoachingContext(full2);
  check('renderer deterministic (same contract -> same string)', prompt === prompt2);
  check(
    'renderer omits generatedAt (pure of the clock)',
    !prompt.includes(full.meta.generatedAt) && !prompt2.includes(full2.meta.generatedAt),
  );
  check(
    'renders all sections',
    ['PERFIL', 'OBJETIVOS', 'HOY', 'ESTADO', 'HISTORIA SEMANAL', 'REVIEW', 'COMPROMISOS ACTIVOS'].every((s) =>
      prompt.includes(s),
    ),
    prompt.split('\n')[0],
  );
  check(
    'renders structured codes verbatim',
    prompt.includes('PROTEIN_CHRONIC_LOW') && prompt.includes('RESOLVED_NEXT'),
  );
  check('prompt within budget (<4000 chars)', prompt.length < 4000, `${prompt.length} chars`);

  // ── ENGINE BRIDGE (behavior-identical refactor) ──
  console.log('\n── ENGINE BRIDGE ──');
  const decided = decideNudge(contextToInput(daily));
  check(
    'contextToInput feeds the deterministic engine',
    typeof decided.message === 'string' && !!decided.reason,
    decided.reason,
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

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke CoachingContext`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
