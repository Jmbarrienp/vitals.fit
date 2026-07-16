/**
 * CLI evaluation runner (Nutrition Vision V3.5). Runs the Continuous Learning
 * & Evaluation Engine against the DATABASE_URL in the environment — READ-ONLY
 * (the engine contains no write calls; the smoke suite proves it).
 *
 *   npm run eval:vision                                  # ground-truth summary (90d)
 *   npm run eval:vision -- --provider=claude             # scorecard + calibration
 *   npm run eval:vision -- --compare=fixture,claude      # comparison + promotion decision
 *   npm run eval:vision -- --replay                      # historical pipeline replay
 *   npm run eval:vision -- --days=30 --provider=claude   # custom window
 *
 * Point DATABASE_URL at production ONLY for reading reports — this runner
 * never mutates anything, but repository discipline still applies: it is an
 * inspection tool, not a deployment step.
 */
import 'reflect-metadata';
import { PrismaService } from '../src/prisma/prisma.service';
import { FoodService } from '../src/food/food.service';
import { LocalFoodAdapter } from '../src/food/adapters/local.adapter';
import { GroundTruthReader } from '../src/vision/learning/ground-truth.reader';
import { ReplayEngine } from '../src/vision/learning/replay.engine';
import { EvaluationEngine } from '../src/vision/learning/evaluation.engine';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const engine = new EvaluationEngine(new GroundTruthReader(prisma), new ReplayEngine(prisma, new FoodService(new LocalFoodAdapter(prisma))));

  const days = arg('days') ? Number(arg('days')) : undefined;
  const provider = arg('provider');
  const compare = arg('compare');

  try {
    if (compare) {
      const [incumbent, challenger] = compare.split(',').map((s) => s.trim());
      if (!incumbent || !challenger) throw new Error('--compare requires two ids: --compare=incumbent,challenger');
      const report = await engine.compare(incumbent, challenger, { days });
      print('PROVIDER COMPARISON + PROMOTION DECISION', report);
      console.log(`\nVERDICT: ${report.decision.verdict}`);
      for (const reason of report.decision.reasons) console.log(`  - ${reason}`);
    } else if (provider) {
      print(`SCORECARD — ${provider}`, await engine.scorecard(provider, { days }));
      print(`CALIBRATION — ${provider}`, await engine.calibration(provider, { days }));
    } else if (flag('replay')) {
      print('HISTORICAL REPLAY (current pipeline vs ground truth)', await engine.replay({ days }));
    } else {
      print('GROUND TRUTH SUMMARY', await engine.summary({ days }));
    }
  } finally {
    await prisma.$disconnect();
  }
}

function print(title: string, payload: unknown) {
  console.log(`\n━━━ ${title} ━━━`);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
  console.error('eval-vision failed:', e);
  process.exit(1);
});
