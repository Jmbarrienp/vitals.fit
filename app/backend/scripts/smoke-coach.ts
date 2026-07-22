/**
 * Smoke test for the Weekly Coach (Phase 2C.1). Runs entirely against a throwaway
 * EMBEDDED local Postgres. NEVER reads .env, NEVER touches production. No network:
 * with no API key the service ships the deterministic coaching, which is exactly
 * what this test pins.
 *
 *   npm run smoke:coach
 *
 * Verifies: the coach consumes CoachingContext only, the STRUCTURE is deterministic
 * and grounded, the diagnosis/action are specific, the parser is robust, and a
 * missing model degrades to the deterministic coaching (never breaks, never fabricates).
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

const PORT = 59438;
const DB = 'vitals_coach_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;
delete process.env.ANTHROPIC_API_KEY; // force the no-model (deterministic) path

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { NutritionStateService } from '../src/nutrition-state/nutrition-state.service';
import { WeeklyLedgerService } from '../src/nutrition-state/weekly-ledger.service';
import { WeeklyReviewService } from '../src/nutrition-state/weekly-review.service';
import { CoachingContextService } from '../src/nutrition-state/coaching-context.service';
import { AnthropicService } from '../src/ai/services/anthropic.service';
import { TelemetryService } from '../src/ai/services/telemetry.service';
import { WeeklyCoachService } from '../src/coach/weekly-coach.service';
import { buildDeterministicCoach } from '../src/coach/weekly-coach.builder';
import { parseCoachResponse } from '../src/coach/weekly-coach.prompt';
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
    await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8'));
  }
  await client.end();
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-coach-'));
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
  const anthropic = new AnthropicService(new ConfigService());
  const coach = new WeeklyCoachService(coaching, anthropic, new TelemetryService(prisma));

  const currentWeekStart = isoWeekStartUTC(new Date());
  const weekC = addDaysUTC(currentWeekStart, -7);
  const weekB = addDaysUTC(currentWeekStart, -14);

  const mkUser = async (email: string) => {
    const u = await prisma.user.create({ data: { email } });
    await prisma.userProfile.create({
      data: {
        userId: u.id,
        name: 'T',
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
        userId: u.id,
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
    return u;
  };
  const logDay = (userId: string, date: Date, proteinG: number) =>
    prisma.dailyLog.create({
      data: {
        userId,
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

  // ── USER RESOLVED: low protein (weekB) -> fixed (weekC) + completed intervention. ──
  const uR = await mkUser('coach-resolved@test.local');
  for (let i = 0; i < 5; i++) await logDay(uR.id, addDaysUTC(weekB, i), 60);
  for (let i = 0; i < 7; i++) await logDay(uR.id, addDaysUTC(weekC, i), 150);
  await prisma.recommendation.create({
    data: {
      userId: uR.id,
      type: 'BEHAVIOR_RECOMMENDATION',
      priority: 'MEDIUM',
      trigger: 'meal.logged',
      reason: 'PROTEIN_CHRONIC_LOW',
      messageForUser: 'Sube proteina.',
      status: 'COMPLETED',
      createdAt: addDaysUTC(weekB, 1),
      committedAt: addDaysUTC(weekB, 2),
      commitExpiresAt: addDaysUTC(weekC, 2),
      completedAt: addDaysUTC(weekC, 2),
    },
  });

  const ctxR = await coaching.build(uR.id, 'full');
  const detR = buildDeterministicCoach(ctxR)!;
  console.log('\n── DETERMINISTIC COACH (resolved week) ──');
  check('structure: 4 sections, all required non-empty', !!detR.summary && !!detR.diagnosis && !!detR.nextAction);
  check('summary grounded in the week', detR.summary.includes('Semana del') && detR.summary.includes('7/7'));
  check(
    'primary reason = STEADY (issue resolved)',
    detR.meta.grounding.primaryReason === 'STEADY',
    detR.meta.grounding.primaryReason ?? 'null',
  );
  check(
    'grounding basis = RESOLVED_NEXT',
    detR.meta.grounding.nextPriorityBasis === 'RESOLVED_NEXT',
    `${detR.meta.grounding.nextPriorityBasis}`,
  );
  check(
    'follow-up acknowledges the improvement',
    !!detR.optionalFollowUp && detR.optionalFollowUp.toLowerCase().includes('adherencia'),
    detR.optionalFollowUp ?? 'null',
  );
  check(
    'source deterministic (no model)',
    detR.meta.source === 'deterministic' && detR.meta.grounding.contractVersion === 1,
  );

  // ── USER PERSIST: low protein both weeks -> specific protein coaching. ──
  const uP = await mkUser('coach-persist@test.local');
  for (let i = 0; i < 5; i++) await logDay(uP.id, addDaysUTC(weekB, i), 60);
  for (let i = 0; i < 5; i++) await logDay(uP.id, addDaysUTC(weekC, i), 60);
  await prisma.recommendation.create({
    data: {
      userId: uP.id,
      type: 'BEHAVIOR_RECOMMENDATION',
      priority: 'MEDIUM',
      trigger: 'meal.logged',
      reason: 'PROTEIN_CHRONIC_LOW',
      messageForUser: 'Sube proteina.',
      status: 'COMMITTED',
      createdAt: addDaysUTC(weekB, 1),
      committedAt: addDaysUTC(weekB, 2),
      commitExpiresAt: addDaysUTC(weekC, 6),
    },
  });

  const ctxP = await coaching.build(uP.id, 'full');
  const detP = buildDeterministicCoach(ctxP)!;
  console.log('\n── DETERMINISTIC COACH (persisting protein) ──');
  check(
    'primary reason = PROTEIN_CHRONIC_LOW',
    detP.meta.grounding.primaryReason === 'PROTEIN_CHRONIC_LOW',
    `${detP.meta.grounding.primaryReason}`,
  );
  check('diagnosis is about protein', detP.diagnosis.toLowerCase().includes('proteína'), detP.diagnosis);
  check(
    'nextAction is specific (grams + breakfast)',
    /\d+\s*g/.test(detP.nextAction) && detP.nextAction.toLowerCase().includes('desayuno'),
    detP.nextAction,
  );
  check('deterministic is idempotent', JSON.stringify(buildDeterministicCoach(ctxP)) === JSON.stringify(detP));

  // ── NO COMPLETED WEEK: coach gates off cleanly. ──
  const uN = await mkUser('coach-empty@test.local');
  await logDay(uN.id, addDaysUTC(currentWeekStart, 0), 150); // only the in-progress week
  const ctxN = await coaching.build(uN.id, 'full');
  check('no review -> builder returns null', buildDeterministicCoach(ctxN) === null);

  // ── SERVICE (no key) -> deterministic, gating honored. ──
  console.log('\n── SERVICE (no model configured) ──');
  const resP = await coach.getWeeklyCoaching(uP.id);
  check('service: hasCoaching true with output', resP.hasCoaching === true && !!resP.output);
  check('service: source deterministic when no key', resP.output?.meta.source === 'deterministic');
  const resN = await coach.getWeeklyCoaching(uN.id);
  check('service: hasCoaching false when no completed week', resN.hasCoaching === false && resN.output === null);

  // ── PARSER robustness (model-output tolerance). ──
  console.log('\n── PARSER ──');
  const good = parseCoachResponse(
    'RESUMEN: sem ok\nDIAGNOSTICO: proteina baja\nACCION: suma 30g\nSEGUIMIENTO: mejoro adherencia',
  );
  check(
    'parses a well-formed 4-line response',
    good?.summary === 'sem ok' && good?.nextAction === 'suma 30g' && good?.optionalFollowUp === 'mejoro adherencia',
  );
  const dash = parseCoachResponse('RESUMEN: a\nDIAGNOSTICO: b\nACCION: c\nSEGUIMIENTO: -');
  check('SEGUIMIENTO "-" maps to null follow-up', dash !== null && dash.optionalFollowUp === null);
  const missing = parseCoachResponse('RESUMEN: a\nACCION: c');
  check('missing required section -> null (caller falls back)', missing === null);
  const accented = parseCoachResponse('RESUMEN: a\nDIAGNÓSTICO: b\nACCIÓN: c\nSEGUIMIENTO: d');
  check('tolerates accented labels', accented?.diagnosis === 'b' && accented?.nextAction === 'c');

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

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Weekly Coach`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
