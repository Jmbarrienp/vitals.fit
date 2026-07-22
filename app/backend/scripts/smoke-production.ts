/**
 * Smoke test for V5.2 — Production Readiness Hardening.
 *
 *   npm run smoke:production
 *
 * Every assertion here corresponds to a problem that was DEMONSTRABLY present
 * before this slice. This file is the regression net for the hardening itself:
 * config validation (fail fast on a misconfigured deploy), the health probe
 * (which used to be unable to report ill-health), graceful shutdown (the pool
 * used to leak on every redeploy), the exception filter's pass-through
 * contract, and the elimination of the triple CoachingContext build on the
 * Copilot endpoint.
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

const PORT = 59451;
const DB = 'vitals_production_smoke';
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
import { AppController } from '../src/app.controller';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { collectEnvProblems, validateEnv, MIN_JWT_SECRET_LENGTH } from '../src/config/env.validation';
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const GOOD_SECRET = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
const GOOD_ENV = { DATABASE_URL: 'postgresql://u:p@h:5432/db', JWT_SECRET: GOOD_SECRET };

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

async function main() {
  console.log('── V5.2: CONFIG VALIDATION (a misconfigured deploy must not boot) ──');
  check('a valid environment passes', collectEnvProblems(GOOD_ENV).errors.length === 0);
  check(
    'missing DATABASE_URL is a hard error',
    collectEnvProblems({ JWT_SECRET: GOOD_SECRET }).errors.some((e) => e.includes('DATABASE_URL')),
  );
  check(
    'a non-postgres DATABASE_URL is rejected',
    collectEnvProblems({ ...GOOD_ENV, DATABASE_URL: 'mysql://x' }).errors.some((e) => e.includes('postgres')),
  );
  check(
    'missing JWT_SECRET is a hard error',
    collectEnvProblems({ DATABASE_URL: GOOD_ENV.DATABASE_URL }).errors.some((e) => e.includes('JWT_SECRET')),
  );
  // THE bug this slice exists for: .env.example ships JWT_SECRET=changeme.
  check(
    'THE PLACEHOLDER "changeme" IS REJECTED — it is public in .env.example, so every token would be forgeable',
    collectEnvProblems({ ...GOOD_ENV, JWT_SECRET: 'changeme' }).errors.some((e) => e.includes('forgeable')),
  );
  check(
    'other common placeholders are rejected too',
    ['secret', 'password', 'test'].every((s) => collectEnvProblems({ ...GOOD_ENV, JWT_SECRET: s }).errors.length > 0),
  );
  check(
    'a short secret is a hard error IN PRODUCTION',
    collectEnvProblems({ ...GOOD_ENV, JWT_SECRET: 'short', NODE_ENV: 'production' }).errors.some((e) =>
      e.includes('brute force'),
    ),
  );
  check(
    '…but only a warning in development (local dev is not blocked)',
    (() => {
      const r = collectEnvProblems({ ...GOOD_ENV, JWT_SECRET: 'short', NODE_ENV: 'development' });
      return r.errors.length === 0 && r.warnings.length > 0;
    })(),
  );
  check(
    'EVERY problem is reported at once, not one per restart',
    collectEnvProblems({ JWT_SECRET: 'changeme' }).errors.length >= 2,
  );
  check(
    'SHADOW_SAMPLE_RATE out of [0,1] is rejected',
    collectEnvProblems({ ...GOOD_ENV, SHADOW_SAMPLE_RATE: '5' }).errors.length === 1 &&
      collectEnvProblems({ ...GOOD_ENV, SHADOW_SAMPLE_RATE: '0.1' }).errors.length === 0,
  );
  check(
    'a non-boolean AUTO_ACCEPT_ENABLED is rejected (it would silently read as false)',
    collectEnvProblems({ ...GOOD_ENV, AUTO_ACCEPT_ENABLED: 'yes' }).errors.length === 1,
  );
  check('a non-integer PORT is rejected', collectEnvProblems({ ...GOOD_ENV, PORT: 'abc' }).errors.length === 1);
  check(
    'optional switches absent -> no error (documented defaults respected)',
    collectEnvProblems(GOOD_ENV).errors.length === 0,
  );
  check(
    'production posture warnings never block a deploy',
    (() => {
      const r = collectEnvProblems({ ...GOOD_ENV, NODE_ENV: 'production', AUTO_ACCEPT_ENABLED: 'true' });
      return r.errors.length === 0 && r.warnings.some((w) => w.includes('AUTO_ACCEPT_ENABLED=true'));
    })(),
  );
  let threw = false;
  try {
    validateEnv({ JWT_SECRET: 'changeme' });
  } catch {
    threw = true;
  }
  check('validateEnv THROWS on a bad config — Nest aborts the boot', threw === true);
  check('validateEnv returns the config untouched when valid', validateEnv(GOOD_ENV).JWT_SECRET === GOOD_SECRET);

  console.log('\n── V5.2: EXCEPTION FILTER (intentional errors pass through untouched) ──');
  const filter = new AllExceptionsFilter();
  const mkHost = (captured: any) =>
    ({
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            captured.status = code;
            return this;
          },
          json(body: any) {
            captured.body = body;
            return this;
          },
        }),
        getRequest: () => ({ method: 'GET', url: '/api/test' }),
      }),
    }) as any;

  const badRequest: any = {};
  filter.catch(new BadRequestException('El campo X es inválido'), mkHost(badRequest));
  check(
    'a BadRequestException keeps its 400 AND its exact body',
    badRequest.status === 400 && JSON.stringify(badRequest.body).includes('El campo X es inválido'),
  );
  const notFound: any = {};
  filter.catch(new NotFoundException('Comida no encontrada.'), mkHost(notFound));
  check(
    'a NotFoundException keeps its 404 and message (no behavior change)',
    notFound.status === 404 && JSON.stringify(notFound.body).includes('Comida no encontrada'),
  );
  const validationLike: any = {};
  filter.catch(
    new HttpException({ statusCode: 400, message: ['calories must be a number'], error: 'Bad Request' }, 400),
    mkHost(validationLike),
  );
  check(
    'a ValidationPipe-shaped body passes through byte-identical',
    JSON.stringify(validationLike.body.message) === JSON.stringify(['calories must be a number']),
  );
  const unhandled: any = {};
  filter.catch(new Error('Invalid `prisma.user.findUnique()` on column User.email'), mkHost(unhandled));
  check(
    'an UNHANDLED error becomes an opaque 500 — no Prisma internals leak',
    unhandled.status === 500 &&
      !JSON.stringify(unhandled.body).includes('prisma') &&
      unhandled.body.message === 'Internal server error',
  );
  check('…and it still carries the path for attribution', unhandled.body.path === '/api/test');

  // ── integration ──
  console.log('\n── V5.2: INTEGRATION (health probe, shutdown, hot-path performance) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-prod-'));
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

  const res: any = {
    statusCode: 200,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
  };
  const healthy = await new AppController(prisma).health(res);
  check(
    'HEALTH: a healthy database reports ok with a measured latency',
    healthy.status === 'ok' && healthy.database.ok === true && typeof healthy.database.latencyMs === 'number',
  );
  check(
    '…and the ORIGINAL fields are unchanged (backward compatible)',
    healthy.service === 'fitness-ai-backend' && typeof healthy.timestamp === 'string' && res.statusCode === 200,
  );
  check(
    '…the process liveness probe stays dependency-free',
    typeof new AppController(prisma).live().uptimeSeconds === 'number',
  );

  // The bug: the old endpoint was a static object and COULD NOT report illness.
  const brokenPrisma = {
    ping: async () => {
      throw new Error('ECONNREFUSED');
    },
  } as any;
  const brokenRes: any = {
    statusCode: 200,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
  };
  const degraded = await new AppController(brokenPrisma).health(brokenRes);
  check(
    'HEALTH: an unreachable database reports DEGRADED, not ok',
    degraded.status === 'degraded' && degraded.database.ok === false,
  );
  check('…with HTTP 503 so an orchestrator stops routing traffic to it', brokenRes.statusCode === 503);
  check('…and the failure reason is surfaced', degraded.database.error?.includes('ECONNREFUSED'));

  const hangingPrisma = { ping: () => new Promise(() => {}) } as any;
  const hangRes: any = {
    statusCode: 200,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
  };
  const hung = await new AppController(hangingPrisma).health(hangRes);
  check(
    'HEALTH: a hanging database times out instead of hanging the probe',
    hung.status === 'degraded' && hung.database.error === 'HEALTH_PROBE_TIMEOUT',
  );

  // Performance: the hot path used to build the CoachingContext three times.
  const state = new NutritionStateService(prisma);
  const ledger = new WeeklyLedgerService(prisma);
  const review = new WeeklyReviewService(prisma, ledger);
  const coaching = new CoachingContextService(prisma, state, ledger, review);
  const planner = new AdaptivePlannerService(coaching);
  const foodSvc = new FoodService(new LocalFoodAdapter(prisma));
  const mealPlanner = new MealPlannerService(coaching, foodSvc);
  const recommendations = new RecommendationsService(prisma, state);

  const user = await prisma.user.create({ data: { email: 'prod@test.local' } });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      name: 'P',
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

  // Count context builds by wrapping the real method — proof, not assumption.
  let builds = 0;
  const realBuild = coaching.build.bind(coaching);
  (coaching as any).build = async (...args: any[]) => {
    builds++;
    return realBuild(...(args as [string, any]));
  };
  const runtime = new NutritionCopilotRuntime(coaching, planner, mealPlanner, recommendations);

  await runtime.session(user.id, '2026-07-16T12:00:00.000Z'); // warm lazy caches
  builds = 0;
  const s1 = await runtime.session(user.id, '2026-07-16T12:00:00.000Z');
  check(
    'PERFORMANCE: a Copilot session builds the CoachingContext EXACTLY ONCE (was 3x)',
    builds === 1,
    `${builds} build(s)`,
  );

  builds = 0;
  const d1 = await runtime.daily(user.id, '2026-07-16T12:00:00.000Z');
  check('…and the daily projection adds none on top', builds === 1, `${builds} build(s)`);

  // Compatibility: sharing the context must not change a single byte of output.
  (coaching as any).build = realBuild;
  const planShared = await planner.getPlan(user.id, await coaching.build(user.id, 'full'));
  const planOwn = await planner.getPlan(user.id);
  check(
    'COMPATIBILITY: a shared context yields a byte-identical plan',
    JSON.stringify(stripTime(planShared)) === JSON.stringify(stripTime(planOwn)),
  );
  const mealShared = await mealPlanner.getMealPlan(user.id, await coaching.build(user.id, 'full'));
  const mealOwn = await mealPlanner.getMealPlan(user.id);
  check(
    'COMPATIBILITY: a shared context yields a byte-identical meal plan',
    JSON.stringify(stripTime(mealShared)) === JSON.stringify(stripTime(mealOwn)),
  );
  check(
    'COMPATIBILITY: the Copilot session is unchanged by the optimization',
    s1.currentFocus.area.length > 0 && d1.focus.area === s1.currentFocus.area,
  );

  // Graceful shutdown: the pool used to leak on every redeploy.
  const disposable = new PrismaService();
  await disposable.onModuleInit();
  await disposable.ping();
  await disposable.onModuleDestroy();
  check('SHUTDOWN: onModuleDestroy drains the pool without throwing', true);
  let secondDestroyThrew = false;
  try {
    await disposable.onModuleDestroy();
  } catch {
    secondDestroyThrew = true;
  }
  check('…and is idempotent — a double shutdown never crashes the process', secondDestroyThrew === false);

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

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Production Readiness (V5.2)`);
  process.exit(failures === 0 ? 0 : 1);
}

/** generatedAt is informational and clock-derived; every contract documents it as excluded from determinism. */
function stripTime(x: any): any {
  return { ...x, meta: { ...x.meta, generatedAt: null }, reviewDate: undefined };
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
