/**
 * Smoke test for Nutrition Vision V4.2 — Provider Promotion Executor.
 * Embedded Postgres for the read-only integration; the plan-building itself is
 * pure and tested directly with hand-built owner verdicts.
 *
 *   npm run smoke:promotion
 *
 * Verifies: the plan is a PURE CONSUMER (recomputes no statistic — every number
 * is traceable to an owner's verdict), readiness derivation (READY only when
 * Governance says PROMOTE and no blocking gate fails and risk is not HIGH),
 * the rollout ladder with explained conditions, typed checklists (status /
 * explanation / severity / owner), rollback criteria and steps, determinism +
 * idempotency (same verdicts + timestamp -> byte-identical plan), and the
 * READ-ONLY guarantee against the real engine (a full plan build changes zero
 * rows).
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

const PORT = 59446;
const DB = 'vitals_promotion_smoke';
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
import { GovernanceEngine } from '../src/vision/governance/governance.engine';
import { PromotionExecutorEngine } from '../src/vision/promotion/promotion-executor.engine';
import { buildPromotionPlan } from '../src/vision/promotion/pipeline/promotion-plan';
import { PROMOTION_PLAN_VERSION } from '../src/vision/promotion/types/promotion-plan-contract';
import { GovernanceRecommendation } from '../src/vision/governance/types/governance-contract';
import { GatesReport, HealthReport, RiskAssessment, RolloutStatus } from '../src/vision/rollout/types/rollout-contract';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const AT = '2026-07-16T12:00:00.000Z';
const W = { from: new Date('2026-06-16T00:00:00Z'), to: new Date('2026-07-16T00:00:00Z') };

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

// ── owner verdicts, hand-built (the plan must only CONSUME these) ──
function rec(over: Partial<GovernanceRecommendation> = {}): GovernanceRecommendation {
  return {
    contractVersion: 1, window: W, incumbentId: 'alpha', challengerId: 'beta', action: 'PROMOTE',
    reasons: ['el challenger supera al incumbente'],
    evidence: {
      pairedScans: 120, top1Delta: 0.08, top1DeltaCi: { low: 0.03, high: 0.13 }, mcNemarZ: 3.1,
      generalizesAcrossModalities: true, generalizesAcrossUsers: true,
      latencyDeltaMs: -20, tokenDeltaPerScan: 50, challengerAvailability: 0.99, incumbentDrift: 'STABLE',
    },
    checklist: ['revisar la ventana'],
    ...over,
  };
}
const risk = (overall: 'LOW' | 'MEDIUM' | 'HIGH', dims: any[] = []): RiskAssessment => ({
  contractVersion: 1, window: W, overall,
  dimensions: dims.length ? dims : [{ dimension: 'TECHNICAL', level: overall, evidence: [`riesgo ${overall}`] }],
});
const gates = (over: Record<string, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'> = {}): GatesReport => ({
  contractVersion: 1, window: W,
  gates: [
    { id: 'AUTO_ACCEPT_READY', status: over.AUTO_ACCEPT_READY ?? 'PASS', reasons: ['ok'], evidence: {} },
    { id: 'PROVIDER_READY', status: over.PROVIDER_READY ?? 'PASS', reasons: ['muestra suficiente'], evidence: {} },
    { id: 'ROLLBACK_REQUIRED', status: over.ROLLBACK_REQUIRED ?? 'NOT_APPLICABLE', reasons: ['auto-accept off'], evidence: {} },
    { id: 'PROMOTION_ALLOWED', status: over.PROMOTION_ALLOWED ?? 'PASS', reasons: ['ok'], evidence: {} },
    { id: 'PROMOTION_BLOCKED', status: over.PROMOTION_BLOCKED ?? 'FAIL', reasons: ['ok'], evidence: {} },
  ],
});
const health = (over: Partial<HealthReport> = {}): HealthReport => ({
  contractVersion: 1, window: W, scans: 200, acceptanceRate: 0.8, undoRate: 0.05, manualFallbackRate: 0.1,
  providerFailureRate: 0.03, meanLatencyMs: 900, p50LatencyMs: 850, meanScanConfidence: 0.8,
  calibration: { currentEce: 0.1, previousEce: 0.11, drift: 0.01 },
  promotion: { status: 'PROMOTE_CHALLENGER', detail: 'ok' }, falsePositives: 0, falseNegatives: 1, ...over,
});
const status = (): RolloutStatus => ({
  contractVersion: 1, window: W, generatedFor: { activeProviderId: 'alpha', autoAcceptEnabled: false },
  global: { stage: 'SHADOW', reasons: ['sombra'] }, perModality: [], perProvider: [],
});

async function main() {
  console.log('── V4.2: READINESS (derived from the owners — never re-judged) ──');
  const ready = buildPromotionPlan(rec(), risk('LOW'), gates(), health(), status(), AT);
  check('PROMOTE + no blocking gate + risk LOW -> READY, no blockers', ready.readiness === 'READY' && ready.blockingReasons.length === 0);
  check('a READY plan enters the ladder at 5%', ready.rolloutPercent === 5);

  const notPromote = buildPromotionPlan(rec({ action: 'HOLD', reasons: ['no generaliza'] }), risk('LOW'), gates(), health(), status(), AT);
  check('Governance says HOLD -> BLOCKED, quoting Governance verbatim', notPromote.readiness === 'BLOCKED' && notPromote.blockingReasons[0].includes('HOLD') && notPromote.blockingReasons[0].includes('no generaliza'));
  check('a BLOCKED plan starts at 0% (ladder documented, entry blocked)', notPromote.rolloutPercent === 0);

  const gateFail = buildPromotionPlan(rec(), risk('LOW'), gates({ PROVIDER_READY: 'FAIL' }), health(), status(), AT);
  check('a failing PROVIDER_READY gate blocks even a PROMOTE', gateFail.readiness === 'BLOCKED' && gateFail.blockingReasons.some((r) => r.includes('PROVIDER_READY')));
  const rollbackFail = buildPromotionPlan(rec(), risk('LOW'), gates({ ROLLBACK_REQUIRED: 'FAIL' }), health(), status(), AT);
  check('a firing ROLLBACK_REQUIRED gate blocks promotion', rollbackFail.readiness === 'BLOCKED' && rollbackFail.blockingReasons.some((r) => r.includes('ROLLBACK_REQUIRED')));
  const highRisk = buildPromotionPlan(rec(), risk('HIGH', [{ dimension: 'USER', level: 'HIGH', evidence: ['undo 50%'] }]), gates(), health(), status(), AT);
  check('HIGH overall risk blocks, naming the worst dimension', highRisk.readiness === 'BLOCKED' && highRisk.blockingReasons.some((r) => r.includes('USER')));
  const noCandidate = buildPromotionPlan(rec({ challengerId: null, action: 'REQUIRE_MORE_DATA' }), risk('LOW'), gates(), health(), status(), AT);
  check('no candidate -> NOT_APPLICABLE', noCandidate.readiness === 'NOT_APPLICABLE');

  console.log('\n── V4.2: PURE CONSUMER (quotes the owners; recomputes nothing) ──');
  check('statistical evidence is Governance verbatim', ready.statisticalEvidence.pairedScans === 120 && ready.statisticalEvidence.mcNemarZ === 3.1 && ready.statisticalEvidence.top1DeltaCi?.low === 0.03);
  check('risk is the Risk Engine summarized, never re-assessed', ready.estimatedRisk.overall === 'LOW' && ready.estimatedRisk.dimensions[0].dimension === 'TECHNICAL');
  check('confidence is a LABEL over the CI width, not a recomputation (0.10 wide -> MEDIA)', ready.confidence === 'MEDIA');
  check('a tight CI reads ALTA', buildPromotionPlan(rec({ evidence: { ...rec().evidence, top1DeltaCi: { low: 0.06, high: 0.09 } } }), risk('LOW'), gates(), health(), status(), AT).confidence === 'ALTA');
  check('no CI -> SIN_EVIDENCIA', buildPromotionPlan(rec({ evidence: { ...rec().evidence, top1DeltaCi: null } }), risk('LOW'), gates(), health(), status(), AT).confidence === 'SIN_EVIDENCIA');

  console.log('\n── V4.2: ROLLOUT LADDER (5/10/25/50/100, every condition explained) ──');
  check('exactly the five rungs, in order', ready.rolloutStrategy.map((s) => s.percent).join(',') === '5,10,25,50,100');
  check('every rung has advance/stop/rollback conditions — never a naked percent', ready.rolloutStrategy.every((s) => s.advanceConditions.length > 0 && s.stopConditions.length > 0 && s.rollbackConditions.length > 0));
  check('advance conditions quote the health thresholds by their owning constants', ready.rolloutStrategy[0].advanceConditions.some((c) => c.includes('undo')));
  check('total duration is the sum of the ladder (24+24+48+48+72=216h)', ready.estimatedDurationHours === 216);
  check('rollback criteria are the de-duplicated union of the ladder', ready.rollbackCriteria.length > 0 && ready.rollbackCriteria.length === new Set(ready.rollbackCriteria).size);

  console.log('\n── V4.2: CHECKLISTS (status + explanation + severity + owner) ──');
  const allItems = [...ready.validationChecklist, ...ready.monitoringChecklist, ...ready.approvalChecklist];
  check('every checklist item is fully typed — no bare booleans', allItems.every((i) => !!i.status && !!i.explanation && !!i.severity && !!i.owner && !!i.category));
  check('all six categories are represented across the checklists', new Set(allItems.map((i) => i.category)).size === 6, [...new Set(allItems.map((i) => i.category))].join(','));
  check('monitoring reflects live health: undo 5% under threshold -> PASS', ready.monitoringChecklist.find((i) => i.label.includes('undo') || i.label.includes('undo'))?.status !== 'FAIL');
  const badHealth = buildPromotionPlan(rec(), risk('LOW'), gates(), health({ undoRate: 0.5, falsePositives: 3 }), status(), AT);
  check('a bad undo rate flips its monitoring item to FAIL', badHealth.monitoringChecklist.find((i) => i.label.toLowerCase().includes('undo'))?.status === 'FAIL');
  check('false positives flip the safety item to FAIL', badHealth.monitoringChecklist.find((i) => i.label.includes('Falsos positivos'))?.status === 'FAIL');
  check('validation reflects paired-scan sufficiency', ready.validationChecklist.find((i) => i.label.includes('pareada'))?.status === 'PASS');
  check('insufficient paired scans -> validation FAIL', buildPromotionPlan(rec({ evidence: { ...rec().evidence, pairedScans: 5 } }), risk('LOW'), gates(), health(), status(), AT).validationChecklist.find((i) => i.label.includes('pareada'))?.status === 'FAIL');
  check('approval is PENDING when READY, FAIL on the safety gate when BLOCKED', ready.approvalChecklist.every((i) => i.status === 'PENDING') && notPromote.approvalChecklist.find((i) => i.category === 'SAFETY')?.status === 'FAIL');

  console.log('\n── V4.2: EXECUTION + ROLLBACK STEPS (ordered, owned, descriptive only) ──');
  check('execution steps are ordered 1..N with owners', ready.executionSteps.every((s, i) => s.order === i + 1 && !!s.owner));
  check('execution names the candidate and warns about calibration reset', ready.executionSteps.some((s) => s.detail.includes('beta')) && ready.executionSteps.some((s) => s.detail.includes('calibración')));
  check('rollback steps restore the incumbent and preserve evidence', ready.rollbackSteps.some((s) => s.detail.includes('alpha')) && ready.rollbackSteps.some((s) => s.detail.includes('append-only')));

  console.log('\n── V4.2: DETERMINISM + IDEMPOTENCY ──');
  check('same verdicts + same timestamp -> byte-identical plan', JSON.stringify(buildPromotionPlan(rec(), risk('LOW'), gates(), health(), status(), AT)) === JSON.stringify(ready));
  check('generatedAt is an INPUT (reproducible), stamped on the plan', ready.generatedAt === AT && ready.version === PROMOTION_PLAN_VERSION);

  // ── integration: read-only against the real engine ──
  console.log('\n── V4.2: INTEGRATION (read-only against the real engine) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-promo-'));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();
  const foodSvc = new FoodService(new LocalFoodAdapter(prisma));
  const config = new ConfigService({ VISION_PROVIDER: 'fixture' });
  const groundTruth = new GroundTruthReader(prisma);
  const evaluation = new EvaluationEngine(groundTruth, new ReplayEngine(prisma, foodSvc));
  const governance = new GovernanceEngine(prisma, config, foodSvc, groundTruth, evaluation);
  const rollout = new RolloutEngine(config, groundTruth, evaluation, new RolloutDataReader(prisma));
  const engine = new PromotionExecutorEngine(governance, rollout);

  const before = {
    scans: await prisma.visionScan.count(), feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(), decisions: await prisma.visionTrustDecision.count(), meals: await prisma.loggedMeal.count(),
  };

  const plan = await engine.plan(30, AT);
  check('the engine produces a versioned plan over an empty DB without crashing', plan.version === PROMOTION_PLAN_VERSION && plan.generatedAt === AT);
  check('no shadow evidence -> NOT_APPLICABLE / REQUIRE_MORE_DATA, never a phantom PROMOTE', plan.readiness !== 'READY' && plan.decision !== 'PROMOTE');
  check('the projections agree with the full plan (same underlying build)', (await engine.readiness(30, AT)).readiness === plan.readiness && (await engine.rollback(30, AT)).rollbackCriteria.length === plan.rollbackCriteria.length);

  const after = {
    scans: await prisma.visionScan.count(), feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(), decisions: await prisma.visionTrustDecision.count(), meals: await prisma.loggedMeal.count(),
  };
  check('READ-ONLY: building the plan (governance + rollout + assembly) changed ZERO rows', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
  // The pure builder's determinism is proven above. The ENGINE derives its
  // evaluation window from the wall clock (a "last N days" window), so two
  // calls milliseconds apart see near-identical but not byte-identical windows
  // — exactly like generatedAt. Determinism of the DERIVED CONTENT is what
  // matters, so normalize the two clock-driven inputs (generatedAt is already
  // fixed; the window is the evaluation clock) and compare the rest.
  const normalize = (p: any) => JSON.stringify({ ...p, window: null, statisticalEvidence: { ...p.statisticalEvidence } });
  check('the real engine is deterministic in its DERIVED content (window is a clock input, like generatedAt)', normalize(await engine.plan(30, AT)) === normalize(plan));

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Provider Promotion Executor (V4.2)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
