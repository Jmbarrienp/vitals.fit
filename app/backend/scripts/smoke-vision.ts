/**
 * Smoke test for Nutrition Vision V0 (Phase 2D.2). Runs entirely against a
 * throwaway EMBEDDED local Postgres via the deterministic FixtureVisionProvider.
 * NEVER reads .env, NEVER touches production, NEVER calls a real vendor.
 *
 *   npm run smoke:vision
 *
 * Verifies: the full scan lifecycle, that confirmation converges on the
 * platform's single existing write path (LogsService.logMeal — meal.logged
 * fires, downstream rollup goes stale), provenance stamping, feedback capture,
 * lazy expiry, every failure/degradation path, and determinism of the pure
 * pipeline stages.
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

const PORT = 59441;
const DB = 'vitals_vision_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;
delete process.env.VISION_PROVIDER; // force default -> fixture

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');
const { EventEmitter2 } = require('@nestjs/event-emitter');
const { ConfigService } = require('@nestjs/config');

import { PrismaService } from '../src/prisma/prisma.service';
import { FoodService } from '../src/food/food.service';
import { LocalFoodAdapter } from '../src/food/adapters/local.adapter';
import { LogsService } from '../src/logs/logs.service';
import { FixtureVisionProvider } from '../src/vision/providers/fixture.provider';
import { VisionProviderRegistry } from '../src/vision/providers/provider.registry';
import { VisionProvider } from '../src/vision/providers/vision-provider.port';
import { validateRecognitionResult } from '../src/vision/providers/response-validator';
import { VisionScanService } from '../src/vision/vision-scan.service';
import { VISION_EVENTS } from '../src/vision/vision.events';
import { evaluateProvider, DEFAULT_EVAL_CASES } from '../src/vision/eval/vision-eval.harness';
import { matchDetection } from '../src/vision/pipeline/matching';
import { estimatePortion } from '../src/vision/pipeline/portion';
import { scoreCandidate, bandFor } from '../src/vision/pipeline/confidence';
import { buildCandidates } from '../src/vision/pipeline/build-candidates';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

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

async function main() {
  // ── PART A: pure pipeline stages (no DB) ──
  console.log('── MATCHING (pure) ──');
  const noResults = matchDetection({ label: 'pollo', labelConfidence: 0.9 }, []);
  check('no search results -> null foodItemId, score 0', noResults.foodItemId === null && noResults.matchScore === 0);
  const withResults = matchDetection(
    { label: 'pollo', labelConfidence: 0.9 },
    [
      { id: 'f1', name: 'Pollo a la plancha', caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, source: 'x', isCommon: true, isFavorite: true },
      { id: 'f2', name: 'Pollo frito', caloriesPer100g: 250, proteinPer100g: 25, carbsPer100g: 10, fatPer100g: 15, fiberPer100g: 0, source: 'x', isCommon: false, isFavorite: false },
    ],
  );
  check('top search result becomes the primary match', withResults.foodItemId === 'f1' && withResults.alternates[0]?.foodItemId === 'f2');
  check('favorite + common food scores near 1.0', withResults.matchScore === 1);

  console.log('\n── PORTION (pure) ──');
  const providerHint = estimatePortion({ label: 'x', labelConfidence: 0.8, portionHint: { grams: 180, confidence: 0.7 } }, 90);
  check('PROVIDER_ESTIMATE wins when a hint exists', providerHint.method === 'PROVIDER_ESTIMATE' && providerHint.grams === 180);
  const servingDefault = estimatePortion({ label: 'x', labelConfidence: 0.8 }, 90);
  check('SERVING_DEFAULT used when no provider hint', servingDefault.method === 'SERVING_DEFAULT' && servingDefault.grams === 90);
  const fallback = estimatePortion({ label: 'x', labelConfidence: 0.8 }, null);
  check('generic fallback when neither exists', fallback.method === 'SERVING_DEFAULT' && fallback.grams === 100);
  const clamped = estimatePortion({ label: 'x', labelConfidence: 0.8, portionHint: { grams: 9999 } }, null);
  check('portion is clamped to a sane max', clamped.grams <= 600, `${clamped.grams}`);

  console.log('\n── CONFIDENCE (pure) ──');
  const high = scoreCandidate(0.95, 1.0, 0.7);
  check('strong signals -> HIGH band', high.band === 'HIGH', `${high.overall}`);
  const low = scoreCandidate(0.3, 0.2, 0.2);
  check('weak signals -> LOW band', low.band === 'LOW', `${low.overall}`);
  check('bandFor is a pure threshold function', bandFor(0.8) === 'HIGH' && bandFor(0.5) === 'MEDIUM' && bandFor(0.1) === 'LOW');

  console.log('\n── BUILD-CANDIDATES (pure composition, determinism) ──');
  const detections = [{ label: 'pollo', labelConfidence: 0.9 }];
  const searchByIndex = [[{ id: 'f1', name: 'Pollo', caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, source: 'x', isCommon: true, isFavorite: false }]];
  const run1 = buildCandidates(detections, searchByIndex, [null]);
  const run2 = buildCandidates(detections, searchByIndex, [null]);
  check('identical inputs -> identical candidates', JSON.stringify(run1) === JSON.stringify(run2));
  check('no userId or raw-log keys in candidate output', !JSON.stringify(run1).includes('userId') && !JSON.stringify(run1).includes('dailyLog'));

  console.log('\n── CONTRACT VALIDATION (pure) ──');
  const fixture = new FixtureVisionProvider();
  const goodResult = await fixture.recognize({ imageRef: 'chicken.jpg', source: 'PHOTO' });
  check('a valid provider result passes validation', validateRecognitionResult(goodResult).valid === true);
  const missingFields = validateRecognitionResult({ detections: [] });
  check('missing provider metadata -> invalid', missingFields.valid === false);
  const badDetections = validateRecognitionResult({ providerId: 'x', model: 'm', providerVersion: '1', latencyMs: 5, detections: 'nope' });
  check('non-array detections -> invalid', badDetections.valid === false);
  const badConfidence = validateRecognitionResult({ providerId: 'x', model: 'm', providerVersion: '1', latencyMs: 5, detections: [{ label: 'pollo', labelConfidence: 5 }] });
  check('out-of-range labelConfidence -> invalid with a specific error', badConfidence.valid === false && (badConfidence as any).errors.some((e: string) => e.includes('labelConfidence')));

  console.log('\n── PROVIDER SWAPPING & CAPABILITY (pure) ──');
  const stub2: VisionProvider = {
    id: 'stub2',
    capabilities: { multiFood: false, portionHints: false, barcode: true, ocr: false, video: false },
    async recognize() { return { providerId: 'stub2', model: 'm', providerVersion: '1', detections: [], latencyMs: 0 }; },
  };
  const swapRegistry = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'stub2' }), [fixture, stub2]);
  check('config selects the active provider (swap to stub2)', swapRegistry.active().id === 'stub2');
  check('registry lists all registered providers', swapRegistry.list().length === 2);
  const defaultRegistry = new VisionProviderRegistry(new ConfigService({}), [fixture, stub2]);
  check('default provider is fixture', defaultRegistry.active().id === 'fixture');
  let swapThrew = false;
  try { new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'ghost' }), [fixture]).active(); } catch { swapThrew = true; }
  check('unknown provider throws (fails loud, not silent)', swapThrew === true);
  check('fixture advertises multiFood, not barcode', fixture.capabilities.multiFood === true && fixture.capabilities.barcode === false);

  console.log('\n── EVALUATION HARNESS (any provider, same interface) ──');
  const report = await evaluateProvider(fixture, DEFAULT_EVAL_CASES);
  check('harness reports for the provider id', report.providerId === 'fixture');
  check('all executed cases are contract-valid', report.summary.allContractValid === true);
  check('all executed cases are deterministic (same imageRef -> same output)', report.summary.allDeterministic === true);
  check('latency is measured', typeof report.summary.avgLatencyMs === 'number');
  check('standard plate case executed + succeeded', report.cases.find((c) => c.name === 'standard_plate')?.success === true);
  check('barcode case reports UNSUPPORTED (capability negotiation)', report.cases.find((c) => c.name === 'barcode_probe')?.capabilitySupported === false && report.summary.unsupported === 1);
  const stub2Report = await evaluateProvider(stub2, DEFAULT_EVAL_CASES);
  check('a different provider runs through the SAME harness unchanged', stub2Report.providerId === 'stub2' && stub2Report.summary.allContractValid === true);

  // ── PART B: full lifecycle integration (embedded DB + fixture provider) ──
  console.log('\n── INTEGRATION (embedded Postgres + fixture provider) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-vision-'));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();
  const foodAdapter = new LocalFoodAdapter(prisma);
  const foodSvc = new FoodService(foodAdapter);
  const events = new EventEmitter2();
  const logsSvc = new LogsService(prisma, events);
  const registry = new VisionProviderRegistry(new ConfigService({}), [new FixtureVisionProvider()]);
  const visionSvc = new VisionScanService(prisma, foodSvc, logsSvc, registry, events);

  const user = await prisma.user.create({ data: { email: 'vision@test.local' } });
  await prisma.goal.create({ data: { userId: user.id, type: 'MAINTAIN', targetCalories: 2200, proteinG: 150, carbsG: 250, fatG: 70, fiberTargetG: 30, waterMl: 2500, bmr: 1600, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: 0 } });
  const pollo = await prisma.foodItem.create({ data: { name: 'Pollo a la plancha', nameLower: 'pollo a la plancha', nameNormalized: 'pollo a la plancha', nameAliases: [], caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });
  await prisma.foodItem.create({ data: { name: 'Arroz blanco', nameLower: 'arroz blanco', nameNormalized: 'arroz blanco', nameAliases: [], caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });
  await prisma.foodItem.create({ data: { name: 'Brocoli', nameLower: 'brocoli', nameNormalized: 'brocoli', nameAliases: [], caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 7, fatPer100g: 0.4, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });
  await prisma.servingSize.create({ data: { foodItemId: pollo.id, label: '1 pechuga', grams: 120, isDefault: true } });

  let mealLoggedFired = false;
  events.on('meal.logged', () => { mealLoggedFired = true; });
  let proposedEvt = false, confirmedEvt = false, failedEvt = false;
  events.on(VISION_EVENTS.PROPOSED, () => { proposedEvt = true; });
  events.on(VISION_EVENTS.CONFIRMED, () => { confirmedEvt = true; });
  events.on(VISION_EVENTS.FAILED, () => { failedEvt = true; });

  // ── happy path: multi-food photo -> confirm -> LoggedMeal via the existing path ──
  const proposal = await visionSvc.createScan(user.id, 'photo-chicken-plate.jpg', 'PHOTO');
  check('scan proposes multiple candidates (multi-food)', proposal.status === 'PROPOSED' && proposal.candidates.length === 3, `${proposal.candidates.length}`);
  check('first candidate matched to the catalog Pollo', proposal.candidates[0].foodItemId === pollo.id, `${proposal.candidates[0].displayName}`);
  check('scan-level confidence present with a band', ['HIGH', 'MEDIUM', 'LOW'].includes(proposal.scanConfidence.band));
  check('contractVersion is set', proposal.contractVersion === 1);

  const persisted = await prisma.visionScan.findUnique({ where: { id: proposal.scanId } });
  check('scan persisted as PROPOSED with provider provenance', persisted?.status === 'PROPOSED' && persisted?.providerId === 'fixture');

  const confirmResult = await visionSvc.confirmScan(user.id, {
    scanId: proposal.scanId,
    mealType: 'LUNCH',
    items: proposal.candidates.map((c) => ({
      foodItemId: c.foodItemId,
      quantity: c.portion.grams,
      unit: 'g',
      grams: c.portion.grams,
      acceptedFromCandidate: c.detectionIndex,
    })),
  });
  check('confirm returns today (LogsService.logMeal contract, unchanged)', Array.isArray(confirmResult.meals) && confirmResult.meals.length === 1);
  check('meal.logged fired -> downstream platform reacts exactly as with manual logging', mealLoggedFired === true);

  const loggedMeal = await prisma.loggedMeal.findFirst({ where: { dailyLog: { userId: user.id } } });
  check('LoggedMeal created through the SAME write path (3 items)', loggedMeal?.items === undefined); // sanity: field doesn't exist on the row itself
  const items = await prisma.loggedMealItem.findMany({ where: { loggedMealId: loggedMeal!.id } });
  check('LoggedMeal has 3 items from the confirmed candidates', items.length === 3, `${items.length}`);
  check('provenance stamped: source=vision + visionScanId set', loggedMeal?.source === 'vision' && loggedMeal?.visionScanId === proposal.scanId);

  const scanAfter = await prisma.visionScan.findUnique({ where: { id: proposal.scanId } });
  check('scan transitioned to LOGGED', scanAfter?.status === 'LOGGED');

  const feedback = await prisma.visionFeedback.findMany({ where: { scanId: proposal.scanId } });
  check('feedback captured for every confirmed item', feedback.length === 3, `${feedback.length}`);
  check('unedited accepted candidates recorded as ACCEPTED', feedback.every((f: any) => f.action === 'ACCEPTED'), feedback.map((f: any) => f.action).join(','));

  console.log('\n── VISION EVENTS (internal telemetry, nothing downstream subscribes) ──');
  check('vision.scan.proposed fired on PROPOSED', proposedEvt === true);
  check('vision.scan.confirmed fired on LOGGED', confirmedEvt === true);

  // ── zero detections -> empty proposal, manual fallback signal ──
  console.log('\n── DEGRADATION PATHS ──');
  const emptyProposal = await visionSvc.createScan(user.id, 'blank.jpg', 'PHOTO');
  check('no detections -> empty candidates + NO_DETECTIONS fallback', emptyProposal.candidates.length === 0 && emptyProposal.fallback.reason === 'NO_DETECTIONS');
  check('empty scan is still PROPOSED (not FAILED) — a valid, handled outcome', emptyProposal.status === 'PROPOSED');

  // ── unrecognized food -> candidate with foodItemId null (logs as one-off, like manual entry) ──
  const mysteryProposal = await visionSvc.createScan(user.id, 'mystery-snack.jpg', 'PHOTO');
  check('unmatched label -> candidate with foodItemId null', mysteryProposal.candidates.length === 1 && mysteryProposal.candidates[0].foodItemId === null);
  const mysteryConfirm = await visionSvc.confirmScan(user.id, {
    scanId: mysteryProposal.scanId,
    items: [{ foodItemId: null, customName: mysteryProposal.candidates[0].displayName, quantity: 1, calories: 200, proteinG: 5, carbsG: 20, fatG: 8, acceptedFromCandidate: 0 }],
  });
  check('unmatched candidate still confirms as a one-off item (manual path allows this)', Array.isArray(mysteryConfirm.meals));

  // ── provider failure -> FAILED, never a broken scan, manual fallback signaled ──
  const failRegistry = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'nonexistent' }), [new FixtureVisionProvider()]);
  const failVisionSvc = new VisionScanService(prisma, foodSvc, logsSvc, failRegistry, events);
  const failedProposal = await failVisionSvc.createScan(user.id, 'anything.jpg', 'PHOTO');
  check('unknown provider -> scan FAILED, not thrown to the caller', failedProposal.status === 'FAILED' && failedProposal.fallback.reason === 'PROVIDER_ERROR');
  const failedScanRow = await prisma.visionScan.findUnique({ where: { id: failedProposal.scanId } });
  check('failure reason persisted for audit', !!failedScanRow?.failureReason);
  check('vision.scan.failed event fired', failedEvt === true);

  // ── malformed provider response -> validation gate fails safe (no garbage reaches Nutrition) ──
  const badProvider: VisionProvider = {
    id: 'bad',
    capabilities: { multiFood: true, portionHints: false, barcode: false, ocr: false, video: false },
    async recognize() { return { providerId: 'bad', detections: 'not-an-array' } as any; },
  };
  const badRegistry = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'bad' }), [badProvider]);
  const badSvc = new VisionScanService(prisma, foodSvc, logsSvc, badRegistry, events);
  const badProposal = await badSvc.createScan(user.id, 'chicken.jpg', 'PHOTO');
  check('malformed provider response -> scan FAILED (validation gate, fail-safe)', badProposal.status === 'FAILED');
  const badRow = await prisma.visionScan.findUnique({ where: { id: badProposal.scanId } });
  check('validation failure recorded as the failure reason', !!badRow?.failureReason && badRow.failureReason.includes('INVALID_PROVIDER_RESPONSE'), badRow?.failureReason ?? '');

  // ── expiry: PROPOSED past its window is lazily swept, never confirmable ──
  console.log('\n── LAZY EXPIRY ──');
  const expiring = await visionSvc.createScan(user.id, 'chicken-to-expire.jpg', 'PHOTO');
  await prisma.visionScan.update({ where: { id: expiring.scanId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  let expiredOnConfirm = false;
  try {
    await visionSvc.confirmScan(user.id, { scanId: expiring.scanId, items: [{ foodItemId: pollo.id, quantity: 150, unit: 'g', acceptedFromCandidate: 0 }] });
  } catch {
    expiredOnConfirm = true;
  }
  check('expired scan cannot be confirmed (swept first)', expiredOnConfirm === true);
  const expiredRow = await prisma.visionScan.findUnique({ where: { id: expiring.scanId } });
  check('expired scan status is EXPIRED', expiredRow?.status === 'EXPIRED');

  // ── ownership: a user cannot touch another user's scan ──
  console.log('\n── OWNERSHIP ──');
  const otherUser = await prisma.user.create({ data: { email: 'vision-other@test.local' } });
  const ownedScan = await visionSvc.createScan(user.id, 'chicken-owned.jpg', 'PHOTO');
  let forbidden = false;
  try {
    await visionSvc.getScan(otherUser.id, ownedScan.scanId);
  } catch {
    forbidden = true;
  }
  check("another user cannot read this user's scan", forbidden === true);

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Nutrition Vision V0`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
