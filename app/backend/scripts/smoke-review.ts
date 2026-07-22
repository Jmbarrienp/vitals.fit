/**
 * Smoke test for the Weekly Review + Behavior Follow-Up engine (Phase 2B.3). Runs
 * entirely against a throwaway EMBEDDED local Postgres. NEVER reads .env, NEVER
 * touches production.
 *
 *   npm run smoke:review
 *
 * Verifies the review is a deterministic projection over the immutable ledger +
 * recommendation lifecycle: week-over-week comparison, follow-up classification
 * (resolved / persisting / intervention outcomes), next-priority selection, and
 * retention instrumentation. Reads NO raw logs.
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

const PORT = 59436;
const DB = 'vitals_review_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { PrismaService } from '../src/prisma/prisma.service';
import { WeeklyLedgerService } from '../src/nutrition-state/weekly-ledger.service';
import { WeeklyReviewService } from '../src/nutrition-state/weekly-review.service';
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-review-'));
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
  const ledger = new WeeklyLedgerService(prisma);
  const review = new WeeklyReviewService(prisma, ledger);

  const currentWeekStart = isoWeekStartUTC(new Date());
  const weekC = addDaysUTC(currentWeekStart, -7);
  const weekB = addDaysUTC(currentWeekStart, -14);
  const weekA = addDaysUTC(currentWeekStart, -21);

  const logDay = async (userId: string, date: Date, proteinG: number) =>
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
  const mkGoal = (userId: string) =>
    prisma.goal.create({
      data: {
        userId,
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

  // ── USER 1: protein low (weekA, weekB) then resolved (weekC), with a committed
  //    intervention that completes in weekC → successful intervention. ──
  const u1 = await prisma.user.create({ data: { email: 'review-resolved@test.local' } });
  await mkGoal(u1.id);
  for (let i = 0; i < 5; i++) await logDay(u1.id, addDaysUTC(weekA, i), 60); // protein low
  for (let i = 0; i < 5; i++) await logDay(u1.id, addDaysUTC(weekB, i), 60); // protein still low
  for (let i = 0; i < 7; i++) await logDay(u1.id, addDaysUTC(weekC, i), 150); // protein fixed, full week
  await prisma.recommendation.create({
    data: {
      userId: u1.id,
      type: 'BEHAVIOR_RECOMMENDATION',
      priority: 'MEDIUM',
      trigger: 'meal.logged',
      reason: 'PROTEIN_CHRONIC_LOW',
      messageForUser: 'Sube 25g de proteína al desayuno.',
      status: 'COMPLETED',
      createdAt: addDaysUTC(weekA, 1),
      committedAt: addDaysUTC(weekA, 2),
      commitExpiresAt: addDaysUTC(weekB, 2),
      completedAt: addDaysUTC(weekC, 2),
    },
  });

  const snap1 = await review.getReviewSnapshot(u1.id);
  console.log('\n── USER 1: resolved + successful intervention ──');
  check('hasReview true', snap1.hasReview === true);
  check(
    'current week = weekC',
    snap1.current?.weekStart === weekC.toISOString().slice(0, 10),
    `${snap1.current?.weekStart}`,
  );
  check(
    'previous week = weekB',
    snap1.previous?.weekStart === weekB.toISOString().slice(0, 10),
    `${snap1.previous?.weekStart}`,
  );
  check(
    'current has no open issue (biggestOpportunity null)',
    snap1.current?.biggestOpportunity === null,
    `${snap1.current?.biggestOpportunity}`,
  );
  check(
    'improved includes proteinStreakDays',
    !!snap1.current?.improved.some((m) => m.metric === 'proteinStreakDays'),
    snap1.current?.improved.map((m) => m.metric).join(','),
  );
  check('improved includes daysLogged (7 vs 5)', !!snap1.current?.improved.some((m) => m.metric === 'daysLogged'));
  check(
    'biggestImprovement = ADHERENCE_IMPROVED',
    snap1.current?.biggestImprovement === 'ADHERENCE_IMPROVED',
    `${snap1.current?.biggestImprovement}`,
  );
  check(
    'followUp.resolved has PROTEIN_CHRONIC_LOW',
    snap1.followUp.resolved.some((i) => i.issue === 'PROTEIN_CHRONIC_LOW'),
  );
  check(
    'resolved issue weeksActive = 2 (weekA + weekB)',
    snap1.followUp.resolved.find((i) => i.issue === 'PROTEIN_CHRONIC_LOW')?.weeksActive === 2,
    `${snap1.followUp.resolved[0]?.weeksActive}`,
  );
  check(
    'resolved issue marked INTERVENED',
    snap1.followUp.resolved.find((i) => i.issue === 'PROTEIN_CHRONIC_LOW')?.intervention === 'INTERVENED',
  );
  check(
    'successfulInterventions = 1',
    snap1.followUp.successfulInterventions === 1,
    `${snap1.followUp.successfulInterventions}`,
  );
  check('repeatedFailures = 0', snap1.followUp.repeatedFailures === 0);
  check(
    'nextPriority basis RESOLVED_NEXT',
    snap1.nextPriorities[0]?.basis === 'RESOLVED_NEXT',
    `${snap1.nextPriorities[0]?.basis}`,
  );
  check(
    'weekC commitment outcome COMPLETED (protein)',
    snap1.current?.commitments.outcomes.some((o) => o.status === 'COMPLETED' && o.reason === 'PROTEIN_CHRONIC_LOW'),
  );
  check('retention.weeksTracked = 3', snap1.retention.weeksTracked === 3, `${snap1.retention.weeksTracked}`);
  check(
    'retention.commitmentCompletionRate = 1',
    snap1.retention.commitmentCompletionRate === 1,
    `${snap1.retention.commitmentCompletionRate}`,
  );
  check(
    'retention.interventionSuccessRate = 1',
    snap1.retention.interventionSuccessRate === 1,
    `${snap1.retention.interventionSuccessRate}`,
  );
  check('retention.weeklyConsistency present', typeof snap1.retention.weeklyConsistency === 'number');

  // ── USER 2: protein low both weeks, committed intervention, issue persists →
  //    repeated failure, "different intervention" next. ──
  const u2 = await prisma.user.create({ data: { email: 'review-persist@test.local' } });
  await mkGoal(u2.id);
  for (let i = 0; i < 5; i++) await logDay(u2.id, addDaysUTC(weekB, i), 60);
  for (let i = 0; i < 5; i++) await logDay(u2.id, addDaysUTC(weekC, i), 60); // still low
  await prisma.recommendation.create({
    data: {
      userId: u2.id,
      type: 'BEHAVIOR_RECOMMENDATION',
      priority: 'MEDIUM',
      trigger: 'meal.logged',
      reason: 'PROTEIN_CHRONIC_LOW',
      messageForUser: 'Sube proteína.',
      status: 'COMMITTED',
      createdAt: addDaysUTC(weekB, 1),
      committedAt: addDaysUTC(weekB, 2),
      commitExpiresAt: addDaysUTC(weekC, 6),
    },
  });

  const snap2 = await review.getReviewSnapshot(u2.id);
  console.log('\n── USER 2: persisting + intervened → repeated failure ──');
  check(
    'followUp.persisting has PROTEIN_CHRONIC_LOW',
    snap2.followUp.persisting.some((i) => i.issue === 'PROTEIN_CHRONIC_LOW'),
  );
  check(
    'persisting issue INTERVENED',
    snap2.followUp.persisting.find((i) => i.issue === 'PROTEIN_CHRONIC_LOW')?.intervention === 'INTERVENED',
  );
  check('repeatedFailures = 1', snap2.followUp.repeatedFailures === 1, `${snap2.followUp.repeatedFailures}`);
  check('successfulInterventions = 0', snap2.followUp.successfulInterventions === 0);
  check(
    'nextPriority basis PERSISTENT_INTERVENED',
    snap2.nextPriorities[0]?.basis === 'PERSISTENT_INTERVENED',
    `${snap2.nextPriorities[0]?.basis}`,
  );
  check('nextPriority reason PROTEIN_CHRONIC_LOW', snap2.nextPriorities[0]?.reason === 'PROTEIN_CHRONIC_LOW');

  // ── USER 3: no completed week → empty review (no crash, hasReview false). ──
  const u3 = await prisma.user.create({ data: { email: 'review-empty@test.local' } });
  await mkGoal(u3.id);
  await logDay(u3.id, addDaysUTC(currentWeekStart, 0), 150); // only the in-progress week
  const snap3 = await review.getReviewSnapshot(u3.id);
  console.log('\n── USER 3: no completed week ──');
  check('hasReview false when no completed week', snap3.hasReview === false);
  check(
    'empty snapshot: current null, followUp empty, no priorities',
    snap3.current === null && snap3.followUp.persisting.length === 0 && snap3.nextPriorities.length === 0,
  );

  // ── DETERMINISM: re-running the read yields an identical projection ──
  const snap1b = await review.getReviewSnapshot(u1.id);
  check('deterministic: repeated review is identical', JSON.stringify(snap1b) === JSON.stringify(snap1));

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

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Weekly Review`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
