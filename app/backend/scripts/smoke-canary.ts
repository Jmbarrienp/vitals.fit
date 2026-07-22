/**
 * Smoke test for Nutrition Vision V4.4 — Progressive Canary Rollout Automation.
 * Embedded Postgres for the read-only integration; the progression decision
 * itself is pure and tested directly with hand-built promotion/rollback plans.
 *
 *   npm run smoke:canary
 *
 * Verifies: the progression is a PURE CONSUMER (the ladder is the Promotion
 * plan's, the abort signal is the Rollback plan's — nothing recomputed), each
 * recommendation (ADVANCE / STAY / HOLD / PAUSE / ROLLBACK / COMPLETE) for the
 * state that produces it, ladder positioning (PAST/CURRENT/FUTURE) at every
 * rung, the operator-supplied position boundary, determinism + idempotency,
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

const PORT = 59448;
const DB = 'vitals_canary_smoke';
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
import { CanaryEngine } from '../src/vision/canary/canary.engine';
import { buildCanaryPlan, decideCanary } from '../src/vision/canary/pipeline/canary-plan';
import { CANARY_PLAN_VERSION } from '../src/vision/canary/types/canary-contract';
import { PromotionExecutionPlan, RolloutStage } from '../src/vision/promotion/types/promotion-plan-contract';
import { RollbackExecutionPlan } from '../src/vision/rollback/types/rollback-contract';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const AT = '2026-07-16T12:00:00.000Z';
const W = { from: new Date('2026-06-16T00:00:00Z'), to: new Date('2026-07-16T00:00:00Z') };

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

// ── the ladder, as the Promotion Executor produces it (consumed, never rebuilt) ──
const LADDER: RolloutStage[] = [5, 10, 25, 50, 100].map((percent, i) => ({
  percent,
  suggestedDurationHours: [24, 24, 48, 48, 72][i],
  advanceConditions: [`avanzar-${percent}`],
  stopConditions: [`parar-${percent}`],
  rollbackConditions: [`revertir-${percent}`],
}));

function promo(over: Partial<PromotionExecutionPlan> = {}): PromotionExecutionPlan {
  return {
    version: 1,
    generatedAt: AT,
    currentProvider: 'alpha',
    candidateProvider: 'beta',
    decision: 'PROMOTE',
    confidence: 'MEDIA',
    readiness: 'READY',
    blockingReasons: [],
    statisticalEvidence: {} as any,
    estimatedRisk: { overall: 'LOW', dimensions: [{ dimension: 'TECHNICAL', level: 'LOW', topEvidence: 'ok' }] },
    rolloutStrategy: LADDER,
    rolloutPercent: 5,
    estimatedDurationHours: 216,
    rollbackCriteria: [],
    rollbackSteps: [],
    executionSteps: [],
    monitoringChecklist: [],
    validationChecklist: [],
    approvalChecklist: [],
    window: W,
    ...over,
  };
}
function rb(over: Partial<RollbackExecutionPlan> = {}): RollbackExecutionPlan {
  return {
    version: 1,
    generatedAt: AT,
    currentProvider: 'alpha',
    rollbackTarget: { kind: 'NONE', provider: null, detail: 'sin rollback' },
    readiness: 'NOT_REQUIRED',
    rollbackReason: 'sin degradación',
    rollbackSeverity: 'NONE',
    rollbackPriority: 'NONE',
    rollbackConfidence: 'SIN_DISPARADOR',
    blockingReasons: [],
    triggeringEvidence: ['salud verde'],
    triggeringMetrics: [],
    failedGates: [],
    degradedHealth: [],
    riskSummary: { overall: 'LOW', dimensions: [] },
    rollbackSteps: [],
    verificationChecklist: [],
    postRollbackChecklist: [],
    monitoringPlan: [],
    communicationPlan: [],
    retryConditions: [],
    estimatedImpact: [],
    rollbackWindow: W,
    ...over,
  };
}

async function main() {
  console.log('── V4.4: RECOMMENDATION (each move for the state that produces it) ──');
  const advance = decideCanary(5, promo(), rb());
  check(
    'healthy, promotable, low risk, mid-ladder -> ADVANCE',
    advance.recommendation === 'ADVANCE' && advance.readiness === 'READY_TO_ADVANCE',
  );
  check('…explained, never a bare enum', advance.reason.includes('avanzar') && advance.reason.length > 20);

  const stay = decideCanary(5, promo({ estimatedRisk: { overall: 'MEDIUM', dimensions: [] } }), rb());
  check(
    "green but MEDIUM risk -> STAY (keep observing, don't advance)",
    stay.recommendation === 'STAY' && stay.reason.includes('MEDIO'),
  );

  const hold = decideCanary(0, promo({ readiness: 'BLOCKED', blockingReasons: ['Governance recomienda HOLD'] }), rb());
  check(
    'no viable promotion -> HOLD, quoting the promotion blocker',
    hold.recommendation === 'HOLD' && hold.reason.includes('HOLD'),
  );
  check(
    'no candidate -> HOLD too',
    decideCanary(0, promo({ readiness: 'NOT_APPLICABLE' }), rb()).recommendation === 'HOLD',
  );

  const pause = decideCanary(
    10,
    promo(),
    rb({
      readiness: 'REQUIRED',
      rollbackPriority: 'MONITOR',
      rollbackSeverity: 'MEDIUM',
      degradedHealth: ['undo 12%'],
    }),
  );
  check(
    "mild degradation (rollback at MONITOR) -> PAUSE (contain, don't revert)",
    pause.recommendation === 'PAUSE' && pause.reason.includes('degradación leve'),
  );

  const rollbackImmediate = decideCanary(
    25,
    promo(),
    rb({
      readiness: 'REQUIRED',
      rollbackPriority: 'IMMEDIATE',
      rollbackSeverity: 'CRITICAL',
      rollbackReason: 'undo 50%',
    }),
  );
  check(
    'IMMEDIATE rollback priority -> ROLLBACK (abort), deferring to the Rollback plan',
    rollbackImmediate.recommendation === 'ROLLBACK' && rollbackImmediate.readiness === 'ABORTING',
  );
  check(
    'SCHEDULED rollback priority also aborts',
    decideCanary(25, promo(), rb({ readiness: 'REQUIRED', rollbackPriority: 'SCHEDULED', rollbackSeverity: 'HIGH' }))
      .recommendation === 'ROLLBACK',
  );
  check(
    'abort OUTRANKS everything: even with a promotable plan, ROLLBACK wins',
    decideCanary(50, promo({ readiness: 'READY' }), rb({ readiness: 'REQUIRED', rollbackPriority: 'IMMEDIATE' }))
      .recommendation === 'ROLLBACK',
  );

  const complete = decideCanary(100, promo(), rb());
  check(
    'at 100%, promotable, no degradation -> COMPLETE',
    complete.recommendation === 'COMPLETE' && complete.readiness === 'COMPLETED',
  );

  console.log('\n── V4.4: PURE CONSUMER (ladder + abort signal both consumed, not recomputed) ──');
  const plan = buildCanaryPlan(5, promo(), rb(), AT);
  check(
    "the timeline IS the Promotion plan's ladder (5 rungs, same durations)",
    plan.timeline.map((s) => s.percent).join(',') === '5,10,25,50,100' &&
      plan.timeline[4].suggestedDurationHours === 72,
  );
  check(
    "required conditions are the current rung's advanceConditions, verbatim",
    plan.requiredConditions.join(',') === 'avanzar-5',
  );
  check(
    'the promotion reference points, never copies',
    plan.promotionReference.readiness === 'READY' && plan.promotionReference.candidateProvider === 'beta',
  );
  check(
    'the rollback reference points, never copies',
    plan.rollbackReference.readiness === 'NOT_REQUIRED' && plan.rollbackReference.priority === 'NONE',
  );
  check("estimated risk is the Promotion plan's summary, not re-assessed", plan.estimatedRisk.overall === 'LOW');

  console.log('\n── V4.4: LADDER POSITIONING (PAST / CURRENT / FUTURE) ──');
  const pre = buildCanaryPlan(0, promo(), rb(), AT);
  check(
    'pre-rollout (0%): no CURRENT rung, next is 5%, all rungs FUTURE',
    pre.currentStage === null && pre.nextStage?.percent === 5 && pre.timeline.every((s) => s.position === 'FUTURE'),
  );
  const at10 = buildCanaryPlan(10, promo(), rb(), AT);
  check(
    'at 10%: 5% is PAST, 10% is CURRENT, 25%+ are FUTURE',
    at10.timeline[0].position === 'PAST' &&
      at10.timeline[1].position === 'CURRENT' &&
      at10.timeline[2].position === 'FUTURE',
  );
  check(
    '…current stage carries live observed indicators',
    (at10.currentStage?.observedIndicators.length ?? 0) > 0 &&
      at10.currentStage?.observedIndicators.some((i) => i.includes('ADVANCE')),
  );
  check('…next stage is 25%', at10.nextStage?.percent === 25);
  const at7 = buildCanaryPlan(7, promo(), rb(), AT);
  check(
    'an off-rung position (7%) snaps to the rung it is on (5% CURRENT, 10% next)',
    at7.currentStage?.percent === 5 && at7.nextStage?.percent === 10,
  );
  const at100 = buildCanaryPlan(100, promo(), rb(), AT);
  check(
    'at 100%: it is CURRENT, everything below is PAST, no next stage',
    at100.currentStage?.percent === 100 && at100.nextStage === null && at100.timeline[0].position === 'PAST',
  );
  check('position clamps: 150% treated as 100%', buildCanaryPlan(150, promo(), rb(), AT).rolloutPercent === 100);

  console.log('\n── V4.4: SIGNALS + EXPOSURE (never bare booleans) ──');
  check(
    'advance/hold/rollback signals each carry an explanation',
    plan.advanceRecommendation.explanation.length > 0 &&
      plan.holdRecommendation.explanation.length > 0 &&
      plan.rollbackRecommendation.explanation.length > 0,
  );
  check(
    'advance signal true only when the recommendation is ADVANCE',
    plan.advanceRecommendation.value === true &&
      buildCanaryPlan(5, promo({ estimatedRisk: { overall: 'MEDIUM', dimensions: [] } }), rb(), AT)
        .advanceRecommendation.value === false,
  );
  check(
    'exposure names the current and next percent',
    plan.estimatedExposure.currentPercent === 5 && plan.estimatedExposure.nextPercent === 10,
  );
  check('at 100% there is no next exposure', at100.estimatedExposure.nextPercent === null);
  check(
    'checklists are fully typed',
    [...plan.monitoringChecklist, ...plan.verificationChecklist].every(
      (i) => !!i.status && !!i.explanation && !!i.owner && !!i.category,
    ),
  );

  console.log('\n── V4.4: DETERMINISM + IDEMPOTENCY ──');
  check(
    'same inputs + same timestamp -> byte-identical plan',
    JSON.stringify(buildCanaryPlan(10, promo(), rb(), AT)) === JSON.stringify(at10),
  );
  check('generatedAt is an INPUT, versioned', at10.generatedAt === AT && at10.version === CANARY_PLAN_VERSION);

  // ── integration: read-only against the real engine ──
  console.log('\n── V4.4: INTEGRATION (read-only against the real engine) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-canary-'));
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
  const config = new ConfigService({ VISION_PROVIDER: 'fixture' });
  const groundTruth = new GroundTruthReader(prisma);
  const evaluation = new EvaluationEngine(groundTruth, new ReplayEngine(prisma, foodSvc));
  const governance = new GovernanceEngine(prisma, config, foodSvc, groundTruth, evaluation);
  const rolloutEngine = new RolloutEngine(config, groundTruth, evaluation, new RolloutDataReader(prisma));
  const promotion = new PromotionExecutorEngine(governance, rolloutEngine);
  const rollback = new RollbackEngine(governance, rolloutEngine, promotion);
  const engine = new CanaryEngine(promotion, rollback);

  const before = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(),
    decisions: await prisma.visionTrustDecision.count(),
    meals: await prisma.loggedMeal.count(),
  };

  const realPlan = await engine.plan(0, 30, AT);
  check(
    'the engine produces a versioned plan over an empty DB without crashing',
    realPlan.version === CANARY_PLAN_VERSION && realPlan.generatedAt === AT,
  );
  check('empty DB (no promotable candidate) -> HOLD, never a phantom ADVANCE', realPlan.recommendation === 'HOLD');
  check(
    'projections agree with the full plan',
    (await engine.readiness(0, 30, AT)).recommendation === realPlan.recommendation &&
      (await engine.timeline(0, 30, AT)).timeline.length === realPlan.timeline.length,
  );

  const after = {
    scans: await prisma.visionScan.count(),
    feedback: await prisma.visionFeedback.count(),
    shadow: await prisma.visionShadowRun.count(),
    decisions: await prisma.visionTrustDecision.count(),
    meals: await prisma.loggedMeal.count(),
  };
  check(
    'READ-ONLY: building the plan changed ZERO rows',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );
  const normalize = (p: any) => JSON.stringify({ ...p, window: null });
  check(
    'the real engine is deterministic in its derived content (window is a clock input)',
    normalize(await engine.plan(0, 30, AT)) === normalize(realPlan),
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
    `\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Progressive Canary Rollout (V4.4)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
