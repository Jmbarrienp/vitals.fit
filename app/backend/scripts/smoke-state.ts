/**
 * Smoke test for UserNutritionState (Phase 2 — slice 1). Runs entirely against a
 * throwaway EMBEDDED local Postgres. NEVER reads .env, NEVER touches production.
 *
 *   npm run smoke:state
 *
 * Boots local PG, applies the real migrations (incl. user_nutrition_state), and
 * exercises NutritionStateService end-to-end: rollup aggregates, goal-aware weight
 * trend, lazy stale→recompute, and idempotency.
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

const PORT = 59433;
const DB = 'vitals_state_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { PrismaService } from '../src/prisma/prisma.service';
import { NutritionStateService } from '../src/nutrition-state/nutrition-state.service';
import { computeWeightTrend } from '../src/common/metrics/weight-trend';

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
    console.log(`   · applied ${d}`);
  }
  await client.end();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-state-'));
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

  // ── helper-level checks (pure regression) ──
  console.log('\n── HELPER ──');
  check('computeWeightTrend([]) → null', computeWeightTrend([]).weeklyRateKg === null);
  check(
    'computeWeightTrend(1 pt) → null rate, currentKg set',
    computeWeightTrend([{ date: daysAgo(1), weightKg: 80 }]).weeklyRateKg === null &&
      computeWeightTrend([{ date: daysAgo(1), weightKg: 80 }]).currentKg === 80,
  );
  const downhill = computeWeightTrend([
    { date: daysAgo(21), weightKg: 81 },
    { date: daysAgo(14), weightKg: 80.5 },
    { date: daysAgo(7), weightKg: 80 },
    { date: daysAgo(0), weightKg: 79.4 },
  ]);
  check('computeWeightTrend(downhill) → negative kg/wk', (downhill.weeklyRateKg ?? 0) < 0, `rate=${downhill.weeklyRateKg}`);

  // ── DB-level rollup ──
  console.log('\n── ROLLUP ──');
  const user = await prisma.user.create({ data: { email: 'state@test.local' } });
  const uid = user.id;
  await prisma.goal.create({
    data: {
      userId: uid, type: 'LOSE_FAT', targetCalories: 1900, proteinG: 150, carbsG: 180, fatG: 60,
      fiberTargetG: 30, waterMl: 2500, bmr: 1500, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300,
    },
  });

  // 1. Usuario nuevo (sin logs/pesos) → insufficient_data, ceros, snapshot de meta
  const s0 = await state.recompute(uid);
  check('nuevo: daysLogged7d=0 y daysLogged30d=0', s0.daysLogged7d === 0 && s0.daysLogged30d === 0);
  check('nuevo: avgCalories7d=null', s0.avgCalories7d === null);
  check('nuevo: trendStatus=insufficient_data', s0.trendStatus === 'insufficient_data');
  check('nuevo: snapshot de meta (target 1900)', s0.goalType === 'LOSE_FAT' && s0.calorieTarget === 1900);
  check('nuevo: stale=false, version=2 tras recompute', s0.stale === false && s0.version === 2);
  check('nuevo: scores null, plateau INSUFFICIENT_DATA, sin flags', s0.adherenceScore === null && s0.nutritionScore === null && s0.plateauStatus === 'INSUFFICIENT_DATA' && s0.behaviorFlags.length === 0);

  // 2. Insertar 4 días logueados (dentro de 7d) con 2 comidas c/u + streak
  await prisma.userHabits.create({ data: { userId: uid, currentStreak: 4 } });
  for (const [d, cal, prot] of [[1, 1800, 120], [2, 2000, 140], [3, 1700, 110], [5, 1900, 130]] as const) {
    await prisma.dailyLog.create({
      data: {
        userId: uid, date: daysAgo(d), caloriesLogged: cal, proteinG: prot, planFollowed: true, adherencePct: 0.9,
        loggedMeals: {
          create: [
            { mealType: 'LUNCH', totalCalories: Math.round(cal * 0.6), totalProteinG: prot * 0.6, totalCarbsG: 50, totalFatG: 20 },
            { mealType: 'DINNER', totalCalories: Math.round(cal * 0.4), totalProteinG: prot * 0.4, totalCarbsG: 30, totalFatG: 15 },
          ],
        },
      },
    });
  }
  // un día logueado fuera de 7d pero dentro de 30d
  await prisma.dailyLog.create({ data: { userId: uid, date: daysAgo(20), caloriesLogged: 2100, proteinG: 100 } });

  const s1 = await state.recompute(uid);
  check('logs: daysLogged7d=4', s1.daysLogged7d === 4, `got ${s1.daysLogged7d}`);
  check('logs: daysLogged30d=5', s1.daysLogged30d === 5, `got ${s1.daysLogged30d}`);
  check('logs: avgCalories7d=1850', s1.avgCalories7d === 1850, `got ${s1.avgCalories7d}`);
  check('logs: loggingStreak=4 (desde UserHabits)', s1.loggingStreak === 4);
  check('logs: avgMealsPerDay=2', s1.avgMealsPerDay === 2, `got ${s1.avgMealsPerDay}`);
  check('logs: adherencePct7d=90', s1.adherencePct7d === 90, `got ${s1.adherencePct7d}`);

  // 3. Tendencia de peso goal-aware (LOSE_FAT + bajando → on_track)
  for (const [d, kg] of [[21, 81], [14, 80.5], [7, 80], [1, 79.3]] as const) {
    await prisma.weightLog.create({ data: { userId: uid, date: daysAgo(d), weightKg: kg } });
  }
  const s2 = await state.recompute(uid);
  check('peso: weightDataPoints=4', s2.weightDataPoints === 4, `got ${s2.weightDataPoints}`);
  check('peso: weightTrendKgWk negativo', (s2.weightTrendKgWk ?? 0) < 0, `rate=${s2.weightTrendKgWk}`);
  check('peso: currentWeightKg=79.3 (último)', s2.currentWeightKg === 79.3, `got ${s2.currentWeightKg}`);
  check('peso: trendStatus=on_track (LOSE_FAT bajando)', s2.trendStatus === 'on_track', `got ${s2.trendStatus}`);

  // ── 2A.2 estado derivado ──
  console.log('\n── ESTADO DERIVADO (2A.2) ──');
  check('version bump a 2', s2.version === 2, `v=${s2.version}`);
  check('adherenceScore=67 (4/7 días, streak 4, adherencia 90)', s2.adherenceScore === 67, `got ${s2.adherenceScore}`);
  check('nutritionScore=90 (1850 vs 1900, prot 125/150)', s2.nutritionScore === 90, `got ${s2.nutritionScore}`);
  check('flag BREAKFAST_SKIPPED (solo lunch/dinner)', s2.behaviorFlags.includes('BREAKFAST_SKIPPED' as any));
  check('NO flag PROTEIN_CHRONIC_LOW (proteína adecuada)', !s2.behaviorFlags.includes('PROTEIN_CHRONIC_LOW' as any));
  check('plateau NONE (bajando, no estancado)', s2.plateauStatus === 'NONE', `got ${s2.plateauStatus}`);

  // PROTEIN_CHRONIC_LOW: proteína muy baja vs target
  const pUser = await prisma.user.create({ data: { email: 'protein@test.local' } });
  await prisma.goal.create({
    data: { userId: pUser.id, type: 'LOSE_FAT', targetCalories: 1900, proteinG: 150, carbsG: 180, fatG: 60, fiberTargetG: 30, waterMl: 2500, bmr: 1500, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300 },
  });
  for (const d of [1, 2, 3, 4]) {
    await prisma.dailyLog.create({
      data: {
        userId: pUser.id, date: daysAgo(d), caloriesLogged: 1800, proteinG: 50, planFollowed: true, adherencePct: 0.8,
        loggedMeals: { create: [
          { mealType: 'BREAKFAST', totalCalories: 600, totalProteinG: 20, totalCarbsG: 50, totalFatG: 15 },
          { mealType: 'LUNCH', totalCalories: 1200, totalProteinG: 30, totalCarbsG: 80, totalFatG: 30 },
        ] },
      },
    });
  }
  const sP = await state.recompute(pUser.id);
  check('flag PROTEIN_CHRONIC_LOW (50g vs 150g)', sP.behaviorFlags.includes('PROTEIN_CHRONIC_LOW' as any));
  check('NO flag BREAKFAST_SKIPPED (desayuno logueado)', !sP.behaviorFlags.includes('BREAKFAST_SKIPPED' as any));

  // PLATEAU_SUSPECTED: LOSE_FAT + adherencia alta + peso plano
  const plUser = await prisma.user.create({ data: { email: 'plateau@test.local' } });
  await prisma.goal.create({
    data: { userId: plUser.id, type: 'LOSE_FAT', targetCalories: 1900, proteinG: 150, carbsG: 180, fatG: 60, fiberTargetG: 30, waterMl: 2500, bmr: 1500, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: -300 },
  });
  await prisma.userHabits.create({ data: { userId: plUser.id, currentStreak: 7 } });
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await prisma.dailyLog.create({
      data: {
        userId: plUser.id, date: daysAgo(d), caloriesLogged: 1850, proteinG: 140, planFollowed: true, adherencePct: 1.0,
        loggedMeals: { create: [
          { mealType: 'BREAKFAST', totalCalories: 500, totalProteinG: 40, totalCarbsG: 40, totalFatG: 15 },
          { mealType: 'LUNCH', totalCalories: 1350, totalProteinG: 100, totalCarbsG: 120, totalFatG: 40 },
        ] },
      },
    });
  }
  for (const [d, kg] of [[21, 80], [14, 80.1], [7, 79.9], [1, 80.0]] as const) {
    await prisma.weightLog.create({ data: { userId: plUser.id, date: daysAgo(d), weightKg: kg } });
  }
  const sPl = await state.recompute(plUser.id);
  check('plateau: trendStatus=stalled (peso plano)', sPl.trendStatus === 'stalled', `got ${sPl.trendStatus}`);
  check('plateau: adherenceScore alto (>=70)', (sPl.adherenceScore ?? 0) >= 70, `score=${sPl.adherenceScore}`);
  check('plateau: PLATEAU_SUSPECTED', sPl.plateauStatus === 'PLATEAU_SUSPECTED', `got ${sPl.plateauStatus}`);

  // 4. Stale flow: markStale marca stale; get() recomputa y deja stale=false
  await state.recompute(uid);
  await state.markStale(uid);
  const rawStale = await prisma.userNutritionState.findUnique({ where: { userId: uid } });
  check('stale: markStale deja stale=true', rawStale?.stale === true);
  const sGet = await state.get(uid);
  check('stale: get() recomputa → stale=false', sGet.stale === false);

  // 5. Idempotencia
  const a = await state.recompute(uid);
  const b = await state.recompute(uid);
  check(
    'idempotente: dos recomputes → mismos valores',
    a.daysLogged30d === b.daysLogged30d && a.weightTrendKgWk === b.weightTrendKgWk && a.adherencePct7d === b.adherencePct7d,
  );

  // 6. markStale sobre usuario sin fila → no lanza (updateMany no-op)
  const other = await prisma.user.create({ data: { email: 'state2@test.local' } });
  let threw = false;
  try { await state.markStale(other.id); } catch { threw = true; }
  check('markStale sin fila previa → no lanza', !threw);
  const sOther = await state.get(other.id);
  check('get() crea estado para usuario sin fila', sOther.userId === other.id && sOther.trendStatus === 'insufficient_data');

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke UserNutritionState`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
