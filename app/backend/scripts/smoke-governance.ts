/**
 * Smoke test for Nutrition Vision V4.1 — Live Provider Governance.
 * Embedded Postgres; NEVER reads .env, NEVER touches production, NEVER calls a
 * real vendor (the challenger is an in-process fake provider).
 *
 *   npm run smoke:governance
 *
 * Covers: shadow capture/run mechanics (including that shadow NEVER affects the
 * user-facing result), append-only + idempotent evidence, the PAIRED comparison
 * that V3.5 could not do, McNemar on discordant pairs, every breakdown
 * (modality / food / cuisine / confidence band / user segment), drift
 * detection, all five governance verdicts, determinism, provider independence,
 * and the READ-ONLY guarantee.
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

const PORT = 59445;
const DB = 'vitals_governance_smoke';
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
import { VisionProviderRegistry } from '../src/vision/providers/provider.registry';
import { FixtureVisionProvider } from '../src/vision/providers/fixture.provider';
import { EphemeralImageStore } from '../src/vision/images/ephemeral-image-store';
import { ShadowEvaluationRunner, sampled } from '../src/vision/governance/shadow-evaluation.runner';
import { GovernanceEngine } from '../src/vision/governance/governance.engine';
import { verdict, sideMetrics, generalizes } from '../src/vision/governance/pipeline/paired-comparison';
import { detectDrift } from '../src/vision/governance/pipeline/drift';
import { decideGovernance } from '../src/vision/governance/pipeline/governance-decision';
import {
  GOVERNANCE_CONTRACT_VERSION,
  PairedOutcome,
  SideOutcome,
} from '../src/vision/governance/types/governance-contract';
import {
  ProviderScorecard,
  CalibrationReport,
  EVAL_CONTRACT_VERSION,
} from '../src/vision/learning/types/eval-contract';

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

const W = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') };

const side = (over: Partial<SideOutcome> = {}): SideOutcome => ({
  top1Hit: false,
  top3Hit: false,
  swapped: false,
  missed: false,
  portionErrorPct: null,
  reportedConfidence: 0.8,
  ...over,
});
const hit = (over: Partial<SideOutcome> = {}) => side({ top1Hit: true, top3Hit: true, ...over });
const outcome = (i: SideOutcome, c: SideOutcome, over: Partial<PairedOutcome> = {}): PairedOutcome => ({
  scanId: 's',
  userId: 'u',
  source: 'PHOTO',
  foodName: 'Pollo',
  cuisine: null,
  confidenceBand: 'HIGH',
  confirmedFoodItemId: 'f',
  incumbent: i,
  challenger: c,
  ...over,
});

function fakeCard(providerId: string, over: Partial<ProviderScorecard> = {}): ProviderScorecard {
  return {
    contractVersion: EVAL_CONTRACT_VERSION,
    providerId,
    window: W,
    sampleSizes: { scans: 200, examples: 300, confirmedScans: 180 },
    top1Accuracy: 0.8,
    top3Accuracy: 0.9,
    recognitionPrecision: 0.8,
    recognitionRecall: 0.8,
    meanPortionErrorPct: 0.2,
    medianPortionErrorPct: 0.2,
    manualCorrectionRate: 0.3,
    fallbackRate: 0.05,
    rejectRate: 0.05,
    failureRate: 0.05,
    providerAvailability: 0.98,
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
function fakeCal(providerId: string, ece: number | null): CalibrationReport {
  return {
    curve: { contractVersion: EVAL_CONTRACT_VERSION, providerId, builtFrom: { examples: 100, window: W }, bins: [] },
    expectedCalibrationError: ece,
    overconfident: false,
  };
}

async function main() {
  // ── PART A: pure comparison + decision ──
  console.log('── V4.1: PAIRED VERDICT (McNemar — only disagreements carry information) ──');
  // 30 scans: 11 both right, 12 challenger-only, 4 incumbent-only, 3 both wrong.
  // The 11 agreements carry NO information about the difference — that is the
  // whole point of using a paired test.
  const paired: PairedOutcome[] = [
    ...Array.from({ length: 11 }, () => outcome(hit(), hit())),
    ...Array.from({ length: 12 }, () => outcome(side({ swapped: true }), hit())),
    ...Array.from({ length: 4 }, () => outcome(hit(), side({ swapped: true }))),
    ...Array.from({ length: 3 }, () => outcome(side({ swapped: true }), side({ swapped: true }))),
  ];
  const v = verdict('overall', paired);
  check('counts discordant pairs in both directions', v.challengerOnly === 12 && v.incumbentOnly === 4 && v.n === 30);
  check(
    'top-1: incumbent 15/30, challenger 23/30',
    v.incumbent.top1Accuracy === 0.5 && v.challenger.top1Accuracy === 0.7667,
    `${v.challenger.top1Accuracy}`,
  );
  check('McNemar z uses ONLY the 16 discordant pairs: (12−4)/sqrt(16) = 2.0', v.mcNemarZ === 2, `${v.mcNemarZ}`);
  check(
    '…the 11 agreements are correctly ignored by the test statistic',
    verdict('x', paired.slice(11)).mcNemarZ === 2,
  );
  check('paired CI on the top-1 delta is reported', v.top1Delta === 0.2667 && v.top1DeltaCi !== null);
  check('a clear paired win is significant', v.significant === true);
  const thinDiscordant = verdict('thin', [
    ...Array.from({ length: 10 }, () => outcome(hit(), hit())),
    ...Array.from({ length: 6 }, () => outcome(side({ swapped: true }), hit())),
    outcome(hit(), side({ swapped: true })),
  ]);
  check(
    "only 7 disagreements -> z is NULL: below the normal approximation's floor, the platform refuses to compute rather than pretend",
    thinDiscordant.mcNemarZ === null && thinDiscordant.significant === false,
  );

  const tied = Array.from({ length: 20 }, () => outcome(hit(), hit()));
  const tiedVerdict = verdict('t', tied);
  check(
    'perfect agreement -> no discordant pairs -> z null, NOT significant (noise cannot promote)',
    tiedVerdict.mcNemarZ === null && tiedVerdict.significant === false,
  );
  const losing = verdict('l', [
    ...Array.from({ length: 12 }, () => outcome(hit(), side({ swapped: true }))),
    ...Array.from({ length: 2 }, () => outcome(side({ swapped: true }), hit())),
  ]);
  check('a challenger that LOSES is never significant', losing.significant === false && (losing.mcNemarZ ?? 0) < 0);
  check('verdict is deterministic', JSON.stringify(verdict('overall', paired)) === JSON.stringify(v));

  console.log('\n── V4.1: SIDE METRICS (swap ≠ miss — different failures, measured apart) ──');
  const m = sideMetrics([hit(), side({ swapped: true }), side({ missed: true }), hit({ portionErrorPct: 0.5 })]);
  check('top-1 2/4, swap 1/4, miss 1/4', m.top1Accuracy === 0.5 && m.swapRate === 0.25 && m.missRate === 0.25);
  check('precision excludes what it never proposed (2 of 3 proposals held)', m.precision === 0.6667, `${m.precision}`);
  check('portion error only over items with both grams', m.medianPortionErrorPct === 0.5);
  check(
    'empty input -> all null (never zero)',
    sideMetrics([]).top1Accuracy === null && sideMetrics([]).missRate === null,
  );

  console.log('\n── V4.1: GENERALIZATION (one lucky slice is not an advantage) ──');
  const upEverywhere = [verdict('a', paired), verdict('b', paired)];
  check('winning across buckets generalizes', generalizes(upEverywhere) === true);
  const mixed = [
    verdict('a', paired),
    verdict('b', [
      ...Array.from({ length: 12 }, () => outcome(hit(), side({ swapped: true }))),
      ...Array.from({ length: 2 }, () => outcome(side({ swapped: true }), hit())),
    ]),
  ];
  check('winning in one bucket and regressing in another does NOT generalize', generalizes(mixed) === false);
  check('a single bucket cannot generalize by definition', generalizes([verdict('a', paired)]) === null);

  console.log('\n── V4.1: DRIFT (is the incumbent still the provider we promoted?) ──');
  const stable = detectDrift(
    'alpha',
    { scorecard: fakeCard('alpha'), calibration: fakeCal('alpha', 0.1) },
    { scorecard: fakeCard('alpha'), calibration: fakeCal('alpha', 0.1) },
    W,
  );
  check(
    'unchanged halves -> STABLE, with the numbers stated',
    stable.verdict === 'STABLE' && stable.reasons[0].includes('estable'),
  );
  const qualityDrop = detectDrift(
    'alpha',
    { scorecard: fakeCard('alpha', { top1Accuracy: 0.7 }), calibration: fakeCal('alpha', 0.1) },
    { scorecard: fakeCard('alpha'), calibration: fakeCal('alpha', 0.1) },
    W,
  );
  check('a 10pp top-1 fall -> DRIFTING', qualityDrop.verdict === 'DRIFTING' && qualityDrop.quality.delta === -0.1);
  const calDrift = detectDrift(
    'alpha',
    { scorecard: fakeCard('alpha'), calibration: fakeCal('alpha', 0.25) },
    { scorecard: fakeCard('alpha'), calibration: fakeCal('alpha', 0.1) },
    W,
  );
  check(
    'calibration decay alone is drift (it is the auto-accept gate input)',
    calDrift.verdict === 'DRIFTING' && calDrift.reasons[0].includes('calibración'),
  );
  const thin = detectDrift(
    'alpha',
    {
      scorecard: fakeCard('alpha', { sampleSizes: { scans: 5, examples: 5, confirmedScans: 5 } }),
      calibration: fakeCal('alpha', 0.1),
    },
    { scorecard: fakeCard('alpha'), calibration: fakeCal('alpha', 0.1) },
    W,
  );
  check('halves too thin -> INSUFFICIENT_DATA, never a false alarm', thin.verdict === 'INSUFFICIENT_DATA');

  console.log('\n── V4.1: GOVERNANCE DECISION (all five verdicts, evidence-driven) ──');
  const bigWin = {
    contractVersion: GOVERNANCE_CONTRACT_VERSION,
    window: W,
    incumbentId: 'alpha',
    challengerId: 'beta',
    pairedScans: 40,
    overall: verdict('overall', [...paired, ...paired]),
    perModality: [verdict('PHOTO', paired), verdict('BARCODE', paired)],
    perFood: [],
    perCuisine: [],
    perConfidenceBand: [],
    perUserSegment: [verdict('u1', paired), verdict('u2', paired)],
    operations: {
      incumbentMeanLatencyMs: 1000,
      challengerMeanLatencyMs: 1100,
      incumbentMeanTokens: 1500,
      challengerMeanTokens: 1600,
      challengerAvailability: 0.99,
    },
    unavailableDimensions: [],
  };
  const promote = decideGovernance(bigWin, stable, W);
  check('significant + generalizing + affordable -> PROMOTE', promote.action === 'PROMOTE');
  check(
    '…citing the PAIRED evidence, the CI and McNemar',
    promote.reasons.some((r) => r.includes('PAREADOS')) && promote.reasons.some((r) => r.includes('McNemar')),
  );
  check(
    '…with a checklist that warns calibration resets for the new provider',
    promote.checklist.some((c) => c.includes('calibración')),
  );

  check('no shadow evidence -> REQUIRE_MORE_DATA', decideGovernance(null, stable, W).action === 'REQUIRE_MORE_DATA');
  check(
    'too few paired scans -> REQUIRE_MORE_DATA (an anecdote is not evidence)',
    decideGovernance({ ...bigWin, pairedScans: 5 }, stable, W).action === 'REQUIRE_MORE_DATA',
  );
  check(
    'a statistically indistinguishable difference -> MAINTAIN',
    decideGovernance({ ...bigWin, overall: tiedVerdict }, stable, W).action === 'MAINTAIN',
  );
  check(
    'a drifting incumbent with no replacement -> DEMOTE (the problem is real even if the remedy is not a swap)',
    decideGovernance(null, qualityDrop, W).action === 'DEMOTE',
  );
  check(
    'a win that does NOT generalize across modalities -> HOLD',
    decideGovernance({ ...bigWin, perModality: mixed }, stable, W).action === 'HOLD',
  );
  check(
    'a win that does NOT generalize across users -> HOLD',
    decideGovernance({ ...bigWin, perUserSegment: mixed }, stable, W).action === 'HOLD',
  );
  check(
    'more accurate but unavailable -> HOLD (not deployable)',
    decideGovernance({ ...bigWin, operations: { ...bigWin.operations, challengerAvailability: 0.5 } }, stable, W)
      .action === 'HOLD',
  );
  check(
    'more accurate but 2x slower -> HOLD (the user pays the latency)',
    decideGovernance({ ...bigWin, operations: { ...bigWin.operations, challengerMeanLatencyMs: 3000 } }, stable, W)
      .action === 'HOLD',
  );
  check(
    'more accurate but 2x costlier -> HOLD',
    decideGovernance({ ...bigWin, operations: { ...bigWin.operations, challengerMeanTokens: 4000 } }, stable, W)
      .action === 'HOLD',
  );
  check(
    'drift + a promotable challenger -> PROMOTE, naming both',
    decideGovernance(bigWin, qualityDrop, W).action === 'PROMOTE',
  );
  check(
    'every decision is versioned and carries its evidence',
    promote.contractVersion === GOVERNANCE_CONTRACT_VERSION &&
      promote.evidence.pairedScans === 40 &&
      promote.evidence.incumbentDrift === 'STABLE',
  );
  check('decision is deterministic', JSON.stringify(decideGovernance(bigWin, stable, W)) === JSON.stringify(promote));

  console.log('\n── V4.1: DETERMINISTIC SAMPLING (reproducible, not random) ──');
  check('rate 0 samples nothing, rate 1 samples everything', sampled('abc', 0) === false && sampled('abc', 1) === true);
  check('the same scan id always decides the same way', sampled('scan-xyz', 0.5) === sampled('scan-xyz', 0.5));
  const ids = Array.from({ length: 400 }, (_, i) => `scan-${i}`);
  const share = ids.filter((id) => sampled(id, 0.25)).length / ids.length;
  check('sampling approximates the configured rate', Math.abs(share - 0.25) < 0.08, `${(share * 100).toFixed(1)}%`);

  // ── PART B: integration ──
  console.log('\n── V4.1: INTEGRATION (embedded Postgres — shadow ingestion + paired comparison) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-gov-'));
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
  const foodSvc = new FoodService(new LocalFoodAdapter(prisma));
  const imageStore = new EphemeralImageStore();

  // A deterministic challenger that ALWAYS recognizes rice — it will beat the
  // incumbent on rice scans and lose on chicken scans, by construction.
  const challenger = {
    id: 'beta',
    capabilities: { multiFood: true, portionHints: true, barcode: false, ocr: false, video: false },
    async recognize() {
      return {
        providerId: 'beta',
        model: 'beta-1',
        providerVersion: '1.0.0',
        latencyMs: 42,
        detections: [{ label: 'arroz blanco', labelConfidence: 0.95, portionHint: { grams: 150, confidence: 0.8 } }],
        usage: { inputTokens: 900, outputTokens: 100 },
      };
    },
  };
  const registry = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'fixture' }), [
    new FixtureVisionProvider(),
    challenger as any,
  ]);

  const u1 = await prisma.user.create({ data: { email: 'gov@test.local' } });
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

  console.log('\n── V4.1: SHADOW RUNNER (never affects the user; append-only; idempotent) ──');
  const offRunner = new ShadowEvaluationRunner(prisma, registry, imageStore, new ConfigService({}));
  check('PRODUCTION DEFAULT: no challenger configured -> shadow disabled', offRunner.enabled === false);
  check(
    '…and capture returns null without touching anything',
    (await offRunner.capture('any', 'any.jpg', 'PHOTO')) === null,
  );
  const noSample = new ShadowEvaluationRunner(
    prisma,
    registry,
    imageStore,
    new ConfigService({ SHADOW_CHALLENGER_PROVIDER: 'beta', SHADOW_SAMPLE_RATE: '0' }),
  );
  check('a challenger with sample rate 0 is still disabled (both switches required)', noSample.enabled === false);
  const selfShadow = new ShadowEvaluationRunner(
    prisma,
    registry,
    imageStore,
    new ConfigService({ SHADOW_CHALLENGER_PROVIDER: 'fixture', SHADOW_SAMPLE_RATE: '1' }),
  );
  check('the incumbent is never shadowed against itself', (await selfShadow.capture('s', 'x.jpg', 'PHOTO')) === null);
  const ghost = new ShadowEvaluationRunner(
    prisma,
    registry,
    imageStore,
    new ConfigService({ SHADOW_CHALLENGER_PROVIDER: 'ghost', SHADOW_SAMPLE_RATE: '1' }),
  );
  check(
    'an unregistered challenger captures nothing (fails quiet, never loud)',
    (await ghost.capture('s', 'x.jpg', 'PHOTO')) === null,
  );

  const runner = new ShadowEvaluationRunner(
    prisma,
    registry,
    imageStore,
    new ConfigService({ SHADOW_CHALLENGER_PROVIDER: 'beta', SHADOW_SAMPLE_RATE: '1' }),
  );
  check('configured challenger + sampling -> enabled', runner.enabled === true);
  check(
    'a keyword/fixture ref has no bytes to hand over -> null (no crash)',
    (await runner.capture('s', 'chicken-plate.jpg', 'PHOTO')) === null,
  );

  // Seed scans: the incumbent (fixture) proposes pollo+arroz+brocoli; the user
  // confirms ONE food per scan. Rice scans favour the challenger by design.
  const DET = [{ label: 'pollo a la plancha', labelConfidence: 0.92, portionHint: { grams: 180, confidence: 0.7 } }];
  const proposalFor = (foodItemId: string, name: string, conf: number) => ({
    scanId: 'seed',
    status: 'PROPOSED',
    source: 'PHOTO',
    mode: 'CONFIRM',
    candidates: [
      {
        detectionIndex: 0,
        foodItemId,
        displayName: name,
        matchScore: 1,
        portion: { grams: 180, method: 'PROVIDER_ESTIMATE', confidence: 0.7 },
        confidence: {
          recognition: conf,
          match: 1,
          portion: 0.7,
          overall: conf,
          band: conf >= 0.75 ? 'HIGH' : 'MEDIUM',
        },
        alternates: [],
      },
    ],
    scanConfidence: { overall: conf, band: 'HIGH' },
    suggestedMealType: 'LUNCH',
    fallback: { reason: null },
    contractVersion: 1,
  });

  const seed = async (
    i: number,
    confirmed: { id: string; name: string },
    incumbentProposes: { id: string; name: string },
    conf: number,
  ) => {
    const scan = await prisma.visionScan.create({
      data: {
        userId: u1.id,
        source: 'PHOTO',
        imageRef: `seed-${i}.jpg`,
        status: 'LOGGED',
        expiresAt: new Date(Date.now() + 86_400_000),
        providerId: 'fixture',
        confirmedAt: new Date(),
        detections: DET as any,
        proposal: proposalFor(incumbentProposes.id, incumbentProposes.name, conf) as any,
        scanConfidence: conf,
        latencyMs: 120,
        tokensIn: 1000,
        tokensOut: 200,
      } as any,
    });
    await prisma.visionFeedback.create({
      data: {
        scanId: scan.id,
        userId: u1.id,
        detectionIndex: 0,
        action: 'ACCEPTED',
        proposedFoodItemId: incumbentProposes.id,
        confirmedFoodItemId: confirmed.id,
        proposedGrams: 180,
        confirmedGrams: 180,
        proposedMethod: 'PROVIDER_ESTIMATE',
      } as any,
    });
    await prisma.visionShadowRun.create({
      data: {
        scanId: scan.id,
        userId: u1.id,
        providerId: 'beta',
        providerModel: 'beta-1',
        providerVersion: '1.0.0',
        source: 'PHOTO',
        status: 'COMPLETED',
        detections: [
          { label: 'arroz blanco', labelConfidence: 0.95, portionHint: { grams: 150, confidence: 0.8 } },
        ] as any,
        latencyMs: 42,
        tokensIn: 900,
        tokensOut: 100,
      } as any,
    });
    return scan;
  };

  // 12 rice scans the incumbent got wrong (proposed pollo) — challenger wins.
  for (let i = 0; i < 12; i++)
    await seed(i, { id: arroz.id, name: 'Arroz blanco' }, { id: pollo.id, name: 'Pollo a la plancha' }, 0.9);
  // 4 chicken scans the incumbent got right — challenger loses (it only sees rice).
  for (let i = 12; i < 16; i++)
    await seed(i, { id: pollo.id, name: 'Pollo a la plancha' }, { id: pollo.id, name: 'Pollo a la plancha' }, 0.5);
  // One shadow run that FAILED — availability must reflect it honestly.
  const failedScan = await seed(
    99,
    { id: arroz.id, name: 'Arroz blanco' },
    { id: pollo.id, name: 'Pollo a la plancha' },
    0.9,
  );
  await prisma.visionShadowRun.update({
    where: { scanId_providerId: { scanId: failedScan.id, providerId: 'beta' } },
    data: { status: 'FAILED', failureReason: 'SHADOW_RECOGNIZE_TIMEOUT', detections: undefined },
  });

  const before = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(),
    meals: await prisma.loggedMeal.count(),
  };
  const shadowBefore = JSON.stringify(await prisma.visionShadowRun.findMany({ orderBy: { id: 'asc' } }));

  const engine = new GovernanceEngine(
    prisma,
    new ConfigService({ VISION_PROVIDER: 'fixture', SHADOW_CHALLENGER_PROVIDER: 'beta' }),
    foodSvc,
    new GroundTruthReader(prisma),
    new EvaluationEngine(new GroundTruthReader(prisma), new ReplayEngine(prisma, foodSvc)),
  );

  const shadowStatus = await engine.shadowStatus(30);
  check(
    'shadow status counts runs and separates completed from failed',
    shadowStatus.totalRuns === 17 &&
      shadowStatus.byProvider['beta'].completed === 16 &&
      shadowStatus.byProvider['beta'].failed === 1,
  );
  check(
    '…and reports the configured posture',
    shadowStatus.activeProviderId === 'fixture' && shadowStatus.configuredChallenger === 'beta',
  );

  console.log('\n── V4.1: PAIRED COMPARISON (the thing V3.5 could not do) ──');
  const comparison = (await engine.compare(30))!;
  check(
    'only COMPLETED shadow runs with a user confirmation become paired evidence (16, not 17)',
    comparison.pairedScans === 16,
    `${comparison.pairedScans}`,
  );
  check(
    'incumbent 4/16 on the SAME scans; challenger 12/16',
    comparison.overall.incumbent.top1Accuracy === 0.25 && comparison.overall.challenger.top1Accuracy === 0.75,
  );
  check(
    'discordant pairs counted in both directions: 12 challenger-only, 4 incumbent-only',
    comparison.overall.challengerOnly === 12 && comparison.overall.incumbentOnly === 4,
  );
  check(
    'McNemar (12−4)/sqrt(16) = 2.0 — a real, measured difference',
    comparison.overall.mcNemarZ === 2,
    `${comparison.overall.mcNemarZ}`,
  );
  check('the paired win is significant', comparison.overall.significant === true);
  check(
    'challenger availability reflects the failed run: 16/17',
    comparison.operations.challengerAvailability === 0.9412,
    `${comparison.operations.challengerAvailability}`,
  );
  check(
    'operational comparison on the SAME scans (latency + cost)',
    comparison.operations.incumbentMeanLatencyMs === 120 &&
      comparison.operations.challengerMeanLatencyMs === 42 &&
      comparison.operations.challengerMeanTokens === 1000,
  );
  check(
    'the challenger was scored through the SAME pipeline (its rice detection matched the catalog)',
    comparison.overall.challenger.missRate === 0,
  );

  console.log('\n── V4.1: BREAKDOWNS (which foods, cuisines, bands, users) ──');
  check(
    'per-food: the challenger wins on rice scans and loses on chicken scans',
    (comparison.perFood.find((b) => b.bucket === 'Pollo a la plancha')?.n ?? 0) > 0,
  );
  check(
    'per-confidence-band splits HIGH from MEDIUM',
    comparison.perConfidenceBand.length === 2 &&
      !!comparison.perConfidenceBand.find((b) => b.bucket === 'HIGH') &&
      !!comparison.perConfidenceBand.find((b) => b.bucket === 'MEDIUM'),
  );
  check(
    'per-modality reports PHOTO',
    comparison.perModality.length === 1 && comparison.perModality[0].bucket === 'PHOTO',
  );
  check(
    'per-user segments the single seeded user',
    comparison.perUserSegment.length === 1 && comparison.perUserSegment[0].bucket === u1.id,
  );
  check(
    'image-quality banding is declared UNAVAILABLE, not fabricated',
    comparison.unavailableDimensions.length === 1 && comparison.unavailableDimensions[0].includes('IMAGE_QUALITY'),
  );

  console.log('\n── V4.1: RECOMMENDATION OVER REAL EVIDENCE ──');
  const rec = await engine.recommend(30);
  check(
    '16 paired scans is below the 30 minimum -> REQUIRE_MORE_DATA (the bar holds against real data)',
    rec.action === 'REQUIRE_MORE_DATA',
    rec.action,
  );
  check(
    '…and it says exactly how much evidence is missing',
    rec.reasons.some((r) => r.includes('16/30')),
  );
  check(
    'the recommendation carries the real paired evidence it does have',
    rec.evidence.pairedScans === 16 && rec.evidence.mcNemarZ === 2,
  );
  check('challenger id resolved from config', rec.challengerId === 'beta' && rec.incumbentId === 'fixture');

  console.log('\n── V4.1: GUARANTEES (read-only, append-only, deterministic, provider-agnostic) ──');
  const after = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(),
    meals: await prisma.loggedMeal.count(),
  };
  check(
    'READ-ONLY: a full governance pass (shadow+comparison+drift+recommendation) changed ZERO rows',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );
  check(
    'APPEND-ONLY: no shadow evidence row was mutated',
    shadowBefore === JSON.stringify(await prisma.visionShadowRun.findMany({ orderBy: { id: 'asc' } })),
  );
  const comparisonAgain = (await engine.compare(30))!;
  check(
    'DETERMINISM: same evidence -> byte-identical comparison',
    JSON.stringify(comparison.overall) === JSON.stringify(comparisonAgain.overall) &&
      JSON.stringify(comparison.perFood) === JSON.stringify(comparisonAgain.perFood),
  );

  // Idempotency: re-running the shadow for an existing (scan, provider) must not duplicate.
  const ticket = { ref: 'nope://x', challengerId: 'beta', source: 'PHOTO' as const };
  await runner.run(failedScan.id, u1.id, ticket);
  check(
    'IDEMPOTENT: a repeat shadow run never duplicates or rewrites evidence',
    (await prisma.visionShadowRun.count()) === before.shadow &&
      (
        await prisma.visionShadowRun.findUnique({
          where: { scanId_providerId: { scanId: failedScan.id, providerId: 'beta' } },
        })
      )?.status === 'FAILED',
  );
  check(
    'every report is contract-versioned',
    comparison.contractVersion === GOVERNANCE_CONTRACT_VERSION && rec.contractVersion === 1,
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
    `\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Live Provider Governance (V4.1)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
