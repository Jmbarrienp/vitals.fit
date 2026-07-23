/**
 * Smoke test for V5.5 — API Contract Hardening & HTTP Integration Testing.
 *
 *   npm run smoke:http-contract
 *
 * Unlike every other smoke in this repo, this one does NOT call services
 * in-process — it boots the REAL Nest HTTP application (real ValidationPipe,
 * real AllExceptionsFilter, real JwtAuthGuard/AdminGuard, real RateLimitGuard)
 * against an embedded Postgres, and drives it with Supertest. "Probar la API
 * real, no servicios."
 *
 * It sources the app from `dist/`, NOT from `src/` via ts-node like every
 * other smoke, and runs `npm run build` as its first step. This is
 * deliberate (see ADR-0003): `@nestjs/swagger`'s CLI plugin — which turns a
 * bare class-validator DTO into a real, field-level OpenAPI schema — only
 * runs through `nest build`'s compiler pipeline. Generating the contract
 * snapshot from raw ts-node source would silently describe a THINNER
 * contract than the one clients actually receive from `/api/docs` in
 * production, which defeats the point of a contract snapshot.
 *
 * Rate limiting stays ON (this suite is deliberately not exempt from it —
 * that's part of what it verifies), so sections that would otherwise trip
 * the platform's own limiter call `RateLimitGuard.resetForTests()` between
 * groups. A genuine 429 mid-run means the assertion under test, never
 * cross-contamination from this suite's own request volume.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import request from 'supertest';

const ignoreTeardownNoise = (e: any) => {
  if (String(e?.message ?? e).includes('Connection terminated')) return;
  throw e;
};
process.on('uncaughtException', ignoreTeardownNoise);
process.on('unhandledRejection', ignoreTeardownNoise);

const BACKEND = path.join(__dirname, '..');
const PORT = 59453;
const DB = 'vitals_http_contract';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');
const MIGRATIONS_DIR = path.join(BACKEND, 'prisma', 'migrations');

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

// ── Minimal OpenAPI structural diff (no external dependency — see ADR-0002's ──
// ── precedent: this project prefers ~100 dependency-free lines over a new lib) ──
type DiffKind = 'added' | 'removed' | 'changed';
interface SnapshotDiff {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

function diffValues(pointer: string, before: unknown, after: unknown, out: SnapshotDiff[]): void {
  if (before === after) return;
  const beforeIsObj = before !== null && typeof before === 'object';
  const afterIsObj = after !== null && typeof after === 'object';
  if (!beforeIsObj || !afterIsObj) {
    if (before === undefined) out.push({ path: pointer, kind: 'added', after });
    else if (after === undefined) out.push({ path: pointer, kind: 'removed', before });
    else out.push({ path: pointer, kind: 'changed', before, after });
    return;
  }
  const beforeKeys = Array.isArray(before) ? before.map((_, i) => String(i)) : Object.keys(before as object);
  const afterKeys = Array.isArray(after) ? after.map((_, i) => String(i)) : Object.keys(after as object);
  const keys = new Set([...beforeKeys, ...afterKeys]);
  for (const key of keys) {
    diffValues(`${pointer}/${key}`, (before as any)[key], (after as any)[key], out);
  }
}

function diffOpenApiDocuments(before: unknown, after: unknown): SnapshotDiff[] {
  const out: SnapshotDiff[] = [];
  diffValues('', before, after, out);
  return out;
}

// ── Minimal ArgumentsHost mock — for exercising AllExceptionsFilter directly ──
function mockHttpHost(url = '/api/fake/route') {
  const response: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const requestObj = { method: 'GET', url };
  const host: any = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => requestObj }) };
  return { host, response };
}

async function main() {
  console.log('▶ Building (dist/ must carry the @nestjs/swagger plugin-enriched metadata)…');
  execSync('npm run build', { cwd: BACKEND, stdio: 'inherit' });

  console.log('▶ Booting embedded Postgres…');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-pg-'));
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

  console.log('▶ Applying migrations…');
  await applyMigrations();

  // ── Environment BEFORE any dist/ module is required — mirrors every other smoke ──
  process.env.DATABASE_URL = LOCAL_URL;
  process.env.DIRECT_URL = LOCAL_URL;
  process.env.JWT_SECRET = 'http-contract-smoke-secret-not-used-for-anything-real-01234567';
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_EMAILS = 'admin@contract-test.local';
  process.env.SWAGGER_ENABLED = 'true';

  const { AppModule } = require('../dist/app.module');
  const { configureApp } = require('../dist/bootstrap/configure-app');
  const { buildOpenApiDocument } = require('../dist/bootstrap/openapi-document');
  const { RateLimitGuard } = require('../dist/common/guards/rate-limit.guard');
  const { AllExceptionsFilter } = require('../dist/common/filters/all-exceptions.filter');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { NestFactory } = require('@nestjs/core');
  const { NotFoundException } = require('@nestjs/common');

  console.log('▶ Booting the REAL Nest application (same configureApp() main.ts uses)…');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);

  RateLimitGuard.resetForTests();

  console.log('\n── FIXTURES ──');
  const emailA = `usera-${Date.now()}@contract-test.local`;
  const emailB = `userb-${Date.now()}@contract-test.local`;
  const adminEmail = 'admin@contract-test.local';
  const password = 'ContractTest123!';

  const regA = await request(server).post('/api/auth/register').send({ email: emailA, password });
  const regB = await request(server).post('/api/auth/register').send({ email: emailB, password });
  const regAdmin = await request(server).post('/api/auth/register').send({ email: adminEmail, password });
  check(
    'registro de 3 usuarios de prueba (A, B, admin) → 201',
    [regA, regB, regAdmin].every((r) => r.status === 201),
  );
  const tokenA = regA.body.access_token;
  const tokenB = regB.body.access_token;
  const tokenAdmin = regAdmin.body.access_token;
  check(
    'cada registro devuelve access_token',
    [tokenA, tokenB, tokenAdmin].every((t) => typeof t === 'string' && t.length > 0),
  );
  const authA = { Authorization: `Bearer ${tokenA}` };
  const authB = { Authorization: `Bearer ${tokenB}` };
  const authAdmin = { Authorization: `Bearer ${tokenAdmin}` };

  const food = await prisma.foodItem.create({
    data: {
      name: 'Manzana de prueba',
      nameLower: 'manzana de prueba',
      nameNormalized: 'manzana de prueba',
      nameAliases: [],
      caloriesPer100g: 52,
      proteinPer100g: 0.3,
      carbsPer100g: 14,
      fatPer100g: 0.2,
      source: 'custom',
    },
  });

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── OPENAPI DOCUMENTATION ──');
  const document = buildOpenApiDocument(app);
  check('documento OpenAPI generado', !!document && !!document.paths);
  check('info.title correcto', document.info.title === 'Vitals Fit API');
  check('declara seguridad Bearer', !!document.components?.securitySchemes?.bearer);

  const pathCount = Object.keys(document.paths).length;
  check('≥40 rutas documentadas', pathCount >= 40, `${pathCount}`);

  const SPOT_CHECK_PATHS = [
    '/api/auth/login',
    '/api/vision/scans',
    '/api/vision/scans/{id}',
    '/api/vision/learning/trust',
    '/api/food/{id}',
    '/api/users/profile',
  ];
  for (const p of SPOT_CHECK_PATHS) {
    check(`ruta documentada: ${p}`, !!document.paths[p], Object.keys(document.paths).slice(0, 3).join(', '));
  }

  let opsWithoutTags = 0;
  let opsWithoutSummary = 0;
  let totalOps = 0;
  for (const [, methods] of Object.entries<any>(document.paths)) {
    for (const [verb, op] of Object.entries<any>(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(verb)) continue;
      totalOps++;
      if (!op.tags || op.tags.length === 0) opsWithoutTags++;
      if (!op.summary) opsWithoutSummary++;
    }
  }
  check('toda operación tiene @ApiTags', opsWithoutTags === 0, `${opsWithoutTags}/${totalOps} sin tags`);
  check(
    '≥90% de operaciones tienen summary (explícito o vía introspectComments)',
    opsWithoutSummary / totalOps <= 0.1,
    `${totalOps - opsWithoutSummary}/${totalOps}`,
  );

  const loginSchema = document.paths['/api/auth/login']?.post?.requestBody?.content?.['application/json']?.schema;
  check(
    'el plugin de nest-cli enriqueció LoginDto (no es un objeto vacío)',
    !!loginSchema && (!!loginSchema.properties || !!loginSchema.$ref),
  );

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── AUTENTICACIÓN ──');
  const noToken = await request(server).get('/api/users/me');
  check('sin token → 401', noToken.status === 401);
  // Passport's AuthGuard throws a bare `new UnauthorizedException()` — Nest's
  // OWN HttpException.createBody omits `error` when constructed with NO
  // message (a native Nest behavior, not something this codebase controls).
  // A THIRD documented shape variant, see ADR-0004.
  check(
    '401 sin mensaje custom: {statusCode,message} — variante nativa de Nest sin `error`, ver ADR-0004',
    noToken.body.statusCode === 401 && typeof noToken.body.message === 'string',
    JSON.stringify(noToken.body),
  );

  const badToken = await request(server).get('/api/users/me').set('Authorization', 'Bearer not-a-real-token');
  check('token inválido → 401', badToken.status === 401);

  const okToken = await request(server).get('/api/users/me').set(authA);
  check('token válido → 200', okToken.status === 200);
  check('la respuesta de /auth/me y /users/me NUNCA incluye passwordHash', !('passwordHash' in okToken.body));

  const me = await request(server).get('/api/auth/me').set(authA);
  check('/auth/me → 200 sin passwordHash', me.status === 200 && !('passwordHash' in me.body));

  const publicHealth = await request(server).get('/api/health');
  check('rutas públicas no requieren token (/health)', publicHealth.status === 200 || publicHealth.status === 503);
  // Nest defaults @Post() to 201 with no @HttpCode() override — applied here
  // too, even though "login" isn't really a resource creation. Confirmed
  // uniform across every POST in the API (see docs: Hallazgos).
  const publicLogin = await request(server).post('/api/auth/login').send({ email: emailA, password });
  check(
    'login con credenciales válidas → 201 (default de Nest para @Post)',
    publicLogin.status === 201,
    `got ${publicLogin.status} ${JSON.stringify(publicLogin.body)}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── AUTORIZACIÓN ──');
  console.log('   (LearningController: gate por RUTA, no por clase — cobertura exhaustiva de sus 10 rutas)');
  const LEARNING_ROUTES: { method: 'get'; path: string; admin: boolean }[] = [
    { method: 'get', path: '/api/vision/learning/trust', admin: false },
    { method: 'get', path: `/api/vision/learning/trust/scan/00000000-0000-0000-0000-000000000000`, admin: false },
    { method: 'get', path: '/api/vision/learning/trust/statistics', admin: true },
    { method: 'get', path: '/api/vision/learning/promotion?incumbent=fixture&challenger=fixture', admin: true },
    { method: 'get', path: '/api/vision/learning/calibration/health?providerId=fixture', admin: true },
    { method: 'get', path: '/api/vision/learning/summary', admin: true },
    { method: 'get', path: '/api/vision/learning/scorecard?providerId=fixture', admin: true },
    { method: 'get', path: '/api/vision/learning/calibration?providerId=fixture', admin: true },
    { method: 'get', path: '/api/vision/learning/comparison?incumbent=fixture&challenger=fixture', admin: true },
    { method: 'get', path: '/api/vision/learning/replay', admin: true },
  ];
  for (const route of LEARNING_ROUTES) {
    const asUser = await request(server)[route.method](route.path).set(authA);
    const asAdmin = await request(server)[route.method](route.path).set(authAdmin);
    if (route.admin) {
      check(`${route.path} — usuario normal → 403`, asUser.status === 403, `got ${asUser.status}`);
      check(`${route.path} — admin → NO 403`, asAdmin.status !== 403, `got ${asAdmin.status}`);
    } else {
      check(`${route.path} — usuario normal → NO 403 (dato propio)`, asUser.status !== 403, `got ${asUser.status}`);
    }
  }

  console.log(
    '   (Los otros 5 controllers de gobernanza: guardia a nivel de CLASE — un spot-check por controller basta)',
  );
  const ADMIN_ONLY_CONTROLLERS: { name: string; path: string }[] = [
    { name: 'rollout', path: '/api/vision/rollout' },
    { name: 'governance', path: '/api/vision/governance/shadow' },
    { name: 'canary', path: '/api/vision/canary' },
    { name: 'promotion', path: '/api/vision/promotion-plan' },
    { name: 'rollback', path: '/api/vision/rollback' },
  ];
  for (const c of ADMIN_ONLY_CONTROLLERS) {
    const asUser = await request(server).get(c.path).set(authA);
    const asAdmin = await request(server).get(c.path).set(authAdmin);
    check(`${c.name} — usuario normal → 403`, asUser.status === 403, `got ${asUser.status}`);
    check(`${c.name} — admin → NO 403`, asAdmin.status !== 403, `got ${asAdmin.status}`);
  }

  const noAuthOnAdmin = await request(server).get('/api/vision/rollout');
  check(
    'endpoint de operador sin token → 401 (no 403 — falla en la capa de autenticación primero)',
    noAuthOnAdmin.status === 401,
  );

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── VALIDACIÓN (DTOs, class-validator vía ValidationPipe global) ──');
  // Fresh AUTH-bucket budget: this section makes its own /auth/register calls,
  // on top of the 3 already spent in FIXTURES + 1 in AUTENTICACIÓN.
  RateLimitGuard.resetForTests();
  const badEmail = await request(server)
    .post('/api/auth/register')
    .send({ email: 'not-an-email', password: 'x'.repeat(10) });
  check('email inválido → 400', badEmail.status === 400);
  check('400 de ValidationPipe: message es array de strings', Array.isArray(badEmail.body.message));

  const shortPassword = await request(server)
    .post('/api/auth/register')
    .send({ email: `short-${Date.now()}@x.local`, password: '123' });
  check(
    'password corto → 400',
    shortPassword.status === 400,
    `got ${shortPassword.status} ${JSON.stringify(shortPassword.body)}`,
  );

  const badEnum = await request(server).post('/api/goals').set(authA).send({ type: 'NOT_A_REAL_GOAL' });
  check('enum inválido en DTO → 400', badEnum.status === 400);

  // Pins the V5.5 fix: array elements are now type-checked, not just the container.
  const badArrayElement = await request(server)
    .put('/api/users/profile')
    .set(authA)
    .send({
      name: 'Test User',
      age: 30,
      weightKg: 70,
      heightCm: 175,
      sex: 'MALE',
      activityLevel: 'MODERATE',
      fitnessLevel: 'BEGINNER',
      dietaryRestrictions: [123, { not: 'a string' }],
    });
  check('V5.5 fix: dietaryRestrictions con elementos no-string → 400 (antes pasaba)', badArrayElement.status === 400);

  const validProfile = await request(server)
    .put('/api/users/profile')
    .set(authA)
    .send({
      name: 'Test User',
      age: 30,
      weightKg: 70,
      heightCm: 175,
      sex: 'MALE',
      activityLevel: 'MODERATE',
      fitnessLevel: 'BEGINNER',
      dietaryRestrictions: ['vegetarian'],
    });
  check(
    'mismo payload con dietaryRestrictions válido → 200',
    validProfile.status === 200,
    `got ${validProfile.status}`,
  );

  // Pins the V5.5 fix on LogWeightDto.notes.
  const longNotes = await request(server)
    .post('/api/progress/weight')
    .set(authA)
    .send({ weightKg: 70, notes: 'x'.repeat(501) });
  check('V5.5 fix: notes > 500 caracteres → 400 (antes no tenía límite)', longNotes.status === 400);

  const okNotes = await request(server)
    .post('/api/progress/weight')
    .set(authA)
    .send({ weightKg: 70, notes: 'todo bien' });
  check('notes dentro del límite → 201', okNotes.status === 201, `got ${okNotes.status}`);

  const unknownField = await request(server)
    .post('/api/goals')
    .set(authA)
    .send({ type: 'MAINTAIN', notARealDtoField: 'ignored' });
  check(
    'whitelist:true: campo desconocido se descarta silenciosamente (no rechaza)',
    unknownField.status === 201,
    `got ${unknownField.status}`,
  );
  check('el campo desconocido NO aparece en la respuesta', !('notARealDtoField' in unknownField.body));

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── ERROR CONSISTENCY (dos shapes documentados, ver ADR-0004) ──');
  // Fresh AUTH-bucket budget again: conflictReg + wrongPassword below both hit
  // /auth/*, on top of everything already spent in earlier sections.
  RateLimitGuard.resetForTests();
  const filter = new AllExceptionsFilter();
  {
    const { host, response } = mockHttpHost();
    filter.catch(new Error('boom — internal detail that must never reach a client'), host);
    check('no controlado → 500', response.statusCode === 500);
    check(
      'shape del 500: exactamente statusCode/message/timestamp/path, SIN detalle interno',
      response.body?.statusCode === 500 &&
        response.body?.message === 'Internal server error' &&
        typeof response.body?.timestamp === 'string' &&
        typeof response.body?.path === 'string' &&
        !JSON.stringify(response.body).includes('boom'),
    );
  }
  {
    const { host, response } = mockHttpHost();
    filter.catch(new NotFoundException('X not found'), host);
    check(
      'HttpException intencional: pasa con SU status y cuerpo {statusCode,message,error} exactos',
      response.statusCode === 404 &&
        response.body?.statusCode === 404 &&
        response.body?.message === 'X not found' &&
        response.body?.error === 'Not Found',
    );
  }

  const conflictReg = await request(server).post('/api/auth/register').send({ email: emailA, password });
  check(
    'email duplicado → 409',
    conflictReg.status === 409,
    `got ${conflictReg.status} ${JSON.stringify(conflictReg.body)}`,
  );
  check('409 sigue el shape HttpErrorResponseDto', conflictReg.body.statusCode === 409 && !!conflictReg.body.error);

  const wrongPassword = await request(server)
    .post('/api/auth/login')
    .send({ email: emailA, password: 'wrong-password' });
  check(
    'password incorrecto → 401 (no 404 — no revela si el email existe)',
    wrongPassword.status === 401,
    `got ${wrongPassword.status} ${JSON.stringify(wrongPassword.body)}`,
  );

  console.log('   (nota: este API usa 400 para errores de validación, no 422 — ver ADR-0004; ningún endpoint usa 422)');

  const bigPayload = await request(server)
    .post('/api/goals')
    .set(authA)
    .send({ type: 'MAINTAIN', junk: 'x'.repeat(9 * 1024 * 1024) });
  check(
    'body >8MB → 413 (client error), NO 500 — ver Riesgos/Cambios en el reporte',
    bigPayload.status === 413,
    `got ${bigPayload.status}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── HEADERS ──');
  const withRateHeaders = await request(server).get('/api/health');
  check('respuestas normales llevan X-RateLimit-Limit', withRateHeaders.headers['x-ratelimit-limit'] !== undefined);
  check(
    'respuestas normales llevan X-RateLimit-Remaining',
    withRateHeaders.headers['x-ratelimit-remaining'] !== undefined,
  );
  check('content-type es application/json', /application\/json/.test(okToken.headers['content-type'] ?? ''));

  console.log('\n── RATE LIMITING (429 real, bucket encogido temporalmente para no disparar 300 requests) ──');
  process.env.RATE_LIMIT_DEFAULT = '3';
  process.env.RATE_LIMIT_DEFAULT_WINDOW_MS = '60000';
  RateLimitGuard.resetForTests();
  let last429: any;
  for (let i = 0; i < 4; i++) last429 = await request(server).get('/api/health');
  check('al superar el límite del bucket → 429', last429.status === 429, `got ${last429.status}`);
  check('el 429 trae Retry-After', last429.headers['retry-after'] !== undefined);
  check(
    'el 429 sigue el shape HttpErrorResponseDto',
    last429.body.statusCode === 429 && last429.body.error === 'Too Many Requests',
  );
  delete process.env.RATE_LIMIT_DEFAULT;
  delete process.env.RATE_LIMIT_DEFAULT_WINDOW_MS;
  RateLimitGuard.resetForTests();

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── READ-ONLY / OWNERSHIP (IDOR) ──');
  const postOnReadOnlyRoute = await request(server).post('/api/vision/rollout').set(authAdmin);
  check('POST a una ruta solo-GET → 404 (no existe la ruta, no 405 disfrazado)', postOnReadOnlyRoute.status === 404);

  const scanRes = await request(server).post('/api/vision/scans/barcode').set(authA).send({ barcode: '7501234567890' });
  check('crear scan por barcode → 201', scanRes.status === 201, `got ${scanRes.status}`);
  const scanId = scanRes.body?.scanId ?? scanRes.body?.id;
  if (scanId) {
    const ownerRead = await request(server).get(`/api/vision/scans/${scanId}`).set(authA);
    check('el dueño SÍ puede leer su propio scan', ownerRead.status === 200, `got ${ownerRead.status}`);
    // Vision's getOwnedScan deliberately distinguishes "doesn't exist" (404)
    // from "exists but isn't yours" (403) — a DIFFERENT choice than Logs'
    // getOwnedMeal (always 404, never confirms existence to a non-owner).
    // Documented as a real, minor finding in ADR-0004 rather than changed:
    // vision-scan.service.ts is frozen business logic for this slice.
    const otherRead = await request(server).get(`/api/vision/scans/${scanId}`).set(authB);
    check(
      'otro usuario NO puede leer el scan ajeno (403 — comportamiento real de Vision, ver ADR-0004)',
      otherRead.status === 403,
      `got ${otherRead.status}`,
    );
  } else {
    check('crear scan por barcode devolvió un id utilizable', false, JSON.stringify(scanRes.body));
  }

  const mealRes = await request(server)
    .post('/api/logs/meal')
    .set(authA)
    .send({ mealType: 'SNACK', items: [{ foodItemId: food.id, quantity: 100, unit: 'g' }] });
  check('crear un meal log → 201', mealRes.status === 201, `got ${mealRes.status}`);
  // logMeal returns the day's rollup (totals + all of today's meals), not the
  // meal alone — the meal we just created is the last one in the array.
  const mealId = mealRes.body?.meals?.[mealRes.body.meals.length - 1]?.id;
  if (mealId) {
    const otherDelete = await request(server).delete(`/api/logs/meal/${mealId}`).set(authB);
    check('otro usuario NO puede borrar el meal ajeno (404)', otherDelete.status === 404, `got ${otherDelete.status}`);
    const ownerDelete = await request(server).delete(`/api/logs/meal/${mealId}`).set(authA);
    check('el dueño SÍ puede borrar su propio meal', ownerDelete.status === 200, `got ${ownerDelete.status}`);
  } else {
    check('crear meal log devolvió un id utilizable', false, JSON.stringify(mealRes.body));
  }

  // V5.5 fix regression pin — see Riesgos/Cambios: FoodFavorite.foodItemId has a
  // real FK; a bogus id used to reach Prisma directly and surface as a raw 500.
  const favBogus = await request(server).post('/api/food/does-not-exist/favorite').set(authA);
  check(
    'V5.5 fix: favorito de food inexistente → 404 (antes: 500 por violación de FK)',
    favBogus.status === 404,
    `got ${favBogus.status}`,
  );
  const favReal = await request(server).post(`/api/food/${food.id}/favorite`).set(authA);
  check('favorito de food real → 200/201', [200, 201].includes(favReal.status), `got ${favReal.status}`);

  // No exception is thrown for a not-found recommendation (the service returns
  // a plain { message } object) — so Nest applies its OWN default for a route
  // with no @HttpCode() override, which for @Post() is 201 Created. A missing
  // id therefore returns 201, the SAME code as a real success — worse than a
  // plain 200 would have been, since 201 explicitly claims something was
  // created. Pre-existing, documented in ADR-0004, not fixed here (frozen
  // Recommendation Engine + a public response-shape mobile already consumes).
  console.log('   (Recommendations: pre-existente, documentado — 201 (!) con mensaje, ver ADR-0004)');
  const fakeRecommendation = await request(server)
    .post('/api/recommendations/00000000-0000-0000-0000-000000000000/respond')
    .set(authA)
    .send({ action: 'ACCEPTED' });
  check(
    'id de recomendación inexistente → 201 Created con mensaje de error (comportamiento preexistente, no un bug nuevo)',
    fakeRecommendation.status === 201 && typeof fakeRecommendation.body?.message === 'string',
    `got ${fakeRecommendation.status} ${JSON.stringify(fakeRecommendation.body)}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── DETERMINISMO ──');
  const doc1 = JSON.stringify(buildOpenApiDocument(app));
  const doc2 = JSON.stringify(buildOpenApiDocument(app));
  check('generar el documento OpenAPI dos veces produce el mismo JSON', doc1 === doc2);

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── CONTRACT SNAPSHOT ──');
  const snapshotDir = path.join(BACKEND, 'contracts');
  const snapshotPath = path.join(snapshotDir, 'openapi.snapshot.json');
  if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });

  if (!fs.existsSync(snapshotPath) || process.env.UPDATE_SNAPSHOT === '1') {
    fs.writeFileSync(snapshotPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
    check(
      `snapshot ${fs.existsSync(snapshotPath) ? 'creado' : 'actualizado'} en contracts/openapi.snapshot.json`,
      true,
      'UPDATE_SNAPSHOT=1 o primera corrida — no hay baseline previo que comparar',
    );
  } else {
    const baseline = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const diffs = diffOpenApiDocuments(baseline, document);
    if (diffs.length > 0) {
      console.log(`   ⚠️  ${diffs.length} diferencia(s) contra el snapshot:`);
      for (const d of diffs.slice(0, 40)) {
        console.log(
          `      ${d.kind.toUpperCase()} ${d.path} ${d.kind === 'changed' ? `(${JSON.stringify(d.before)} → ${JSON.stringify(d.after)})` : ''}`,
        );
      }
      if (diffs.length > 40)
        console.log(
          `      …y ${diffs.length - 40} más. Si es intencional: UPDATE_SNAPSHOT=1 npm run smoke:http-contract`,
        );
    }
    check('el contrato OpenAPI coincide con el snapshot committeado', diffs.length === 0, `${diffs.length} diff(s)`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n── WIRING (package.json / CI) ──');
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  check('script "smoke:http-contract" registrado', !!pkg.scripts['smoke:http-contract']);
  check(
    '"verify" ejecuta smoke:http-contract (vía verify:smokes)',
    (pkg.scripts.verify ?? '').includes('verify:smokes') &&
      (pkg.scripts['verify:smokes'] ?? '').includes('smoke:http-contract'),
  );
  const ci = fs.readFileSync(path.join(BACKEND, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  check('CI ejecuta smoke:http-contract', ci.includes('npm run smoke:http-contract'));
  check('supertest declarado como devDependency', !!pkg.devDependencies?.supertest);

  // ═══════════════════════════════════════════════════════════════════════
  await app.close();
  await prisma.$disconnect?.().catch(() => undefined);
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

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke HTTP Contract (V5.5)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
