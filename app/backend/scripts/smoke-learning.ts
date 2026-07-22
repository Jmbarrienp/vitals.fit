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
const { ConfigService } = require('@nestjs/config');

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
  ProviderComparison,
  ProviderScorecard,
} from '../src/vision/learning/types/eval-contract';
import { computeTrust, decayFactor, daysBetween } from '../src/vision/learning/pipeline/trust';
import { decideAutoAccept, AutoAcceptInput, UNDO_WINDOW_SECONDS } from '../src/vision/learning/pipeline/auto-accept';
import { TrustEvidence, TRUST_POLICY_VERSION } from '../src/vision/learning/types/trust-contract';
import { deriveUxMode } from '../src/vision/pipeline/confidence';
import { PromotionExecutor } from '../src/vision/learning/promotion.executor';
import { VisionProviderRegistry } from '../src/vision/providers/provider.registry';
import { FixtureVisionProvider } from '../src/vision/providers/fixture.provider';
import { TrustEvidenceReader } from '../src/vision/learning/trust-evidence.reader';
import { TrustAuditService } from '../src/vision/learning/trust-audit.service';

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
  check(
    'two-proportion z: 0.8 vs 0.7 at n=500 each ≈ 3.65',
    Math.abs(twoProportionZ(0.8, 500, 0.7, 500) - 3.6515) < 0.001,
  );
  const winner = decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8 }));
  check(
    'a statistically superior challenger is promoted',
    winner.verdict === 'PROMOTE_CHALLENGER',
    `z=${winner.zScoreTop1}`,
  );
  check(
    'the decision carries measurable reasons, never vibes',
    winner.reasons.length >= 2 && winner.reasons.some((r) => /z=\d/.test(r)),
  );
  check(
    'a marginal challenger keeps the incumbent (better, not just different)',
    decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.72 })).verdict === 'KEEP_INCUMBENT',
  );
  check(
    'winning accuracy but regressing portion error still loses',
    decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8, medianPortionErrorPct: 0.5 })).verdict ===
      'KEEP_INCUMBENT',
  );
  check(
    'winning accuracy but regressing failure rate still loses',
    decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8, failureRate: 0.2 })).verdict ===
      'KEEP_INCUMBENT',
  );
  check(
    'insufficient data keeps the incumbent no matter how good the numbers look',
    decidePromotion(
      incumbent,
      fakeCard('claude', { top1Accuracy: 0.99, sampleSizes: { scans: 10, examples: 20, confirmedScans: 10 } }),
    ).verdict === 'INSUFFICIENT_DATA',
  );
  check(
    'ties never promote (the burden of proof is on the challenger)',
    decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.7 })).verdict === 'KEEP_INCUMBENT',
  );
  check(
    'promotion is deterministic',
    JSON.stringify(decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8 }))) ===
      JSON.stringify(decidePromotion(incumbent, fakeCard('claude', { top1Accuracy: 0.8 }))),
  );

  console.log('\n── V3.5: CALIBRATION INTERFACE (pure — what a confidence has historically MEANT) ──');
  const syntheticBins = Array.from({ length: CALIBRATION_BIN_COUNT }, (_, i) => ({
    lower: i / 10,
    upper: (i + 1) / 10,
    n: 0,
    meanReportedConfidence: null as number | null,
    empiricalAccuracy: null as number | null,
  }));
  syntheticBins[9] = { lower: 0.9, upper: 1, n: 50, meanReportedConfidence: 0.95, empiricalAccuracy: 0.6 };
  syntheticBins[1] = { lower: 0.1, upper: 0.2, n: 2, meanReportedConfidence: 0.15, empiricalAccuracy: 1 };
  const syntheticCurve: CalibrationCurve = {
    contractVersion: EVAL_CONTRACT_VERSION,
    providerId: 'x',
    builtFrom: { examples: 52, window: { from: W_FROM, to: W_TO } },
    bins: syntheticBins,
  };
  check('calibrate(): an overconfident 0.95 maps to its historical 0.6', calibrate(0.95, syntheticCurve) === 0.6);
  check(
    'calibrate(): a sparse bin (n<5) falls through to the raw value — never more opinionated than its evidence',
    calibrate(0.15, syntheticCurve) === 0.15,
  );
  check('calibrate(): empty bins fall through too', calibrate(0.45, syntheticCurve) === 0.45);
  check('calibrate(): out-of-range input is clamped', calibrate(1.7, syntheticCurve) === 0.6);

  console.log('\n── V3.5: METRICS NULL-SAFETY (pure — unmeasured is null, never zero) ──');
  const emptyDataset: GroundTruthDataset = {
    contractVersion: EVAL_CONTRACT_VERSION,
    window: { from: W_FROM, to: W_TO },
    providerId: null,
    examples: [],
    scans: [],
  };
  const emptyCard = buildScorecard(emptyDataset, 'ghost');
  check(
    'empty dataset -> every metric null, sample sizes zero',
    emptyCard.top1Accuracy === null &&
      emptyCard.meanLatencyMs === null &&
      emptyCard.failureRate === null &&
      emptyCard.medianPortionErrorPct === null &&
      emptyCard.sampleSizes.scans === 0,
  );
  check(
    'empty dataset -> empty breakdowns, versioned contract',
    Object.keys(emptyCard.perFood).length === 0 && emptyCard.contractVersion === EVAL_CONTRACT_VERSION,
  );

  console.log('\n── V3.6: TRUST ENGINE (pure — earned, decaying, never granted) ──');
  const NOW = new Date('2026-07-16T12:00:00Z');
  const ev = (over: Partial<TrustEvidence> = {}): TrustEvidence => ({
    userId: 'u',
    foodItemId: 'f',
    modality: 'PHOTO',
    confirmations: 0,
    corrections: 0,
    undos: 0,
    lastConfirmedAt: null,
    lastUndoAt: null,
    userTotalConfirmations: 20,
    ...over,
  });
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

  const newUser = computeTrust(ev({ userTotalConfirmations: 0 }), 0.9, 0.9, NOW);
  check(
    'new user + unknown food -> NONE, score 0 (trust is never granted)',
    newUser.level === 'NONE' && newUser.score === 0,
  );
  check(
    '…and it says so in platform vocabulary',
    newUser.signals.includes('NEW_USER') && newUser.signals.includes('UNKNOWN_FOOD'),
  );

  const once = computeTrust(ev({ confirmations: 1, lastConfirmedAt: daysAgo(0) }), 0.9, 0.9, NOW);
  check('one sighting is not a pattern -> MEDIUM (0.5), never HIGH', once.level === 'MEDIUM' && once.score === 0.5);
  const fifth = computeTrust(ev({ confirmations: 5, lastConfirmedAt: daysAgo(0) }), 0.9, 0.9, NOW);
  check(
    'the goal narrative: 5 clean confirmations -> HIGH (0.8333)',
    fifth.level === 'HIGH' && fifth.score === 0.8333,
    `${fifth.score}`,
  );
  const twiceBarcode = computeTrust(
    ev({ confirmations: 2, modality: 'BARCODE', lastConfirmedAt: daysAgo(0) }),
    1,
    1,
    NOW,
  );
  check(
    'a clean 2-confirmation record reaches HIGH — barcode CAN graduate at its minimum',
    twiceBarcode.level === 'HIGH' && twiceBarcode.score === 0.6667,
  );

  const corrected = computeTrust(ev({ confirmations: 5, corrections: 1, lastConfirmedAt: daysAgo(0) }), 0.9, 0.9, NOW);
  check(
    'a correction costs 2 confirmations -> drops out of HIGH',
    corrected.level === 'MEDIUM' && corrected.score === 0.5952,
    `${corrected.score}`,
  );
  check(
    '…and explains itself',
    corrected.signals.includes('RECENT_CORRECTIONS') && corrected.reasons.some((r) => r.includes('impecable')),
  );
  const recovered = computeTrust(ev({ confirmations: 12, corrections: 1, lastConfirmedAt: daysAgo(0) }), 0.9, 0.9, NOW);
  check('…but evidence recovers trust: 12 confirmations outweigh one old correction', recovered.level === 'HIGH');

  const undone = computeTrust(
    ev({ confirmations: 20, undos: 1, lastConfirmedAt: daysAgo(0), lastUndoAt: daysAgo(2) }),
    0.9,
    0.9,
    NOW,
  );
  check(
    'CATASTROPHIC: one recent undo zeroes trust instantly, whatever the history',
    undone.level === 'NONE' && undone.score === 0,
  );
  check(
    '…named as a recent undo, with the cooldown stated',
    undone.signals.includes('RECENT_UNDO') && undone.reasons.some((r) => r.includes('14')),
  );
  const oldUndo = computeTrust(
    ev({ confirmations: 20, undos: 1, lastConfirmedAt: daysAgo(0), lastUndoAt: daysAgo(30) }),
    0.9,
    0.9,
    NOW,
  );
  check(
    'an OLD undo still costs 5 confirmations but no longer blocks outright',
    oldUndo.level === 'HIGH' && !oldUndo.signals.includes('RECENT_UNDO'),
  );
  const undoDominates = computeTrust(
    ev({ confirmations: 3, undos: 1, lastConfirmedAt: daysAgo(0), lastUndoAt: daysAgo(30) }),
    0.9,
    0.9,
    NOW,
  );
  check('with little history, one old undo still dominates', undoDominates.level !== 'HIGH', `${undoDominates.score}`);

  const decayed = computeTrust(ev({ confirmations: 5, lastConfirmedAt: daysAgo(45) }), 0.9, 0.9, NOW);
  check(
    'decay: 45 days (one half-life) halves earned trust -> out of HIGH',
    decayed.level === 'MEDIUM' && decayed.score === 0.4167,
    `${decayed.score}`,
  );
  check('…and says why', decayed.signals.includes('TRUST_DECAYED'));
  check(
    'decay is exponential and exact at the half-life',
    decayFactor(45) === 0.5 && decayFactor(90) === 0.25 && decayFactor(0) === 1,
  );
  check(
    'no permanent trust: 180 days of inactivity -> NONE',
    computeTrust(ev({ confirmations: 5, lastConfirmedAt: daysAgo(180) }), 0.9, 0.9, NOW).level === 'NONE',
  );
  check(
    'a future timestamp cannot manufacture trust (clock skew guard)',
    daysBetween(new Date(NOW.getTime() + 86_400_000), NOW) === 0,
  );

  const uncalibrated = computeTrust(ev({ confirmations: 5, lastConfirmedAt: daysAgo(0) }), 0.9, 0.5, NOW);
  check(
    'a reported 0.9 that historically means 0.5 is flagged CALIBRATED_LOW',
    uncalibrated.signals.includes('CALIBRATED_LOW') && uncalibrated.signals.includes('HIGH_CONFIDENCE'),
  );
  check(
    'trust is deterministic',
    JSON.stringify(computeTrust(ev({ confirmations: 5, lastConfirmedAt: daysAgo(3) }), 0.9, 0.9, NOW)) ===
      JSON.stringify(computeTrust(ev({ confirmations: 5, lastConfirmedAt: daysAgo(3) }), 0.9, 0.9, NOW)),
  );
  check('policy version travels on every decision', fifth.policyVersion === TRUST_POLICY_VERSION);

  console.log('\n── V3.6: AUTO-ACCEPT POLICY (pure — modalities graduate differently) ──');
  const aaInput = (over: Partial<AutoAcceptInput> = {}): AutoAcceptInput => ({
    trust: fifth,
    modality: 'PHOTO',
    calibratedConfidence: 0.9,
    fallbackReason: null,
    candidateCount: 1,
    allCandidatesGraduated: true,
    enabled: true,
    ...over,
  });
  const graduated = decideAutoAccept(aaInput());
  check(
    'the goal narrative: 5th grilled chicken -> AUTO_ACCEPT, executed',
    graduated.action === 'AUTO_ACCEPT' && graduated.executed === true,
  );
  check(
    '…with an undo window and a reason in the user language',
    graduated.undoWindowSeconds === UNDO_WINDOW_SECONDS && graduated.reason.includes('5 confirmaciones'),
  );
  check(
    'SHADOW MODE: disabled -> decided AUTO_ACCEPT but never acts, no undo window',
    (() => {
      const d = decideAutoAccept(aaInput({ enabled: false }));
      return d.action === 'AUTO_ACCEPT' && d.executed === false && d.undoWindowSeconds === 0;
    })(),
  );

  check(
    'barcode graduates EARLIEST (2 confirmations is enough)',
    decideAutoAccept(aaInput({ trust: twiceBarcode, modality: 'BARCODE', calibratedConfidence: 1 })).action ===
      'AUTO_ACCEPT',
  );
  check(
    'the same 2 confirmations do NOT graduate a photo',
    decideAutoAccept(aaInput({ trust: twiceBarcode, modality: 'PHOTO' })).action === 'REVIEW_REQUIRED',
  );
  const restaurantTrust = computeTrust(
    ev({ confirmations: 5, modality: 'RESTAURANT', lastConfirmedAt: daysAgo(0) }),
    0.9,
    0.9,
    NOW,
  );
  check(
    'restaurant graduates LAST: 5 confirmations still not enough (needs 8)',
    decideAutoAccept(aaInput({ trust: restaurantTrust, modality: 'RESTAURANT' })).action === 'REVIEW_REQUIRED',
  );
  check(
    '…and the reason states the gap',
    decideAutoAccept(aaInput({ trust: restaurantTrust, modality: 'RESTAURANT' })).reason.includes('5/8'),
  );
  check(
    'OCR sits between barcode and vision (needs 3)',
    decideAutoAccept(
      aaInput({
        trust: computeTrust(
          ev({ confirmations: 3, modality: 'LABEL_OCR', lastConfirmedAt: daysAgo(0) }),
          0.9,
          0.9,
          NOW,
        ),
        modality: 'LABEL_OCR',
      }),
    ).action === 'AUTO_ACCEPT',
  );

  check(
    'a degraded scan is never a trust question -> MANUAL_REVIEW',
    decideAutoAccept(aaInput({ fallbackReason: 'PROVIDER_ERROR' })).action === 'MANUAL_REVIEW',
  );
  check(
    'zero candidates -> MANUAL_REVIEW',
    decideAutoAccept(aaInput({ candidateCount: 0 })).action === 'MANUAL_REVIEW',
  );
  check(
    'a plate is only as trusted as its least-known food',
    decideAutoAccept(aaInput({ candidateCount: 3, allCandidatesGraduated: false })).action === 'REVIEW_REQUIRED',
  );
  check(
    'an uncalibrated provider may never auto-accept (null != trusted)',
    decideAutoAccept(aaInput({ calibratedConfidence: null })).action === 'REVIEW_REQUIRED',
  );
  check(
    'a confidence that historically over-promises may never auto-accept',
    decideAutoAccept(aaInput({ calibratedConfidence: 0.5 })).action === 'REVIEW_REQUIRED',
  );
  check(
    'trust NONE -> REVIEW_REQUIRED, never auto-accept',
    decideAutoAccept(aaInput({ trust: undone })).action === 'REVIEW_REQUIRED',
  );
  check(
    'decayed trust -> REVIEW_REQUIRED (earned once is not earned forever)',
    decideAutoAccept(aaInput({ trust: decayed })).action === 'REVIEW_REQUIRED',
  );
  check(
    'every decision carries its trust and policy version',
    graduated.trust.level === 'HIGH' && graduated.policyVersion === TRUST_POLICY_VERSION,
  );
  check(
    'auto-accept policy is deterministic',
    JSON.stringify(decideAutoAccept(aaInput())) === JSON.stringify(decideAutoAccept(aaInput())),
  );

  console.log('\n── V3.6: PROMOTION EXECUTOR (recommends; can never act) ──');
  const registryWithClaude = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'fixture' }), [
    new FixtureVisionProvider(),
    {
      id: 'claude',
      capabilities: { multiFood: true, portionHints: true, barcode: false, ocr: false, video: false },
      async recognize() {
        throw new Error('not called');
      },
    } as any,
  ]);
  const executor = new PromotionExecutor(
    {} as any,
    registryWithClaude,
    new ConfigService({ VISION_PROVIDER: 'fixture' }),
  );
  const cmp = (incumbent: ProviderScorecard, challenger: ProviderScorecard): ProviderComparison => ({
    contractVersion: EVAL_CONTRACT_VERSION,
    incumbent,
    challenger,
    decision: decidePromotion(incumbent, challenger),
  });

  const winnerRec = executor.buildRecommendation(cmp(fakeCard('fixture'), fakeCard('claude', { top1Accuracy: 0.8 })));
  check(
    'a statistically superior, REGISTERED challenger is recommended',
    winnerRec.recommend === true && winnerRec.verdict === 'PROMOTE_CHALLENGER',
  );
  check('the recommendation reports the ACTIVE provider — never switches it', winnerRec.activeProviderId === 'fixture');
  check(
    'evidence quotes V3.5 verbatim and adds the operational deltas',
    winnerRec.evidence.some((e) => e.includes('z=')) &&
      winnerRec.evidence.some((e) => e.includes('top-1')) &&
      winnerRec.evidence.some((e) => e.includes('ECE')),
  );
  check(
    'a human checklist ships with it, reversion plan included',
    winnerRec.checklist.length >= 5 &&
      winnerRec.checklist.some((c) => c.includes('VISION_PROVIDER=claude')) &&
      winnerRec.checklist.some((c) => c.includes('reversión')),
  );
  check(
    'impact names the calibration reset (auto-accept stops graduating on a new provider)',
    winnerRec.impact.some((i) => i.includes('calibración')),
  );
  check(
    '…and that earned user trust survives a provider change (it lives in VisionFeedback)',
    winnerRec.impact.some((i) => i.includes('VisionFeedback')),
  );

  const unregistered = executor.buildRecommendation(cmp(fakeCard('fixture'), fakeCard('ghost', { top1Accuracy: 0.9 })));
  check(
    'an UNREGISTERED challenger is never recommended, however good its numbers',
    unregistered.recommend === false && unregistered.challengerRegistered === false && unregistered.risk === 'HIGH',
  );
  const keepRec = executor.buildRecommendation(cmp(fakeCard('fixture'), fakeCard('claude', { top1Accuracy: 0.71 })));
  check(
    'KEEP_INCUMBENT is not a recommendation to promote',
    keepRec.recommend === false && keepRec.explanation.includes('sigue siendo el proveedor correcto'),
  );
  const worseCal = executor.buildRecommendation(
    cmp(fakeCard('fixture'), fakeCard('claude', { top1Accuracy: 0.8, calibrationError: 0.3 })),
  );
  check(
    'worse calibration raises risk even when promotion is statistically justified',
    worseCal.recommend === true &&
      worseCal.risk === 'MEDIUM' &&
      worseCal.riskFactors.some((r) => r.includes('calibrado')),
  );
  const costly = executor.buildRecommendation(
    cmp(fakeCard('fixture'), fakeCard('claude', { top1Accuracy: 0.8, meanTokensPerScan: 5000, meanLatencyMs: 9000 })),
  );
  check(
    'cost and latency regressions surface as risk factors',
    costly.riskFactors.some((r) => r.includes('coste')) && costly.riskFactors.some((r) => r.includes('latencia')),
  );
  const drift = executor.buildRecommendation(cmp(fakeCard('claude'), fakeCard('gpt', { top1Accuracy: 0.8 })));
  check(
    'comparing an incumbent that is NOT what production runs is flagged HIGH risk',
    drift.risk === 'HIGH' && drift.riskFactors.some((r) => r.includes('no es el incumbente')),
  );
  check(
    'promotion recommendation is deterministic',
    JSON.stringify(
      executor.buildRecommendation(cmp(fakeCard('fixture'), fakeCard('claude', { top1Accuracy: 0.8 }))),
    ) === JSON.stringify(winnerRec),
  );

  console.log('\n── V3.6: deriveUxMode — trust plugs into the V1 seam, degradation still wins ──');
  check(
    'pre-V3.6 callers are byte-identical (default param)',
    deriveUxMode('HIGH', null, 2) === 'CONFIRM' &&
      deriveUxMode('MEDIUM', null, 2) === 'REVIEW' &&
      deriveUxMode('LOW', null, 2) === 'FALLBACK',
  );
  check('autoAccepted -> AUTO_ACCEPT', deriveUxMode('HIGH', null, 2, true) === 'AUTO_ACCEPT');
  check(
    'NO amount of trust auto-accepts a degraded scan',
    deriveUxMode('HIGH', 'PROVIDER_ERROR', 2, true) === 'FALLBACK' && deriveUxMode('LOW', null, 2, true) === 'FALLBACK',
  );

  // ── PART B: integration (embedded Postgres, precisely seeded, hand-computed) ──
  console.log('\n── V3.5: INTEGRATION (embedded Postgres — the four layers over real rows) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-learning-'));
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
  const engine = new EvaluationEngine(
    new GroundTruthReader(prisma),
    new ReplayEngine(prisma, new FoodService(new LocalFoodAdapter(prisma))),
  );

  const u1 = await prisma.user.create({ data: { email: 'learning@test.local' } });
  const pollo = await prisma.foodItem.create({
    data: {
      name: 'Pollo a la plancha',
      nameLower: 'pollo a la plancha',
      nameNormalized: 'pollo a la plancha',
      nameAliases: [],
      caloriesPer100g: 165,
      proteinPer100g: 31,
      carbsPer100g: 0,
      fatPer100g: 3.6,
      fiberPer100g: 0,
      source: 'curated_latam',
      isCommon: true,
    },
  });
  const arroz = await prisma.foodItem.create({
    data: {
      name: 'Arroz blanco',
      nameLower: 'arroz blanco',
      nameNormalized: 'arroz blanco',
      nameAliases: [],
      caloriesPer100g: 130,
      proteinPer100g: 2.7,
      carbsPer100g: 28,
      fatPer100g: 0.3,
      fiberPer100g: 0,
      source: 'curated_latam',
      isCommon: true,
    },
  });

  const DET = [{ label: 'pollo a la plancha', labelConfidence: 0.9, portionHint: { grams: 150, confidence: 0.6 } }];
  const candidate = (foodItemId: string, displayName: string, conf: number, alternates: any[] = []) => ({
    detectionIndex: 0,
    foodItemId,
    displayName,
    matchScore: 1,
    portion: { grams: 150, method: 'PROVIDER_ESTIMATE', confidence: 0.6 },
    confidence: {
      recognition: conf,
      match: 1,
      portion: 0.6,
      overall: conf,
      band: conf >= 0.75 ? 'HIGH' : conf >= 0.45 ? 'MEDIUM' : 'LOW',
    },
    alternates,
  });
  const proposalOf = (cand: any, restaurant?: any) => ({
    scanId: 'seeded',
    status: 'PROPOSED',
    source: 'PHOTO',
    mode: 'CONFIRM',
    candidates: [cand],
    scanConfidence: { overall: cand.confidence.overall, band: cand.confidence.band },
    suggestedMealType: 'LUNCH',
    fallback: { reason: null },
    contractVersion: 1,
    ...(restaurant ? { restaurant } : {}),
  });
  const mkScan = (data: Record<string, unknown>) =>
    prisma.visionScan.create({
      data: {
        userId: u1.id,
        source: 'PHOTO',
        imageRef: 'seed.jpg',
        expiresAt: W_TO,
        providerId: 'alpha',
        providerVersion: '1.0.0',
        ...data,
      } as any,
    });

  // alpha: 4 LOGGED photo + FAILED + FALLBACK_MANUAL + REJECTED + BARCODE LOGGED + LABEL_OCR REJECTED = 9 scans
  const a1 = await mkScan({
    status: 'LOGGED',
    confirmedAt: new Date(),
    detections: DET as any,
    proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.9)) as any,
    latencyMs: 100,
    tokensIn: 1000,
    tokensOut: 200,
  });
  const a2 = await mkScan({
    status: 'LOGGED',
    confirmedAt: new Date(),
    detections: DET as any,
    proposal: proposalOf(
      candidate(pollo.id, 'Pollo a la plancha', 0.9, [
        { foodItemId: arroz.id, displayName: 'Arroz blanco', matchScore: 0.8 },
      ]),
      { restaurantName: 'La Esquina', category: 'latam', confidence: 0.8, menuCandidates: [] },
    ) as any,
    latencyMs: 200,
  });
  const a3 = await mkScan({
    status: 'LOGGED',
    confirmedAt: new Date(),
    detections: DET as any,
    proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.3)) as any,
  });
  const a4 = await mkScan({
    status: 'LOGGED',
    confirmedAt: new Date(),
    detections: DET as any,
    proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.7)) as any,
  });
  await mkScan({ status: 'FAILED', failureReason: 'VISION_PROVIDER_ERROR: boom' });
  await mkScan({ status: 'FALLBACK_MANUAL', failureReason: 'USER_CHOSE_MANUAL' });
  await mkScan({ status: 'REJECTED', proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.8)) as any });
  const a8 = await mkScan({
    status: 'LOGGED',
    source: 'BARCODE',
    confirmedAt: new Date(),
    proposal: { ...proposalOf(candidate(arroz.id, 'Arroz blanco', 0.9)), source: 'BARCODE' } as any,
  });
  await mkScan({
    status: 'REJECTED',
    source: 'LABEL_OCR',
    proposal: { ...proposalOf(candidate(arroz.id, 'Arroz blanco', 0.6)), source: 'LABEL_OCR' } as any,
  });

  // beta: 2 LOGGED photo scans, both accepted — good numbers, tiny sample
  const b1 = await mkScan({
    status: 'LOGGED',
    providerId: 'beta',
    confirmedAt: new Date(),
    detections: DET as any,
    proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.8)) as any,
  });
  const b2 = await mkScan({
    status: 'LOGGED',
    providerId: 'beta',
    confirmedAt: new Date(),
    detections: DET as any,
    proposal: proposalOf(candidate(pollo.id, 'Pollo a la plancha', 0.8)) as any,
  });

  const fb = (scanId: string, data: Record<string, unknown>) =>
    prisma.visionFeedback.create({ data: { scanId, userId: u1.id, detectionIndex: 0, ...data } as any });
  await fb(a1.id, {
    action: 'ACCEPTED',
    proposedFoodItemId: pollo.id,
    confirmedFoodItemId: pollo.id,
    proposedGrams: 100,
    confirmedGrams: 100,
    proposedMethod: 'PROVIDER_ESTIMATE',
  });
  await fb(a2.id, {
    action: 'SWAPPED',
    proposedFoodItemId: pollo.id,
    confirmedFoodItemId: arroz.id,
    proposedGrams: 100,
    confirmedGrams: 90,
  });
  await fb(a3.id, {
    action: 'EDITED_PORTION',
    proposedFoodItemId: pollo.id,
    confirmedFoodItemId: pollo.id,
    proposedGrams: 200,
    confirmedGrams: 100,
  });
  await fb(a4.id, {
    action: 'ACCEPTED',
    proposedFoodItemId: pollo.id,
    confirmedFoodItemId: pollo.id,
    proposedGrams: 150,
    confirmedGrams: 150,
  });
  await fb(a4.id, {
    action: 'ADDED_MANUAL',
    detectionIndex: -1,
    proposedFoodItemId: null,
    confirmedFoodItemId: arroz.id,
    proposedGrams: null,
    confirmedGrams: 50,
  });
  await fb(a8.id, {
    action: 'ACCEPTED',
    proposedFoodItemId: arroz.id,
    confirmedFoodItemId: arroz.id,
    proposedGrams: 85,
    confirmedGrams: 85,
  });
  await fb(b1.id, {
    action: 'ACCEPTED',
    proposedFoodItemId: pollo.id,
    confirmedFoodItemId: pollo.id,
    proposedGrams: 120,
    confirmedGrams: 120,
  });
  await fb(b2.id, {
    action: 'ACCEPTED',
    proposedFoodItemId: pollo.id,
    confirmedFoodItemId: pollo.id,
    proposedGrams: 120,
    confirmedGrams: 120,
  });

  // V3.6 — the trust audit: append-only, queryable, explainable.
  console.log('\n── V3.6: TRUST AUDIT (append-only; an auto-accept must stay explainable) ──');
  const audit = new TrustAuditService(prisma);
  const evidenceReader = new TrustEvidenceReader(prisma);
  const trustFor = (over: Partial<TrustEvidence>) => computeTrust(ev({ ...over }), 0.9, 0.9, NOW);
  await audit.record({
    scanId: a1.id,
    userId: u1.id,
    providerId: 'alpha',
    modality: 'PHOTO',
    foodItemId: pollo.id,
    reportedConfidence: 0.9,
    decision: decideAutoAccept({
      trust: trustFor({ confirmations: 5, lastConfirmedAt: daysAgo(0) }),
      modality: 'PHOTO',
      calibratedConfidence: 0.9,
      fallbackReason: null,
      candidateCount: 1,
      allCandidatesGraduated: true,
      enabled: false,
    }),
  });
  await audit.record({
    scanId: a2.id,
    userId: u1.id,
    providerId: 'alpha',
    modality: 'PHOTO',
    foodItemId: arroz.id,
    reportedConfidence: 0.5,
    decision: decideAutoAccept({
      trust: trustFor({ confirmations: 1, lastConfirmedAt: daysAgo(0) }),
      modality: 'PHOTO',
      calibratedConfidence: 0.9,
      fallbackReason: null,
      candidateCount: 1,
      allCandidatesGraduated: true,
      enabled: false,
    }),
  });

  const report = await audit.userTrustReport(u1.id);
  check(
    'graduated vs pending are separated per (food, modality)',
    report.graduated.length === 1 && report.pending.length === 1,
  );
  check(
    'the graduated entry keeps its evidence and reason',
    (report.graduated[0] as any).trustLevel === 'HIGH' && !!(report.graduated[0] as any).lastReason,
  );
  check(
    'shadow mode is visible: decided AUTO_ACCEPT, executed=false',
    (report.graduated[0] as any).executed === false &&
      report.statistics.autoAccepted === 1 &&
      report.statistics.actuallyExecuted === 0,
  );
  const auditRows = await audit.forScan(a1.id);
  check(
    'every persisted decision carries policy version, signals and reasons — explainable forever',
    auditRows[0].policyVersion === TRUST_POLICY_VERSION &&
      auditRows[0].signals.length > 0 &&
      auditRows[0].reasons.length > 0,
  );
  check(
    '…and the calibrated confidence it actually used',
    auditRows[0].calibratedConfidence === 0.9 && auditRows[0].reportedConfidence === 0.9,
  );
  const stats = await audit.statistics(30);
  check(
    'platform statistics count what WOULD have been auto-accepted (rollout signal)',
    stats.totalDecisions === 2 && stats.shadowOnly === 1 && stats.executed === 0,
  );
  check(
    '…broken down by action, level, modality and policy version',
    stats.byAction['AUTO_ACCEPT'] === 1 &&
      stats.byTrustLevel['HIGH'] === 1 &&
      stats.byModality['PHOTO'] === 2 &&
      stats.byPolicyVersion['1'] === 2,
  );

  console.log('\n── V3.6: TRUST EVIDENCE READER (read-only; the user is the only supervisor) ──');
  const polloEvidence = await evidenceReader.evidenceFor(u1.id, pollo.id, 'PHOTO');
  check(
    "reads the user's own confirmations of this food, from the V0 corpus",
    polloEvidence.confirmations === 4 && polloEvidence.corrections === 1,
    `${polloEvidence.confirmations}c/${polloEvidence.corrections}x`,
  );
  check(
    'trust is PROVIDER-INDEPENDENT: alpha and beta confirmations both count — the user trusts the FOOD, not the vendor (this is why a provider swap keeps the moat)',
    polloEvidence.confirmations === 4,
  );
  check('…and the user total, which separates NEW_USER from UNKNOWN_FOOD', polloEvidence.userTotalConfirmations === 5);
  check(
    'a restaurant photo is its own modality — home trust does not transfer',
    (await evidenceReader.evidenceFor(u1.id, arroz.id, 'RESTAURANT')).confirmations === 0,
  );
  check(
    'an unmatched (one-off) candidate can never accumulate trust',
    (await evidenceReader.evidenceFor(u1.id, null, 'PHOTO')).confirmations === 0,
  );
  check(
    'an unknown user reads as no evidence, never a crash',
    (await evidenceReader.evidenceFor('00000000-0000-0000-0000-000000000000', pollo.id, 'PHOTO')).confirmations === 0,
  );

  const countsBefore = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    foods: await prisma.foodItem.count(),
    meals: await prisma.loggedMeal.count(),
    trust: await prisma.visionTrustDecision.count(),
  };

  const win = { from: W_FROM, to: W_TO };

  console.log('\n── V3.5: LAYER 1 — GROUND TRUTH (the moat, counted) ──');
  const summary = await engine.summary(win);
  check(
    'summary counts every terminal scan and every labeled example',
    summary.totalScans === 11 && summary.totalExamples === 8,
  );
  check(
    'both providers visible, alphabetical',
    JSON.stringify(summary.providers) === JSON.stringify(['alpha', 'beta']),
  );
  check(
    'examples broken down by action',
    summary.examplesByAction['ACCEPTED'] === 5 &&
      summary.examplesByAction['SWAPPED'] === 1 &&
      summary.examplesByAction['EDITED_PORTION'] === 1 &&
      summary.examplesByAction['ADDED_MANUAL'] === 1,
  );
  check(
    'scans broken down by status and source',
    summary.scansByStatus['LOGGED'] === 7 &&
      summary.scansByStatus['REJECTED'] === 2 &&
      summary.scansBySource['BARCODE'] === 1 &&
      summary.scansBySource['LABEL_OCR'] === 1,
  );

  console.log('\n── V3.5: LAYER 2 — SCORECARD (every number hand-computed) ──');
  const card = await engine.scorecard('alpha', win);
  check('top-1 accuracy = 4/5 proposals held', card.top1Accuracy === 0.8, `${card.top1Accuracy}`);
  check('top-3 accuracy = 5/5 (the swap target was in alternates)', card.top3Accuracy === 1);
  check('recognition recall = 5/(5+1 manual addition)', card.recognitionRecall === 0.8333);
  check('recognition precision = 5 confirmed / 7 proposed candidates', card.recognitionPrecision === 0.7143);
  check('mean portion error = (0+0.1111+1+0+0)/5', card.meanPortionErrorPct === 0.2222, `${card.meanPortionErrorPct}`);
  check('median portion error = 0 (robust to the one wild miss)', card.medianPortionErrorPct === 0);
  check('manual correction rate = 2/5 (one swap + one portion edit)', card.manualCorrectionRate === 0.4);
  check(
    'fallback 1/9, reject 2/9, failure 1/9',
    card.fallbackRate === 0.1111 && card.rejectRate === 0.2222 && card.failureRate === 0.1111,
  );
  check('provider availability = 1 − provider-attributed failures', card.providerAvailability === 0.8889);
  check(
    'latency: mean 150, p50 150 — from telemetry the platform used to discard',
    card.meanLatencyMs === 150 && card.p50LatencyMs === 150,
  );
  check('cost proxy: 1200 tokens/scan over metered scans', card.meanTokensPerScan === 1200);
  check(
    'modality acceptance: barcode 1.0, OCR 0.0, restaurant-context 1.0 (proxies, named as such)',
    card.barcodeAcceptanceRate === 1 && card.ocrAcceptanceRate === 0 && card.restaurantContextAcceptanceRate === 1,
  );
  check(
    'sample sizes: 9 scans, 6 examples, 5 confirmed scans',
    card.sampleSizes.scans === 9 && card.sampleSizes.examples === 6 && card.sampleSizes.confirmedScans === 5,
  );

  console.log('\n── V3.5: BREAKDOWNS (which foods, users, cuisines, confidence ranges) ──');
  check(
    'per-food: pollo n=4 top1 0.75; arroz n=1 top1 1',
    card.perFood['Pollo a la plancha']?.n === 4 &&
      card.perFood['Pollo a la plancha']?.top1Accuracy === 0.75 &&
      card.perFood['Arroz blanco']?.top1Accuracy === 1,
  );
  check('per-user: all 5 proposals belong to the seeded user', card.perUser[u1.id]?.n === 5);
  check(
    'per-cuisine: the restaurant-context swap shows up under latam with top1 0',
    card.perCuisine['latam']?.n === 1 && card.perCuisine['latam']?.top1Accuracy === 0,
  );
  check(
    'per-confidence: HIGH n=3 top1 0.6667, MEDIUM n=1, LOW n=1',
    card.perConfidenceBand['HIGH']?.n === 3 &&
      card.perConfidenceBand['HIGH']?.top1Accuracy === 0.6667 &&
      card.perConfidenceBand['MEDIUM']?.n === 1 &&
      card.perConfidenceBand['LOW']?.n === 1,
  );
  check('per-source: PHOTO n=4, BARCODE n=1', card.perSource['PHOTO']?.n === 4 && card.perSource['BARCODE']?.n === 1);

  console.log('\n── V3.5: LAYER 3 — CALIBRATION (is a 0.9 really a 0.9?) ──');
  const calReport = await engine.calibration('alpha', win);
  const topBin = calReport.curve.bins[9];
  check(
    'the 0.9 bin holds 3 examples with empirical accuracy 0.6667',
    topBin.n === 3 && topBin.empiricalAccuracy === 0.6667 && topBin.meanReportedConfidence === 0.9,
  );
  check(
    'ECE = 0.34 (hand-computed over 5 examples)',
    calReport.expectedCalibrationError === 0.34,
    `${calReport.expectedCalibrationError}`,
  );
  check('not flagged overconfident (low-confidence bins over-delivered)', calReport.overconfident === false);
  check(
    'curve is versioned and declares its evidence',
    calReport.curve.contractVersion === EVAL_CONTRACT_VERSION && calReport.curve.builtFrom.examples === 5,
  );
  check(
    "the scorecard carries the calibration error (engine attaches Layer 3's output)",
    card.calibrationError === 0.34,
  );

  console.log('\n── V3.5: LAYER 4 — PROMOTION OVER REAL ROWS ──');
  const comparison = await engine.compare('alpha', 'beta', win);
  check(
    '9 vs 2 production scans -> INSUFFICIENT_DATA, incumbent holds',
    comparison.decision.verdict === 'INSUFFICIENT_DATA',
  );
  check(
    'the refusal names the missing evidence',
    comparison.decision.reasons.some((r) => r.includes('insufficient data')),
  );
  check(
    'comparison embeds both full scorecards',
    comparison.incumbent.providerId === 'alpha' &&
      comparison.challenger.providerId === 'beta' &&
      comparison.challenger.top1Accuracy === 1,
  );

  console.log('\n── V3.5: HISTORICAL REPLAY (read-only, measured determinism) ──');
  const replay = await engine.replay(win);
  check(
    'replays every photo scan with detections and feedback (both providers)',
    replay.scansReplayed === 6 && replay.examplesCompared === 6,
  );
  check('replay top-1 = 5/6 against ground truth', replay.top1Accuracy === 0.8333, `${replay.top1Accuracy}`);
  check(
    'replay median portion error = 0.375 (unpersonalized pipeline floor)',
    replay.medianPortionErrorPct === 0.375,
    `${replay.medianPortionErrorPct}`,
  );
  check('determinism MEASURED: two full passes, identical metrics', replay.deterministic === true);

  console.log('\n── V3.5: READ-ONLY GUARANTEE + DETERMINISM ──');
  const countsAfter = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    foods: await prisma.foodItem.count(),
    meals: await prisma.loggedMeal.count(),
    trust: await prisma.visionTrustDecision.count(),
  };
  check(
    'a FULL evaluation pass (summary+scorecard+calibration+comparison+replay) changed ZERO rows',
    JSON.stringify(countsBefore) === JSON.stringify(countsAfter),
    JSON.stringify(countsAfter),
  );
  const cardAgain = await engine.scorecard('alpha', win);
  check('same window, same data -> byte-identical scorecard', JSON.stringify(card) === JSON.stringify(cardAgain));
  check(
    'every report is contract-versioned',
    card.contractVersion === 1 &&
      calReport.curve.contractVersion === 1 &&
      comparison.contractVersion === 1 &&
      replay.contractVersion === 1,
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

  console.log(
    `\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Continuous Learning & Evaluation (V3.5)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
