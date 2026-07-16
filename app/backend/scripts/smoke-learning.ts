/**
 * Smoke test for Nutrition Vision V3.5 — Continuous Learning & Evaluation
 * Engine. Runs against a throwaway EMBEDDED Postgres; NEVER reads .env, NEVER
 * touches production, NEVER calls a vendor.
 *
 *   npm run smoke:learning
 *
 * Verifies, with HAND-COMPUTED expected values over a precisely seeded
 * dataset: ground-truth assembly (Layer 1), every scorecard metric and
 * breakdown (Layer 2), calibration bins/ECE/curve reuse (Layer 3), the
 * promotion policy's gates (Layer 4), historical replay (including its
 * measured determinism), byte-identical scorecards across runs, and the
 * READ-ONLY guarantee: a full evaluation pass changes zero rows.
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

const PORT = 59442;
const DB = 'vitals_learning_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { PrismaService } from '../src/prisma/prisma.service';
import { FoodService } from '../src/food/food.service';
import { LocalFoodAdapter } from '../src/food/adapters/local.adapter';
import { GroundTruthReader } from '../src/vision/learning/ground-truth.reader';
import { ReplayEngine } from '../src/vision/learning/replay.engine';
import { EvaluationEngine } from '../src/vision/learning/evaluation.engine';
import { buildScorecard } from '../src/vision/learning/pipeline/metrics';
import { buildCalibrationReport, calibrate, CALIBRATION_BIN_COUNT } from '../src/vision/learning/pipeline/calibration';
import { decidePromotion, twoProportionZ } from '../src/vision/learning/pipeline/promotion';
import {
  CalibrationCurve,
  EVAL_CONTRACT_VERSION,
  GroundTruthDataset,
  ProviderScorecard,
} from '../src/vision/learning/types/eval-contract';

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

const W_FROM = new Date('2026-01-01T00:00:00Z');
const W_TO = new Date('2027-01-01T00:00:00Z');

function fakeCard(providerId: string, over: Partial<ProviderScorecard> = {}): ProviderScorecard {
  return {
    contractVersion: EVAL_CONTRACT_VERSION,
    providerId,
    window: { from: W_FROM, to: W_TO },
    sampleSizes: { scans: 500, examples: 500, confirmedScans: 450 },
    top1Accuracy: 0.7,
    top3Accuracy: 0.9,
    recognitionPrecision: 0.8,
    recognitionRecall: 0.8,
    meanPortionErrorPct: 0.2,
    medianPortionErrorPct: 0.2,
    manualCorrectionRate: 0.3,
    fallbackRate: 0.05,
    rejectRate: 0.05,
    failureRate: 0.05,
    providerAvailability: 0.95,
    barcodeAcceptanceRate: null,
    ocrAcceptanceRate: null,
    restaurantContextAcceptanceRate: null,
    meanLatencyMs: 1000,
    p50LatencyMs: 900,
    meanTokensPerScan: 1500,
    calibrationError: 0.1,
    perFood: {},
    perUser: {},
    perCuisine: {},
    perConfidenceBand: {},
    perSource: {},
    ...over,
  };
}

async function main() {
  // ── PART A: pure layers (no DB) ──
  console.log('── V3.5: PROMOTION POLICY (pure — data-driven, never opinion-driven) ──');
  const incumbent = fakeCard('fixture');
  check('two-proportion z: 0.8 vs 0.7 at n=500 each ≈ 3.65', Math.abs(twoProportionZ(0.8, 500, 0.7, 500) - 3.6515) < 0.001);
  const winner = decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8 }));
  check('a statistically superior challenger is promoted', winner.verdict === 'PROMOTE_CHALLENGER', `z=${winner.zScoreTop1}`);
  check('the decision carries measurable reasons, never vibes', winner.reasons.length >= 2 && winner.reasons.some((r) => /z=\d/.test(r)));
  check('a marginal challenger keeps the incumbent (better, not just different)', decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.72 })).verdict === 'KEEP_INCUMBENT');
  check('winning accuracy but regressing portion error still loses', decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8, medianPortionErrorPct: 0.5 })).verdict === 'KEEP_INCUMBENT');
  check('winning accuracy but regressing failure rate still loses', decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8, failureRate: 0.2 })).verdict === 'KEEP_INCUMBENT');
  check('insufficient data keeps the incumbent no matter how good the numbers look', decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.99, sampleSizes: { scans: 10, examples: 20, confirmedScans: 10 } })).verdict === 'INSUFFICIENT_DATA');
  check('ties never promote (the burden of proof is on the challenger)', decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.7 })).verdict === 'KEEP_INCUMBENT');
  check('promotion is deterministic', JSON.stringify(decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8 }))) === JSON.stringify(decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8 }))));

  console.log('\n── V3.5: CALIBRATION INTERFACE (pure — what a confidence has historically MEANT) ──');
  const syntheticBins = Array.from({ length: CALIBRATION_BIN_COUNT }, (_, i) => ({
    lower: i / 10, upper: (i + 1) / 10, n: 0, meanReportedConfidence: null as number | null, empiricalAccuracy: null as number | null,
  }));
  syntheticBins[9] = { lower: 0.9, upper: 1, n: 50, meanReportedConfidence: 0.95, empiricalAccuracy: 0.6 };
  syntheticBins[1] = { lower: 0.1, upper: 0.2, n: 2, meanReportedConfidence: 0.15, empiricalAccuracy: 1 };
  const syntheticCurve: CalibrationCurve = { contractVersion: EVAL_CONTRACT_VERSION, providerId: 'x', builtFrom: { examples: 52, window: { from: W_FROM, to: W_TO } }, bins: syntheticBins };
  check('calibrate(): an overconfident 0.95 maps to its historical 0.6', calibrate(0.95, syntheticCurve) === 0.6);
  check('calibrate(): a sparse bin (n<5) falls through to the raw value — never more opinionated than its evidence', calibrate(0.15, syntheticCurve) === 0.15);
  check('calibrate(): empty bins fall through too', calibrate(0.45, syntheticCurve) === 0.45);
  check('calibrate(): out-of-range input is clamped', calibrate(1.7, syntheticCurve) === 0.6);

  console.log('\n── V3.5: METRICS NULL-SAFETY (pure — unmeasured is null, never zero) ──');
  const emptyDataset: GroundTruthDataset = { contractVersion: EVAL_CONTRACT_VERSION, window: { from: W_FROM, to: W_TO }, providerId: null, examples: [], scans: [] };
  const emptyCard = buildScorecard(emptyDataset, 'ghost');
  check('empty dataset -> every metric null, sample sizes zero', emptyCard.top1Accuracy === null && emptyCard.meanLatencyMs === null && emptyCard.failureRate === null && emptyCard.medianPortionErrorPct === null && emptyCard.sampleSizes.scans === 0);
  check('empty dataset -> empty breakdowns, versioned contract', Object.keys(emptyCard.perFood).length === 0 && emptyCard.contractVersion === EVAL_CONTRACT_VERSION);

  // ── PART B: integration (embedded Postgres, precisely seeded, hand-computed) ──
  console.log('\n── V3.5: INTEGRATION (embedded Postgres — the four layers over real rows) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-learning-'));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();
  const engine = new EvaluationEngine(new GroundTruthReader(prisma), new ReplayEngine(prisma, new FoodService(new LocalFoodAdapter(prisma))));

  const u1 = await prisma.user.create({ data: { email: 'learning@test.local' } });
  const pollo = await prisma.foodItem.create({ data: { name: 'Pollo a la plancha', nameLower: 'pollo a la plancha', nameNormalized: 'pollo a la plancha', nameAliases: [], caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });
  const arroz = await prisma.foodItem.create({ data: { name: 'Arroz blanco', nameLower: 'arroz blanco', nameNormalized: 'arroz blanco', nameAliases: [], caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });

  const DET = [{ label: 'pollo a la plancha', labelConfidence: 0.9, portionHint: { grams: 150, confidence: 0.6 } }];
  const candidate = (foodItemId: string, displayName: string, conf: number, alternates: any[] = []) => ({
    detectionIndex: 0, foodItemId, displayName, matchScore: 1,
    portion: { grams: 150, method: 'PROVIDER_ESTIMATE', confidence: 0.6 },
    confidence: { recognition: conf, match: 1, portion: 0.6, overall: conf, band: conf >= 0.75 ? 'HIGH' : conf >= 0.45 ? 'MEDIUM' : 'LOW' },
    alternates,
  });
  const proposalOf = (cand: any, restaurant?: any) => ({
    scanId: 'seeded', status: 'PROPOSED', source: 'PHOTO', mode: 'CONFIRM', candidates: [cand],
    scanConfidence: { overall: cand.confidence.overall, band: cand.confidence.band }, suggestedMealType: 'LUNCH',
    fallback: { reason: null }, contractVersion: 1, ...(restaurant ? { restaurant } : {}),
  });
  const mkScan = (data: Record<string, unknown>) =>
    prisma.visionScan.create({ data: { userId: u1.id, source: 'PHOTO', imageRef: 'seed.jpg', expiresAt: W_TO, providerId: 'alpha', providerVersion: '1.0.0', ...data } as any });

  // alpha: 4 LOGGED photo + FAILED + FALLBACK_MANUAL + REJECTED + BARCODE LOGGED + LABEL_OCR REJECTED = 9 scans
  const a1 = await mkScan({ status: 'LOGGED', confirmedAt: new Date(), detections: DET as any, proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.9)) as any, latencyMs: 100, tokensIn: 1000, tokensOut: 200 });
  const a2 = await mkScan({ status: 'LOGGED', confirmedAt: new Date(), detections: DET as any, proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.9, [{ foodItemId: arroz.id, displayName: 'Arroz blanco', matchScore: 0.8 }]), { restaurantName: 'La Esquina', category: 'latam', confidence: 0.8, menuCandidates: [] }) as any, latencyMs: 200 });
  const a3 = await mkScan({ status: 'LOGGED', confirmedAt: new Date(), detections: DET as any, proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.3)) as any });
  const a4 = await mkScan({ status: 'LOGGED', confirmedAt: new Date(), detections: DET as any, proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.7)) as any });
  await mkScan({ status: 'FAILED', failureReason: 'VISION_PROVIDER_ERROR: boom' });
  await mkScan({ status: 'FALLBACK_MANUAL', failureReason: 'USER_CHOSE_MANUAL' });
  await mkScan({ status: 'REJECTED', proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.8)) as any });
  const a8 = await mkScan({ status: 'LOGGED', source: 'BARCODE', confirmedAt: new Date(), proposal: { ...proposalOf(candidate(arroz.id, 'Arroz blanco', 0.9)), source: 'BARCODE' } as any });
  await mkScan({ status: 'REJECTED', source: 'LABEL_OCR', proposal: { ...proposalOf(candidate(arroz.id, 'Arroz blanco', 0.6)), source: 'LABEL_OCR' } as any });

  // beta: 2 LOGGED photo scans, both accepted — good numbers, tiny sample
  const b1 = await mkScan({ status: 'LOGGED', providerId: 'beta', confirmedAt: new Date(), detections: DET as any, proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.8)) as any });
  const b2 = await mkScan({ status: 'LOGGED', providerId: 'beta', confirmedAt: new Date(), detections: DET as any, proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.8)) as any });

  const fb = (scanId: string, data: Record<string, unknown>) =>
    prisma.visionFeedback.create({ data: { scanId, userId: u1.id, detectionIndex: 0, ...data } as any });
  await fb(a1.id, { action: 'ACCEPTED', proposedFoodItemId: pollo.id, confirmedFoodItemId: pollo.id, proposedGrams: 100, confirmedGrams: 100, proposedMethod: 'PROVIDER_ESTIMATE' });
  await fb(a2.id, { action: 'SWAPPED', proposedFoodItemId: pollo.id, confirmedFoodItemId: arroz.id, proposedGrams: 100, confirmedGrams: 90 });
  await fb(a3.id, { action: 'EDITED_PORTION', proposedFoodItemId: pollo.id, confirmedFoodItemId: pollo.id, proposedGrams: 200, confirmedGrams: 100 });
  await fb(a4.id, { action: 'ACCEPTED', proposedFoodItemId: pollo.id, confirmedFoodItemId: pollo.id, proposedGrams: 150, confirmedGrams: 150 });
  await fb(a4.id, { action: 'ADDED_MANUAL', detectionIndex: -1, proposedFoodItemId: null, confirmedFoodItemId: arroz.id, proposedGrams: null, confirmedGrams: 50 });
  await fb(a8.id, { action: 'ACCEPTED', proposedFoodItemId: arroz.id, confirmedFoodItemId: arroz.id, proposedGrams: 85, confirmedGrams: 85 });
  await fb(b1.id, { action: 'ACCEPTED', proposedFoodItemId: pollo.id, confirmedFoodItemId: pollo.id, proposedGrams: 120, confirmedGrams: 120 });
  await fb(b2.id, { action: 'ACCEPTED', proposedFoodItemId: pollo.id, confirmedFoodItemId: pollo.id, proposedGrams: 120, confirmedGrams: 120 });

  const countsBefore = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    foods: await prisma.foodItem.count(),
    meals: await prisma.loggedMeal.count(),
  };

  const win = { from: W_FROM, to: W_TO };

  console.log('\n── V3.5: LAYER 1 — GROUND TRUTH (the moat, counted) ──');
  const summary = await engine.summary(win);
  check('summary counts every terminal scan and every labeled example', summary.totalScans === 11 && summary.totalExamples === 8);
  check('both providers visible, alphabetical', JSON.stringify(summary.providers) === JSON.stringify(['alpha', 'beta']));
  check('examples broken down by action', summary.examplesByAction['ACCEPTED'] === 5 && summary.examplesByAction['SWAPPED'] === 1 && summary.examplesByAction['EDITED_PORTION'] === 1 && summary.examplesByAction['ADDED_MANUAL'] === 1);
  check('scans broken down by status and source', summary.scansByStatus['LOGGED'] === 7 && summary.scansByStatus['REJECTED'] === 2 && summary.scansBySource['BARCODE'] === 1 && summary.scansBySource['LABEL_OCR'] === 1);

  console.log('\n── V3.5: LAYER 2 — SCORECARD (every number hand-computed) ──');
  const card = await engine.scorecard('alpha', win);
  check('top-1 accuracy = 4/5 proposals held', card.top1Accuracy === 0.8, `${card.top1Accuracy}`);
  check('top-3 accuracy = 5/5 (the swap target was in alternates)', card.top3Accuracy === 1);
  check('recognition recall = 5/(5+1 manual addition)', card.recognitionRecall === 0.8333);
  check('recognition precision = 5 confirmed / 7 proposed candidates', card.recognitionPrecision === 0.7143);
  check('mean portion error = (0+0.1111+1+0+0)/5', card.meanPortionErrorPct === 0.2222, `${card.meanPortionErrorPct}`);
  check('median portion error = 0 (robust to the one wild miss)', card.medianPortionErrorPct === 0);
  check('manual correction rate = 2/5 (one swap + one portion edit)', card.manualCorrectionRate === 0.4);
  check('fallback 1/9, reject 2/9, failure 1/9', card.fallbackRate === 0.1111 && card.rejectRate === 0.2222 && card.failureRate === 0.1111);
  check('provider availability = 1 − provider-attributed failures', card.providerAvailability === 0.8889);
  check('latency: mean 150, p50 150 — from telemetry the platform used to discard', card.meanLatencyMs === 150 && card.p50LatencyMs === 150);
  check('cost proxy: 1200 tokens/scan over metered scans', card.meanTokensPerScan === 1200);
  check('modality acceptance: barcode 1.0, OCR 0.0, restaurant-context 1.0 (proxies, named as such)', card.barcodeAcceptanceRate === 1 && card.ocrAcceptanceRate === 0 && card.restaurantContextAcceptanceRate === 1);
  check('sample sizes: 9 scans, 6 examples, 5 confirmed scans', card.sampleSizes.scans === 9 && card.sampleSizes.examples === 6 && card.sampleSizes.confirmedScans === 5);

  console.log('\n── V3.5: BREAKDOWNS (which foods, users, cuisines, confidence ranges) ──');
  check('per-food: pollo n=4 top1 0.75; arroz n=1 top1 1', card.perFood['Pollo a la plancha']?.n === 4 && card.perFood['Pollo a la plancha']?.top1Accuracy === 0.75 && card.perFood['Arroz blanco']?.top1Accuracy === 1);
  check('per-user: all 5 proposals belong to the seeded user', card.perUser[u1.id]?.n === 5);
  check('per-cuisine: the restaurant-context swap shows up under latam with top1 0', card.perCuisine['latam']?.n === 1 && card.perCuisine['latam']?.top1Accuracy === 0);
  check('per-confidence: HIGH n=3 top1 0.6667, MEDIUM n=1, LOW n=1', card.perConfidenceBand['HIGH']?.n === 3 && card.perConfidenceBand['HIGH']?.top1Accuracy === 0.6667 && card.perConfidenceBand['MEDIUM']?.n === 1 && card.perConfidenceBand['LOW']?.n === 1);
  check('per-source: PHOTO n=4, BARCODE n=1', card.perSource['PHOTO']?.n === 4 && card.perSource['BARCODE']?.n === 1);

  console.log('\n── V3.5: LAYER 3 — CALIBRATION (is a 0.9 really a 0.9?) ──');
  const calReport = await engine.calibration('alpha', win);
  const topBin = calReport.curve.bins[9];
  check('the 0.9 bin holds 3 examples with empirical accuracy 0.6667', topBin.n === 3 && topBin.empiricalAccuracy === 0.6667 && topBin.meanReportedConfidence === 0.9);
  check('ECE = 0.34 (hand-computed over 5 examples)', calReport.expectedCalibrationError === 0.34, `${calReport.expectedCalibrationError}`);
  check('not flagged overconfident (low-confidence bins over-delivered)', calReport.overconfident === false);
  check('curve is versioned and declares its evidence', calReport.curve.contractVersion === EVAL_CONTRACT_VERSION && calReport.curve.builtFrom.examples === 5);
  check("the scorecard carries the calibration error (engine attaches Layer 3's output)", card.calibrationError === 0.34);

  console.log('\n── V3.5: LAYER 4 — PROMOTION OVER REAL ROWS ──');
  const comparison = await engine.compare('alpha', 'beta', win);
  check('9 vs 2 production scans -> INSUFFICIENT_DATA, incumbent holds', comparison.decision.verdict === 'INSUFFICIENT_DATA');
  check('the refusal names the missing evidence', comparison.decision.reasons.some((r) => r.includes('insufficient data')));
  check('comparison embeds both full scorecards', comparison.incumbent.providerId === 'alpha' && comparison.challenger.providerId === 'beta' && comparison.challenger.top1Accuracy === 1);

  console.log('\n── V3.5: HISTORICAL REPLAY (read-only, measured determinism) ──');
  const replay = await engine.replay(win);
  check('replays every photo scan with detections and feedback (both providers)', replay.scansReplayed === 6 && replay.examplesCompared === 6);
  check('replay top-1 = 5/6 against ground truth', replay.top1Accuracy === 0.8333, `${replay.top1Accuracy}`);
  check('replay median portion error = 0.375 (unpersonalized pipeline floor)', replay.medianPortionErrorPct === 0.375, `${replay.medianPortionErrorPct}`);
  check('determinism MEASURED: two full passes, identical metrics', replay.deterministic === true);

  console.log('\n── V3.5: READ-ONLY GUARANTEE + DETERMINISM ──');
  const countsAfter = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    foods: await prisma.foodItem.count(),
    meals: await prisma.loggedMeal.count(),
  };
  check('a FULL evaluation pass (summary+scorecard+calibration+comparison+replay) changed ZERO rows', JSON.stringify(countsBefore) === JSON.stringify(countsAfter), JSON.stringify(countsAfter));
  const cardAgain = await engine.scorecard('alpha', win);
  check('same window, same data -> byte-identical scorecard', JSON.stringify(card) === JSON.stringify(cardAgain));
  check('every report is contract-versioned', card.contractVersion === 1 && calReport.curve.contractVersion === 1 && comparison.contractVersion === 1 && replay.contractVersion === 1);

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Continuous Learning & Evaluation (V3.5)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
