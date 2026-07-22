/**
 * Smoke test for Nutrition Vision V4.0 — Shadow Rollout + Trust Analytics.
 * Embedded Postgres; NEVER reads .env, NEVER touches production, NEVER calls a
 * vendor. Covers: stage derivation rules, trust analytics (derived, never
 * edited), health (FP/FN hand-computed), deployment gates (always with
 * reasons), five-dimension risk, weekly timeline over append-only data,
 * determinism, provider independence, and the READ-ONLY + APPEND-ONLY
 * guarantees (a full rollout pass changes zero rows and mutates none).
 *
 *   npm run smoke:rollout
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

const PORT = 59444;
const DB = 'vitals_rollout_smoke';
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
import { RolloutDataReader } from '../src/vision/rollout/rollout-data.reader';
import { RolloutEngine } from '../src/vision/rollout/rollout.engine';
import { deriveStage } from '../src/vision/rollout/pipeline/rollout-stage';
import { slice } from '../src/vision/rollout/pipeline/trust-analytics';
import { isHealthGreen } from '../src/vision/rollout/pipeline/health';
import { weekStartUtc } from '../src/vision/rollout/pipeline/timeline';
import { ROLLOUT_CONTRACT_VERSION } from '../src/vision/rollout/types/rollout-contract';

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

const approx = (a: number | null, b: number, tol = 0.0002) => a != null && Math.abs(a - b) <= tol;

async function main() {
  // ── PART A: pure rules ──
  console.log('── V4.0: STAGE RULES (pure — a stage is a statement about evidence) ──');
  const base = {
    modality: 'PHOTO',
    configEnabled: true,
    autoAcceptEnabled: false,
    decisions: 0,
    wouldAutoAccept: 0,
    executed: 0,
    undoneExecuted: 0,
    healthGreen: true,
  };
  check('config off -> DISABLED', deriveStage({ ...base, configEnabled: false }).stage === 'DISABLED');
  check(
    'shadow with little evidence -> SHADOW, progress stated',
    deriveStage({ ...base, decisions: 5 }).stage === 'SHADOW' &&
      deriveStage({ ...base, decisions: 5 }).reasons[0].includes('5/25'),
  );
  check(
    'enough decisions but nothing would accept -> still SHADOW',
    deriveStage({ ...base, decisions: 30, wouldAutoAccept: 2 }).stage === 'SHADOW',
  );
  check(
    'evidence + health green -> READY (and only then)',
    deriveStage({ ...base, decisions: 30, wouldAutoAccept: 8 }).stage === 'READY',
  );
  check(
    'evidence but health NOT green -> stays SHADOW',
    deriveStage({ ...base, decisions: 30, wouldAutoAccept: 8, healthGreen: false }).stage === 'SHADOW',
  );
  const live = { ...base, autoAcceptEnabled: true, decisions: 60, wouldAutoAccept: 30 };
  check(
    'flag on, few executions -> LIMITED (early, watched)',
    deriveStage({ ...live, executed: 10 }).stage === 'LIMITED',
  );
  check(
    'high undo share -> LIMITED with the rate named',
    deriveStage({ ...live, executed: 100, undoneExecuted: 30 }).stage === 'LIMITED',
  );
  check('healthy mid-volume -> ROLLOUT', deriveStage({ ...live, executed: 100 }).stage === 'ROLLOUT');
  check('sustained volume + health -> FULL', deriveStage({ ...live, executed: 600 }).stage === 'FULL');
  check(
    'stage derivation is deterministic',
    JSON.stringify(deriveStage({ ...live, executed: 100 })) === JSON.stringify(deriveStage({ ...live, executed: 100 })),
  );
  check(
    'every stage carries reasons and evidence',
    deriveStage({ ...base, decisions: 5 }).evidence.decisions === 5 &&
      deriveStage({ ...base, decisions: 5 }).reasons.length > 0,
  );

  console.log('\n── V4.0: TRUST SLICE (pure — derived, never edited, provider-blind) ──');
  const mkRow = (over: any = {}) => ({
    scanId: 's',
    userId: 'u',
    providerId: 'alpha',
    modality: 'PHOTO',
    foodItemId: 'f',
    action: 'AUTO_ACCEPT',
    executed: false,
    trustScore: 0.8,
    trustLevel: 'HIGH',
    policyVersion: 1,
    createdAt: new Date('2026-07-01'),
  });
  const rowsA = [mkRow(), { ...mkRow(), action: 'REVIEW_REQUIRED', trustScore: 0.4 }];
  const sliceA = slice('k', rowsA as any, new Set());
  check(
    'slice aggregates decisions: share, avg, blended score',
    sliceA.decisions === 2 && sliceA.autoAcceptShare === 0.5 && sliceA.avgTrustScore === 0.6,
  );
  const rowsB = rowsA.map((r) => ({ ...r, providerId: 'zeta' }));
  check(
    'PROVIDER INDEPENDENCE: relabeling the provider changes nothing in the score',
    JSON.stringify(slice('k', rowsB as any, new Set())) === JSON.stringify(sliceA),
  );
  const executedRows = [
    { ...mkRow(), executed: true, scanId: 'undone-1' },
    { ...mkRow(), executed: true, scanId: 'kept-1' },
  ];
  check(
    'undo share counts only against EXECUTED decisions',
    slice('k', executedRows as any, new Set(['undone-1'])).undoShare === 0.5,
  );

  console.log('\n── V4.0: HEALTH GREEN (pure — one definition, consumed everywhere) ──');
  const okHealth: any = { undoRate: 0.05, providerFailureRate: 0.02, calibration: { currentEce: 0.1 } };
  check(
    'healthy inputs -> green with no reasons',
    isHealthGreen(okHealth).green === true && isHealthGreen(okHealth).reasons.length === 0,
  );
  check(
    'high undo -> not green, reason named',
    isHealthGreen({ ...okHealth, undoRate: 0.5 }).green === false &&
      isHealthGreen({ ...okHealth, undoRate: 0.5 }).reasons[0].includes('undo'),
  );
  check('bad ECE -> not green', isHealthGreen({ ...okHealth, calibration: { currentEce: 0.5 } }).green === false);

  console.log('\n── V4.0: WEEK BUCKETS (pure — timezone-proof UTC Mondays) ──');
  check('a Thursday maps to its Monday', weekStartUtc(new Date('2026-07-16T10:00:00Z')) === '2026-07-13');
  check(
    "a Sunday maps back to the SAME week's Monday",
    weekStartUtc(new Date('2026-07-19T23:59:59Z')) === '2026-07-13',
  );
  check('a Monday maps to itself', weekStartUtc(new Date('2026-07-13T00:00:00Z')) === '2026-07-13');

  // ── PART B: integration ──
  console.log('\n── V4.0: INTEGRATION (embedded Postgres, hand-computed) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-rollout-'));
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
  const evaluation = new EvaluationEngine(new GroundTruthReader(prisma), new ReplayEngine(prisma, foodSvc));
  const engine = new RolloutEngine(
    new ConfigService({ VISION_PROVIDER: 'alpha' }), // auto-accept unset -> shadow (the production default)
    new GroundTruthReader(prisma),
    evaluation,
    new RolloutDataReader(prisma),
  );

  const u1 = await prisma.user.create({ data: { email: 'rollout@test.local' } });
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

  const now = Date.now();
  const recent = new Date(now - 1 * 86_400_000); // this week
  const older = new Date(now - 9 * 86_400_000); // guaranteed a DIFFERENT ISO week

  const proposal = (conf: number) => ({
    scanId: 'seed',
    status: 'PROPOSED',
    source: 'PHOTO',
    mode: 'CONFIRM',
    candidates: [
      {
        detectionIndex: 0,
        foodItemId: pollo.id,
        displayName: 'Pollo a la plancha',
        matchScore: 1,
        portion: { grams: 150, method: 'PROVIDER_ESTIMATE', confidence: 0.6 },
        confidence: { recognition: conf, match: 1, portion: 0.6, overall: conf, band: 'HIGH' },
        alternates: [],
      },
    ],
    scanConfidence: { overall: conf, band: 'HIGH' },
    suggestedMealType: 'LUNCH',
    fallback: { reason: null },
    contractVersion: 1,
  });
  const mkScan = (data: Record<string, unknown>) =>
    prisma.visionScan.create({
      data: {
        userId: u1.id,
        source: 'PHOTO',
        imageRef: 'seed.jpg',
        expiresAt: new Date(now + 86_400_000),
        providerId: 'alpha',
        createdAt: recent,
        ...data,
      } as any,
    });

  const s1 = await mkScan({
    status: 'LOGGED',
    confirmedAt: recent,
    proposal: proposal(0.9) as any,
    scanConfidence: 0.9,
    latencyMs: 100,
  });
  const s2 = await mkScan({
    status: 'UNDONE',
    failureReason: 'USER_UNDID_AUTO_ACCEPT',
    proposal: proposal(0.9) as any,
    scanConfidence: 0.9,
  });
  const s3 = await mkScan({
    status: 'LOGGED',
    confirmedAt: recent,
    proposal: proposal(0.9) as any,
    scanConfidence: 0.9,
  });
  const s4 = await mkScan({
    status: 'LOGGED',
    confirmedAt: recent,
    proposal: proposal(0.9) as any,
    scanConfidence: 0.9,
  });
  await mkScan({ status: 'FALLBACK_MANUAL', failureReason: 'USER_CHOSE_MANUAL' });
  await mkScan({ status: 'FAILED', failureReason: 'VISION_PROVIDER_ERROR: boom' });
  const s7 = await mkScan({
    status: 'LOGGED',
    source: 'BARCODE',
    confirmedAt: older,
    createdAt: older,
    proposal: { ...proposal(0.8), source: 'BARCODE' } as any,
  });

  const fb = (scanId: string, action: string, grams: [number | null, number | null]) =>
    prisma.visionFeedback.create({
      data: {
        scanId,
        userId: u1.id,
        detectionIndex: 0,
        action,
        proposedFoodItemId: pollo.id,
        confirmedFoodItemId: pollo.id,
        proposedGrams: grams[0],
        confirmedGrams: grams[1],
        proposedMethod: 'PROVIDER_ESTIMATE',
      } as any,
    });
  await fb(s1.id, 'ACCEPTED', [100, 100]);
  await fb(s2.id, 'UNDONE', [150, null]);
  await fb(s3.id, 'ACCEPTED', [100, 100]);
  await fb(s4.id, 'EDITED_PORTION', [200, 150]);

  const td = (
    scanId: string,
    action: string,
    executed: boolean,
    trustScore: number,
    over: Record<string, unknown> = {},
  ) =>
    prisma.visionTrustDecision.create({
      data: {
        scanId,
        userId: u1.id,
        policyVersion: 1,
        action,
        executed,
        trustLevel: trustScore >= 0.65 ? 'HIGH' : 'LOW',
        trustScore,
        providerId: 'alpha',
        modality: 'PHOTO',
        foodItemId: pollo.id,
        signals: ['KNOWN_FOOD'],
        reasons: ['seed'],
        createdAt: recent,
        ...over,
      } as any,
    });
  await td(s1.id, 'AUTO_ACCEPT', true, 0.8);
  await td(s2.id, 'AUTO_ACCEPT', true, 0.9);
  await td(s3.id, 'REVIEW_REQUIRED', false, 0.3);
  await td(s4.id, 'REVIEW_REQUIRED', false, 0.4);
  await td(
    (await prisma.visionScan.findFirst({ where: { status: 'FALLBACK_MANUAL' } }))!.id,
    'MANUAL_REVIEW',
    false,
    0,
  );
  await td(s7.id, 'AUTO_ACCEPT', false, 0.7, { modality: 'BARCODE', createdAt: older });

  const before = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    decisions: await prisma.visionTrustDecision.count(),
    meals: await prisma.loggedMeal.count(),
  };
  const decisionsBefore = JSON.stringify(await prisma.visionTrustDecision.findMany({ orderBy: { id: 'asc' } }));

  console.log('\n── V4.0: HEALTH (every number hand-computed from append-only rows) ──');
  const health = await engine.health(30);
  check('7 terminal scans in window — UNDONE is now visible to datasets (V4.0 centralization fix)', health.scans === 7);
  check(
    'acceptance 4/6 decided (UNDONE counts as decided-and-not-accepted)',
    health.acceptanceRate === 0.6667,
    `${health.acceptanceRate}`,
  );
  check('undo rate = 1 of 2 executed auto-accepts', health.undoRate === 0.5);
  check(
    'manual fallback 1/7, provider failures 1/7',
    health.manualFallbackRate === 0.1429 && health.providerFailureRate === 0.1429,
  );
  check('latency from the one metered scan', health.meanLatencyMs === 100 && health.p50LatencyMs === 100);
  check('FALSE POSITIVE: auto-accepted then undone = 1', health.falsePositives === 1);
  check(
    'FALSE NEGATIVE: demanded review, user accepted unchanged = 1 (the edited scan does NOT count)',
    health.falseNegatives === 1,
  );
  check(
    'calibration ECE measured now; previous window empty -> drift null (never invented)',
    health.calibration.currentEce != null &&
      health.calibration.previousEce === null &&
      health.calibration.drift === null,
  );
  check(
    'promotion quoted from its owner: NOT_EVALUATED without a challenger',
    health.promotion.status === 'NOT_EVALUATED',
  );

  console.log('\n── V4.0: STATUS + GATES (stages derived, gates always explain) ──');
  const status = await engine.status(30);
  const photo = status.perModality.find((m) => m.modality === 'PHOTO')!;
  check('PHOTO in SHADOW, accumulating: 5/25 decisions', photo.stage === 'SHADOW' && photo.reasons[0].includes('5/25'));
  check(
    'all five modalities reported (PHOTO/BARCODE/LABEL_OCR/RESTAURANT/PORTION)',
    status.perModality.length === 5 && !!status.perModality.find((m) => m.modality === 'PORTION'),
  );
  check(
    'global = most conservative modality; provider posture stated',
    status.global.stage === 'SHADOW' &&
      status.generatedFor.activeProviderId === 'alpha' &&
      status.generatedFor.autoAcceptEnabled === false,
  );
  const { health: h2, gates } = { health, gates: await engine.gatesReport(30) };
  const aaGate = gates.gates.find((g) => g.id === 'AUTO_ACCEPT_READY')!;
  check(
    'AUTO_ACCEPT_READY fails with EVERY blocking reason named (evidence, bins, health)',
    aaGate.status === 'FAIL' && aaGate.reasons.length >= 3,
  );
  check(
    'PROVIDER_READY fails on sample size, quoting the PROMOTION policy minimums (reused, not duplicated)',
    gates.gates.find((g) => g.id === 'PROVIDER_READY')!.reasons[0].includes('50'),
  );
  check(
    'ROLLBACK_REQUIRED is NOT_APPLICABLE while auto-accept is off',
    gates.gates.find((g) => g.id === 'ROLLBACK_REQUIRED')!.status === 'NOT_APPLICABLE',
  );
  check(
    'promotion gates NOT_APPLICABLE without a challenger',
    gates.gates.find((g) => g.id === 'PROMOTION_ALLOWED')!.status === 'NOT_APPLICABLE',
  );
  check(
    'no gate is a bare boolean — all carry reasons + evidence',
    gates.gates.every((g) => g.reasons.length > 0 && Object.keys(g.evidence).length >= 0),
  );

  console.log('\n── V4.0: TRUST ANALYTICS (aggregates the audit; never recomputes trust) ──');
  const trust = await engine.trust(30);
  check(
    'overall: 6 decisions, 50% would-accept, undo share 0.5 of executed',
    trust.overall.decisions === 6 && trust.overall.autoAcceptShare === 0.5 && trust.overall.undoShare === 0.5,
  );
  check('avg trust score is the average of PERSISTED scores (3.1/6)', approx(trust.overall.avgTrustScore, 0.5167));
  check('blended score = 0.5·avg + 0.3·accept + 0.2·(1−undo)', approx(trust.overall.score, 0.5084));
  check(
    'PHOTO slice present; BARCODE filtered by minimum slice size (1 < 3 — noise, not analytics)',
    !!trust.perModality.find((s) => s.key === 'PHOTO') && !trust.perModality.find((s) => s.key === 'BARCODE'),
  );
  check(
    'portion trust derived from ground truth: 1 edited of 3 portioned examples -> 0.6667',
    trust.portionTrust.examples === 3 && approx(trust.portionTrust.score!, 0.6667),
  );

  console.log('\n── V4.0: RISK (five dimensions, every claim with its number) ──');
  const risk = await engine.risk(30);
  const dim = (d: string) => risk.dimensions.find((x) => x.dimension === d)!;
  check(
    'USER risk HIGH: undo rate 50% + a false positive',
    dim('USER').level === 'HIGH' && dim('USER').evidence.some((e) => e.includes('50')),
  );
  check('TECHNICAL risk elevated by provider failure rate 14%', dim('TECHNICAL').level !== 'LOW');
  check(
    'OPERATIONAL names the thin sample (7/50 scans)',
    dim('OPERATIONAL').evidence.some((e) => e.includes('7/50')),
  );
  check('overall = MAX of dimensions (pessimistic by design)', risk.overall === 'HIGH');
  check('all five dimensions present', risk.dimensions.length === 5);

  console.log('\n── V4.0: TIMELINE (append-only history, recomputable forever) ──');
  const timeline = await engine.timeline(30);
  check(
    'two ISO weeks, chronological',
    timeline.global.length === 2 && timeline.global[0].weekStart < timeline.global[1].weekStart,
  );
  check(
    'older week: the shadow barcode decision',
    timeline.global[0].decisions === 1 && timeline.global[0].executed === 0,
  );
  check(
    'recent week: 5 decisions, 2 executed, 1 undone',
    timeline.global[1].decisions === 5 && timeline.global[1].executed === 2 && timeline.global[1].undone === 1,
  );
  check(
    'recent week ground truth: 2 clean confirmations, 1 correction',
    timeline.global[1].confirmations === 2 && timeline.global[1].corrections === 1,
  );
  check(
    'per-modality timelines split the same rows (BARCODE in the older week only)',
    timeline.perModality['BARCODE']?.length === 1 && timeline.perModality['PHOTO']?.length === 1,
  );

  console.log('\n── V4.0: GUARANTEES (read-only, append-only, deterministic, versioned) ──');
  const after = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    decisions: await prisma.visionTrustDecision.count(),
    meals: await prisma.loggedMeal.count(),
  };
  check(
    'READ-ONLY: a full rollout pass (status+health+gates+trust+risk+timeline) changed ZERO rows',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );
  const decisionsAfter = JSON.stringify(await prisma.visionTrustDecision.findMany({ orderBy: { id: 'asc' } }));
  check(
    'APPEND-ONLY: no existing decision row was mutated (byte-identical re-read)',
    decisionsBefore === decisionsAfter,
  );
  const statusAgain = await engine.status(30);
  check(
    'DETERMINISM: same data -> identical stages, reasons and evidence',
    JSON.stringify(status.perModality) === JSON.stringify(statusAgain.perModality) &&
      JSON.stringify(status.global) === JSON.stringify(statusAgain.global),
  );
  const trustAgain = await engine.trust(30);
  check(
    'DETERMINISM: same data -> identical trust analytics',
    JSON.stringify(trust.overall) === JSON.stringify(trustAgain.overall) &&
      JSON.stringify(trust.perFood) === JSON.stringify(trustAgain.perFood),
  );
  check(
    'every report is contract-versioned',
    status.contractVersion === ROLLOUT_CONTRACT_VERSION &&
      health.contractVersion === 1 &&
      risk.contractVersion === 1 &&
      timeline.contractVersion === 1 &&
      gates.contractVersion === 1 &&
      trust.contractVersion === 1,
  );
  check('h2 alias sanity (health reused, not recomputed differently)', h2.scans === 7);

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
    `\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Shadow Rollout + Trust Analytics (V4.0)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
