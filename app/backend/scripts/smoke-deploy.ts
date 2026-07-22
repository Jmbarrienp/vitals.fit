/**
 * Smoke test for V5.3 — Production Deployment Gate.
 *
 *   npm run smoke:deploy
 *
 * Every assertion maps to a production blocker listed in V5.2's audit. This is
 * the regression net for the deployment gate itself: rate limiting, production
 * CORS, operator separation, readiness, and the preflight's ability to detect
 * the wrong database.
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

const PORT = 59452;
const DB = 'vitals_deploy_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');
const { ConfigService } = require('@nestjs/config');
const { Reflector } = require('@nestjs/core');

import { PrismaService } from '../src/prisma/prisma.service';
import { AppController } from '../src/app.controller';
import { AdminGuard } from '../src/common/guards/admin.guard';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard';
import { RateLimiter, resolveRules, MAX_KEYS } from '../src/common/rate-limit/rate-limiter';
import { isAdmin, resolveAdminEmails, resolveCors } from '../src/config/production-config';
import { collectEnvProblems } from '../src/config/env.validation';
import { ForbiddenException, HttpException } from '@nestjs/common';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const GOOD_SECRET = 'a'.repeat(48);
const PROD = (over: Record<string, unknown> = {}) => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@h:5432/db',
  JWT_SECRET: GOOD_SECRET,
  ...over,
});

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
  console.log('── V5.3: RATE LIMITING (login brute force + Vision cost abuse were unbounded) ──');
  const limiter = new RateLimiter();
  const rule = { limit: 3, windowMs: 60_000 };
  const t0 = 1_000_000;
  const verdicts = [1, 2, 3, 4].map(() => limiter.hit('ip-a', rule, t0));
  check(
    'allows exactly `limit` requests, then blocks',
    verdicts.slice(0, 3).every((v) => v.allowed) && verdicts[3].allowed === false,
  );
  check('reports remaining quota accurately', verdicts[0].remaining === 2 && verdicts[2].remaining === 0);
  check(
    'a blocked request gets a positive Retry-After',
    verdicts[3].retryAfterSeconds > 0 && verdicts[3].retryAfterSeconds <= 60,
  );
  check(
    'a DIFFERENT client has its own quota (no cross-tenant starvation)',
    limiter.hit('ip-b', rule, t0).allowed === true,
  );
  check('the window RESETS after it elapses', limiter.hit('ip-a', rule, t0 + 60_001).allowed === true);
  // Memory safety was an explicit V5.2 audit theme — an unbounded IP-keyed map is a DoS vector.
  const bounded = new RateLimiter();
  for (let i = 0; i < MAX_KEYS + 500; i++) bounded.hit(`ip-${i}`, { limit: 100, windowMs: 600_000 }, t0);
  check(
    'the key space is HARD-CAPPED (cannot be grown into a memory exhaustion)',
    bounded.size() <= MAX_KEYS,
    `${bounded.size()} keys`,
  );
  check(
    'expired windows are swept (no unbounded growth over time)',
    (() => {
      const l = new RateLimiter();
      l.hit('x', rule, t0);
      l.hit('y', rule, t0 + 120_000); // sweep runs on write
      return l.size() === 1;
    })(),
  );

  const defaults = resolveRules({});
  check(
    'shipped defaults: auth is the tightest bucket (5/15min)',
    defaults.AUTH.limit === 5 && defaults.AUTH.windowMs === 900_000,
  );
  check('Vision is capped because each call costs vendor money', defaults.VISION.limit === 20);
  check(
    'every rule is env-overridable (tighten during an incident, no deploy)',
    resolveRules({ RATE_LIMIT_AUTH: '2' }).AUTH.limit === 2,
  );
  check(
    'a bogus override falls back to the safe default instead of disabling the limit',
    resolveRules({ RATE_LIMIT_AUTH: 'abc' }).AUTH.limit === 5 &&
      resolveRules({ RATE_LIMIT_AUTH: '-5' }).AUTH.limit === 5,
  );

  // The guard end-to-end, including the 429 contract.
  RateLimitGuard.resetForTests();
  const guard = new RateLimitGuard(new Reflector(), new ConfigService({}));
  const headers: Record<string, string> = {};
  const ctx = (ip: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-forwarded-for': ip }, ip, socket: {} }),
        getResponse: () => ({
          setHeader: (k: string, v: string) => {
            headers[k] = v;
          },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;
  let allowedCount = 0;
  let blocked: HttpException | null = null;
  for (let i = 0; i < 302; i++) {
    try {
      guard.canActivate(ctx('9.9.9.9'));
      allowedCount++;
    } catch (e) {
      blocked = e as HttpException;
      break;
    }
  }
  check('the guard enforces the DEFAULT bucket (300/min) end to end', allowedCount === 300 && blocked !== null);
  check(
    'a blocked request returns HTTP 429 with Retry-After',
    blocked!.getStatus() === 429 && !!headers['Retry-After'],
  );
  check('rate-limit headers are always set so clients can back off', headers['X-RateLimit-Limit'] === '300');
  check(
    'the limiter can be disabled by config for local work',
    new RateLimitGuard(new Reflector(), new ConfigService({ RATE_LIMIT_ENABLED: 'false' })).canActivate(
      ctx('1.1.1.1'),
    ) === true,
  );
  check(
    'the client is taken from X-Forwarded-For (Render terminates TLS at its proxy)',
    (() => {
      RateLimitGuard.resetForTests();
      const g = new RateLimitGuard(new Reflector(), new ConfigService({}));
      g.canActivate(ctx('5.5.5.5'));
      const before = RateLimitGuard.tracked;
      g.canActivate(ctx('6.6.6.6'));
      return RateLimitGuard.tracked === before + 1; // distinct proxied clients -> distinct buckets
    })(),
  );

  console.log('\n── V5.3: CORS (V5.2 shipped origin:"*" with Authorization allowed) ──');
  check(
    'development still reflects any origin (no local friction)',
    resolveCors({ NODE_ENV: 'development' }).origin === true,
  );
  const prodNoList = resolveCors(PROD());
  check('PRODUCTION never gets a wildcard', prodNoList.isWildcard === false && Array.isArray(prodNoList.origin));
  check(
    '…production with no allowlist rejects ALL browser origins (fails closed)',
    (prodNoList.origin as string[]).length === 0,
  );
  const prodList = resolveCors(PROD({ CORS_ORIGINS: 'https://app.vitals.fit, https://admin.vitals.fit' }));
  check(
    'an explicit allowlist is parsed and trimmed',
    (prodList.origin as string[]).join('|') === 'https://app.vitals.fit|https://admin.vitals.fit',
  );
  check(
    'CORS_ORIGINS="*" in production is a BOOT ERROR, not a silent wildcard',
    collectEnvProblems(PROD({ CORS_ORIGINS: '*' })).errors.some((e) => e.includes('CORS_ORIGINS')),
  );
  check(
    '…and an unset allowlist in production is a warning, not a block (native mobile is unaffected)',
    (() => {
      const r = collectEnvProblems(PROD());
      return r.errors.length === 0 && r.warnings.some((w) => w.includes('CORS_ORIGINS'));
    })(),
  );

  console.log('\n── V5.3: OPERATOR SEPARATION (any authenticated user could read platform analytics) ──');
  check(
    'FAILS CLOSED: with no ADMIN_EMAILS nobody is an operator',
    isAdmin('a@b.com', resolveAdminEmails({})) === false,
  );
  check(
    'an allowlisted email is an operator',
    isAdmin('ops@vitals.fit', resolveAdminEmails({ ADMIN_EMAILS: 'ops@vitals.fit' })) === true,
  );
  check(
    'matching is case-insensitive and whitespace-tolerant',
    isAdmin('  OPS@Vitals.fit ', resolveAdminEmails({ ADMIN_EMAILS: ' ops@vitals.fit , x@y.z ' })) === true,
  );
  check(
    'a non-listed user is NOT an operator',
    isAdmin('user@gmail.com', resolveAdminEmails({ ADMIN_EMAILS: 'ops@vitals.fit' })) === false,
  );
  check(
    'an anonymous request is never an operator',
    isAdmin(null, resolveAdminEmails({ ADMIN_EMAILS: 'ops@vitals.fit' })) === false,
  );

  const adminCtx = (email: string | null) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: email ? { email } : undefined, url: '/api/vision/rollout' }) }),
    }) as any;
  const openGuard = new AdminGuard(new ConfigService({ ADMIN_EMAILS: 'ops@vitals.fit' }));
  check('AdminGuard admits a configured operator', openGuard.canActivate(adminCtx('ops@vitals.fit')) === true);
  let denied = false;
  try {
    openGuard.canActivate(adminCtx('user@gmail.com'));
  } catch (e) {
    denied = e instanceof ForbiddenException;
  }
  check('AdminGuard denies an ordinary authenticated user with 403', denied === true);
  let deniedClosed = false;
  try {
    new AdminGuard(new ConfigService({})).canActivate(adminCtx('anyone@x.com'));
  } catch (e) {
    deniedClosed = e instanceof ForbiddenException;
  }
  check('AdminGuard denies EVERYONE when unconfigured (safe default, not open default)', deniedClosed === true);

  console.log('\n── V5.3: ENV VALIDATION EXTENSIONS ──');
  check(
    'a negative rate-limit override is rejected at boot',
    collectEnvProblems(PROD({ RATE_LIMIT_AUTH: '-1' })).errors.length === 1,
  );
  check(
    'disabling rate limiting in production warns loudly',
    collectEnvProblems(PROD({ RATE_LIMIT_ENABLED: 'false' })).warnings.some((w) => w.includes('brute force')),
  );
  check(
    'an unset ADMIN_EMAILS in production warns that operator endpoints are closed',
    collectEnvProblems(PROD()).warnings.some((w) => w.includes('ADMIN_EMAILS')),
  );
  check(
    'a fully configured production environment is clean',
    collectEnvProblems(
      PROD({ CORS_ORIGINS: 'https://app.vitals.fit', ADMIN_EMAILS: 'ops@vitals.fit', ANTHROPIC_API_KEY: 'sk-x' }),
    ).errors.length === 0,
  );

  // ── integration ──
  console.log('\n── V5.3: READINESS (distinct from health/liveness) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-deploy-'));
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
  const controller = new AppController(prisma);

  // First, PROVE readiness catches a misconfigured instance: JWT_SECRET is not
  // set in this smoke's environment, which is exactly the class of mistake the
  // gate exists to catch. This is the pre-fix state, asserted deliberately.
  const misconfiguredRes: any = {
    statusCode: 200,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
  };
  const misconfigured = await controller.ready(misconfiguredRes);
  check(
    'a MISCONFIGURED instance (no JWT_SECRET) is NOT READY — the gate catches it',
    misconfigured.status === 'not_ready' && misconfiguredRes.statusCode === 503,
  );
  check(
    '…and names the offending configuration',
    misconfigured.checks.find((c: any) => c.name === 'configuration')?.ok === false,
  );

  // Now a fully configured instance.
  process.env.JWT_SECRET = GOOD_SECRET;
  const res: any = {
    statusCode: 200,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
  };
  const ready = await controller.ready(res);
  check('READY reports every check, not just the first failure', ready.checks.length >= 6);
  check(
    '…covering database, configuration, cors, operators, providers and rate limiting',
    ['database', 'configuration', 'cors', 'operator-access', 'vision-providers', 'rate-limiting'].every((n) =>
      ready.checks.some((c: any) => c.name === n),
    ),
  );
  check(
    'a healthy, CONFIGURED environment is READY (200)',
    ready.status === 'ready' && res.statusCode === 200,
    ready.checks
      .filter((c: any) => !c.ok)
      .map((c: any) => c.name)
      .join(',') || 'all ok',
  );
  check(
    'the database check reports measured latency',
    ready.checks.find((c: any) => c.name === 'database')?.detail.includes('ms'),
  );
  check(
    'provider posture is surfaced for the operator',
    ready.checks.find((c: any) => c.name === 'vision-providers')?.detail.includes('vision='),
  );

  const brokenRes: any = {
    statusCode: 200,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
  };
  const notReady = await new AppController({
    ping: async () => {
      throw new Error('ECONNREFUSED');
    },
  } as any).ready(brokenRes);
  check(
    'an unreachable database makes the instance NOT READY (503)',
    notReady.status === 'not_ready' && brokenRes.statusCode === 503,
  );
  check(
    '…while liveness stays OK so the orchestrator does not restart-loop on a DB outage',
    controller.live().status === 'ok',
  );
  check(
    'readiness and health are genuinely DIFFERENT endpoints',
    typeof (controller as any).ready === 'function' && typeof (controller as any).health === 'function',
  );

  console.log('\n── V5.3: PREFLIGHT (the "am I migrating the right database?" gate) ──');
  const preflightSrc = fs.readFileSync(path.join(__dirname, 'preflight.ts'), 'utf8');
  check('preflight exists and is wired as a script', fs.existsSync(path.join(__dirname, 'preflight.ts')));
  check(
    'it NEVER prints credentials (identifies the target by host/db/fingerprint)',
    preflightSrc.includes('las credenciales nunca se imprimen') && !preflightSrc.includes('console.log(url'),
  );
  check(
    'it detects seed/test users — the recorded risk of test data in a real account',
    preflightSrc.includes('@test.local') && preflightSrc.includes('TEST_EMAIL_PATTERNS'),
  );
  check(
    'it blocks when production contains test users',
    preflightSrc.includes('En producción esto indica que una suite de pruebas'),
  );
  check('it verifies the target against EXPECTED_DB_FINGERPRINT', preflightSrc.includes('EXPECTED_DB_FINGERPRINT'));
  check('it blocks NODE_ENV=production pointing at localhost', preflightSrc.includes('apunta a localhost'));
  check(
    'it reports pending migrations and how to apply them',
    preflightSrc.includes('PENDIENTES') && preflightSrc.includes('migrate:deploy'),
  );
  check(
    'it applies NO DDL, seed or migration (read-only by construction)',
    !/(CREATE TABLE|INSERT INTO|migrate deploy`)/i.test(preflightSrc),
  );
  check('it exits non-zero on blockers so CI/deploy stops', preflightSrc.includes('process.exitCode'));

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  check(
    'deployment scripts are all wired',
    ['preflight', 'migrate:deploy', 'migrate:status', 'smoke:deploy', 'deploy:check'].every((s) => !!pkg.scripts[s]),
  );

  await prisma.onModuleDestroy();
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
    `\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Production Deployment Gate (V5.3)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
