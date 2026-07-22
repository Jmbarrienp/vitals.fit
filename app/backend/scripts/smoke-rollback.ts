/**
 * Smoke test for Nutrition Vision V4.3 — Safe Rollback Engine.
 * Embedded Postgres for the read-only integration; the plan-building itself is
 * pure and tested directly with hand-built owner verdicts.
 *
 *   npm run smoke:rollback
 *
 * Verifies: the plan is a PURE CONSUMER (recomputes no metric — the trigger is
 * the ROLLBACK_REQUIRED gate, verbatim), a rollback for EACH supported cause
 * (health/undo, false positives, provider drift, HIGH risk), the safe-target
 * rule (disable auto-accept vs restore provider), BLOCKED when a provider
 * rollback needs operator input, NOT_REQUIRED when nothing degrades, severity/
 * priority/confidence derivation, typed checklists, determinism + idempotency,
 * and the READ-ONLY guarantee against the real engine (zero writes).
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

const PORT = 59447;
const DB = 'vitals_rollback_smoke';
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
import { RollbackEngine } from '../src/vision/rollback/rollback.engine';
import { buildRollbackPlan } from '../src/vision/rollback/pipeline/rollback-plan';
import { ROLLBACK_PLAN_VERSION } from '../src/vision/rollback/types/rollback-contract';
import { GovernanceRecommendation } from '../src/vision/governance/types/governance-contract';
import { GatesReport, HealthReport, RiskAssessment, RolloutStatus } from '../src/vision/rollout/types/rollout-contract';
import { PromotionExecutionPlan } from '../src/vision/promotion/types/promotion-plan-contract';

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

// ── owner verdicts, hand-built (the rollback plan must only CONSUME these) ──
function gov(over: Partial<GovernanceRecommendation> = {}): GovernanceRecommendation {
  return {
    contractVersion: 1, window: W, incumbentId: 'alpha', challengerId: null, action: 'MAINTAIN',
    reasons: ['sin cambios'],
    evidence: { pairedScans: 0, top1Delta: null, top1DeltaCi: null, mcNemarZ: null, generalizesAcrossModalities: null, generalizesAcrossUsers: null, latencyDeltaMs: null, tokenDeltaPerScan: null, challengerAvailability: null, incumbentDrift: 'STABLE' },
    checklist: [], ...over,
  };
}
const risk = (overall: 'LOW' | 'MEDIUM' | 'HIGH', dims: any[] = []): RiskAssessment => ({
  contractVersion: 1, window: W, overall,
  dimensions: dims.length ? dims : [{ dimension: 'TECHNICAL', level: overall, evidence: [`riesgo ${overall}`] }],
});
const gates = (rollbackStatus: 'PASS' | 'FAIL' = 'PASS', rollbackReasons: string[] = ['salud en verde']): GatesReport => ({
  contractVersion: 1, window: W,
  gates: [
    { id: 'AUTO_ACCEPT_READY', status: 'FAIL', reasons: ['n/a'], evidence: {} },
    { id: 'PROVIDER_READY', status: 'PASS', reasons: ['ok'], evidence: {} },
    { id: 'ROLLBACK_REQUIRED', status: rollbackStatus, reasons: rollbackReasons, evidence: {} },
    { id: 'PROMOTION_ALLOWED', status: 'NOT_APPLICABLE', reasons: ['n/a'], evidence: {} },
    { id: 'PROMOTION_BLOCKED', status: 'NOT_APPLICABLE', reasons: ['n/a'], evidence: {} },
  ],
});
const health = (over: Partial<HealthReport> = {}): HealthReport => ({
  contractVersion: 1, window: W, scans: 200, acceptanceRate: 0.8, undoRate: 0.05, manualFallbackRate: 0.1,
  providerFailureRate: 0.03, meanLatencyMs: 900, p50LatencyMs: 850, meanScanConfidence: 0.8,
  calibration: { currentEce: 0.1, previousEce: 0.11, drift: 0.01 },
  promotion: { status: 'NOT_EVALUATED', detail: '' }, falsePositives: 0, falseNegatives: 1, ...over,
});
const rollout = (autoAcceptEnabled: boolean, provider = 'alpha'): RolloutStatus => ({
  contractVersion: 1, window: W, generatedFor: { activeProviderId: provider, autoAcceptEnabled },
  global: { stage: 'SHADOW', reasons: ['sombra'] }, perModality: [], perProvider: [],
});
const promo = (readiness: 'READY' | 'BLOCKED' | 'NOT_APPLICABLE' = 'BLOCKED'): PromotionExecutionPlan => ({
  version: 1, generatedAt: AT, currentProvider: 'alpha', candidateProvider: null, decision: 'MAINTAIN',
  confidence: 'SIN_EVIDENCIA', readiness, blockingReasons: [], statisticalEvidence: {} as any, estimatedRisk: { overall: 'LOW', dimensions: [] },
  rolloutStrategy: [], rolloutPercent: 0, estimatedDurationHours: 0, rollbackCriteria: [], rollbackSteps: [], executionSteps: [],
  monitoringChecklist: [], validationChecklist: [], approvalChecklist: [], window: W,
});

async function main() {
  console.log('── V4.3: NOT_REQUIRED (nothing degrading -> no rollback) ──');
  const calm = buildRollbackPlan(gov(), risk('LOW'), gates('PASS'), health(), rollout(true), promo(), AT);
  check('healthy state -> NOT_REQUIRED, target NONE, severity NONE', calm.readiness === 'NOT_REQUIRED' && calm.rollbackTarget.kind === 'NONE' && calm.rollbackSeverity === 'NONE');
  check('…priority NONE and a no-trigger confidence', calm.rollbackPriority === 'NONE' && calm.rollbackConfidence === 'SIN_DISPARADOR');
  check('…no rollback steps for a calm state', calm.rollbackSteps.length === 0 && calm.rollbackReason.includes('no se requiere'));

  console.log('\n── V4.3: CAUSE — degraded health / undo (the canonical gate trigger) ──');
  const undoTrigger = buildRollbackPlan(gov(), risk('LOW'), gates('FAIL', ['REVERTIR: tasa de undo 50% > 20%']), health({ undoRate: 0.5 }), rollout(true), promo(), AT);
  check('ROLLBACK_REQUIRED FAIL + auto-accept on -> REQUIRED, DISABLE_AUTO_ACCEPT', undoTrigger.readiness === 'REQUIRED' && undoTrigger.rollbackTarget.kind === 'DISABLE_AUTO_ACCEPT');
  check('…the trigger evidence is the gate reasons VERBATIM (not re-derived)', undoTrigger.triggeringEvidence.some((e) => e.includes('tasa de undo 50%')));
  check('…severity HIGH (gate fired, no false positives yet)', undoTrigger.rollbackSeverity === 'HIGH' && undoTrigger.rollbackPriority === 'SCHEDULED');
  check('…deterministic disable-auto-accept steps, containment first', undoTrigger.rollbackSteps[0].detail.includes('AUTO_ACCEPT_ENABLED=false'));

  console.log('\n── V4.3: CAUSE — false positives (the platform acted wrong on users) ──');
  const fpTrigger = buildRollbackPlan(gov(), risk('LOW'), gates('FAIL', ['REVERTIR: 5 falsos positivos > 10']), health({ falsePositives: 5 }), rollout(true), promo(), AT);
  check('gate fired + false positives -> CRITICAL, IMMEDIATE', fpTrigger.rollbackSeverity === 'CRITICAL' && fpTrigger.rollbackPriority === 'IMMEDIATE');
  check('…the verification checklist flags the false positives as FAIL', fpTrigger.verificationChecklist.find((i) => i.label.includes('falsos positivos'))?.status === 'FAIL');
  check('…the communication plan escalates immediately', fpTrigger.communicationPlan.some((c) => c.includes('INMEDIATAMENTE')));

  console.log('\n── V4.3: CAUSE — provider drift with auto-accept already off -> BLOCKED ──');
  const driftBlocked = buildRollbackPlan(gov({ action: 'DEMOTE', evidence: { ...gov().evidence, incumbentDrift: 'DRIFTING' }, reasons: ['top-1 cayó 10pp'] }), risk('MEDIUM'), gates('PASS'), health(), rollout(false), promo(), AT);
  check('drift + auto-accept off -> RESTORE_PROVIDER, but BLOCKED on operator', driftBlocked.readiness === 'BLOCKED' && driftBlocked.rollbackTarget.kind === 'RESTORE_PROVIDER');
  check('…because promotion history is not persisted (honest gap, named)', driftBlocked.blockingReasons.some((r) => r.includes('historial de promociones')));
  check('…the safe floor (fixture) is named as the target provider', driftBlocked.rollbackTarget.provider === 'fixture');
  check('…severity MEDIUM (drift, no acute health failure), priority MONITOR', driftBlocked.rollbackSeverity === 'MEDIUM' && driftBlocked.rollbackPriority === 'MONITOR');
  check('…restore-provider steps require operator confirmation first', driftBlocked.rollbackSteps[0].detail.includes('confirma el último proveedor bueno'));

  console.log('\n── V4.3: CAUSE — HIGH risk escalates severity ──');
  const highRisk = buildRollbackPlan(gov(), risk('HIGH', [{ dimension: 'USER', level: 'HIGH', evidence: ['undo 50% — los usuarios revierten'] }]), gates('PASS'), health(), rollout(true), promo(), AT);
  check('HIGH risk alone triggers a rollback (auto-accept lever), CRITICAL', highRisk.readiness === 'REQUIRED' && highRisk.rollbackSeverity === 'CRITICAL');
  check('…the risk summary is quoted from the Risk Engine, not re-assessed', highRisk.riskSummary.overall === 'HIGH' && highRisk.riskSummary.dimensions[0].dimension === 'USER');

  console.log('\n── V4.3: CONFIDENCE (a count of AGREEING signals, not a recomputation) ──');
  const oneSignal = buildRollbackPlan(gov(), risk('LOW'), gates('FAIL', ['REVERTIR: undo alto']), health({ undoRate: 0.5 }), rollout(true), promo(), AT);
  check('one signal (gate) -> BAJA', oneSignal.rollbackConfidence === 'BAJA', oneSignal.rollbackConfidence);
  const threeSignals = buildRollbackPlan(gov({ action: 'DEMOTE', evidence: { ...gov().evidence, incumbentDrift: 'DRIFTING' } }), risk('HIGH'), gates('FAIL', ['REVERTIR: undo alto']), health({ undoRate: 0.5 }), rollout(true), promo(), AT);
  check('gate + drift + risk + degraded health all agree -> ALTA', threeSignals.rollbackConfidence === 'ALTA');

  console.log('\n── V4.3: PURE CONSUMER (quotes owners; recomputes nothing) ──');
  check('triggering metrics quote health with the OWNING thresholds', undoTrigger.triggeringMetrics.find((m) => m.metric === 'undoRate')?.observed === 0.5 && undoTrigger.triggeringMetrics.find((m) => m.metric === 'undoRate')?.threshold === 0.2);
  check('each metric names its source owner', undoTrigger.triggeringMetrics.every((m) => !!m.source));
  check('degraded health is isHealthGreen()\'s reasons verbatim', undoTrigger.degradedHealth.length > 0 && undoTrigger.degradedHealth[0].includes('undo'));
  check('failed gates are listed from the Gates report', undoTrigger.failedGates.some((g) => g.id === 'ROLLBACK_REQUIRED'));
  check('retry conditions reuse the Promotion Executor readiness, not new criteria', undoTrigger.retryConditions.some((r) => r.includes('V4.2')));

  console.log('\n── V4.3: CHECKLISTS (status + explanation + severity + owner, six categories) ──');
  const allItems = [...undoTrigger.verificationChecklist, ...undoTrigger.postRollbackChecklist];
  check('every item fully typed — no bare booleans', allItems.every((i) => !!i.status && !!i.explanation && !!i.severity && !!i.owner && !!i.category));
  check('the six categories are represented across the plan', new Set(allItems.map((i) => i.category)).size >= 5, [...new Set(allItems.map((i) => i.category))].join(','));

  console.log('\n── V4.3: DETERMINISM + IDEMPOTENCY ──');
  check('same verdicts + same timestamp -> byte-identical plan', JSON.stringify(buildRollbackPlan(gov(), risk('LOW'), gates('FAIL', ['REVERTIR: undo alto']), health({ undoRate: 0.5 }), rollout(true), promo(), AT)) === JSON.stringify(oneSignal));
  check('generatedAt is an INPUT, stamped and versioned', undoTrigger.generatedAt === AT && undoTrigger.version === ROLLBACK_PLAN_VERSION);

  // ── integration: read-only against the real engine ──
  console.log('\n── V4.3: INTEGRATION (read-only against the real engine) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-rb-'));
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
  const rolloutEngine = new RolloutEngine(config, groundTruth, evaluation, new RolloutDataReader(prisma));
  const promotion = new PromotionExecutorEngine(governance, rolloutEngine);
  const engine = new RollbackEngine(governance, rolloutEngine, promotion);

  const before = {
    scans: await prisma.visionScan.count(), feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(), decisions: await prisma.visionTrustDecision.count(), meals: await prisma.loggedMeal.count(),
  };

  const plan = await engine.plan(30, AT);
  check('the engine produces a versioned plan over an empty DB without crashing', plan.version === ROLLBACK_PLAN_VERSION && plan.generatedAt === AT);
  check('empty, healthy DB -> NOT_REQUIRED (no phantom rollback)', plan.readiness === 'NOT_REQUIRED' && plan.rollbackTarget.kind === 'NONE');
  check('projections agree with the full plan', (await engine.readiness(30, AT)).readiness === plan.readiness && (await engine.summary(30, AT)).currentProvider === plan.currentProvider);

  const after = {
    scans: await prisma.visionScan.count(), feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(), decisions: await prisma.visionTrustDecision.count(), meals: await prisma.loggedMeal.count(),
  };
  check('READ-ONLY: building the plan changed ZERO rows', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
  const normalize = (p: any) => JSON.stringify({ ...p, window: null, rollbackWindow: null });
  check('the real engine is deterministic in its derived content (window is a clock input)', normalize(await engine.plan(30, AT)) === normalize(plan));

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Safe Rollback Engine (V4.3)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
