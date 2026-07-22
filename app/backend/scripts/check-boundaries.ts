/**
 * Architectural boundary checker (V5.4).
 *
 * WHY A CUSTOM CHECKER INSTEAD OF dependency-cruiser: this codebase's rules
 * are not generic layering conventions — they are SPECIFIC, documented
 * invariants earned slice by slice (V0 through V5.3):
 *
 *   · LogsService is the only producer of LoggedMeal — Vision may never write it.
 *   · Vision consumes Food; Food must never import Vision (V3.1's dependency
 *     direction rule, solved with a primitive interface rather than a cycle).
 *   · The Copilot Runtime consumes CONTRACTS, never PrismaService (V5.0).
 *   · The read-only governance subsystems (learning, rollout, governance,
 *     promotion, rollback, canary) observe; they never import the write path.
 *   · Pure pipeline modules must stay pure — no Prisma, no Nest DI.
 *
 * A generic tool would need all of this expressed in its own config dialect
 * anyway, and would not carry the REASON each rule exists. Encoding them here
 * keeps the rule and its justification in one place, and turns architectural
 * discipline into a gate that fails a build instead of a convention that
 * relies on memory.
 *
 *   npm run check:boundaries
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');

interface Rule {
  name: string;
  why: string;
  /** files this rule applies to (path fragments, POSIX separators) */
  appliesTo: (file: string) => boolean;
  /** an import is a violation when this returns true */
  forbids: (importPath: string) => boolean;
}

const RULES: Rule[] = [
  {
    name: 'Food must never import Vision',
    why: 'V3.1 dependency direction: Vision consumes the food catalog; the catalog knows nothing about Vision. Reversing it creates the cycle that primitive interface was introduced to avoid.',
    appliesTo: (f) => f.startsWith('food/'),
    forbids: (i) => /(^|\/)vision\//.test(i) || i.includes('vision-contract'),
  },
  {
    name: 'The Copilot Runtime must not import PrismaService',
    why: 'V5.0: the Copilot is a consumer of CONTRACTS. Touching the database directly would make it a second source of truth instead of a coordinator.',
    appliesTo: (f) => f.startsWith('copilot/'),
    forbids: (i) => i.includes('prisma'),
  },
  {
    name: 'Vision must not import the meal write path directly',
    why: 'LogsService.logMeal is the only producer of LoggedMeal. Vision reaches it through the service (injected), never by importing logs internals.',
    appliesTo: (f) => f.startsWith('vision/') && !f.includes('vision-scan.service'),
    forbids: (i) => /logs\/(dto|logs\.controller)/.test(i),
  },
  {
    name: 'Pure pipeline modules must stay pure',
    why: 'Every pipeline/ module is a pure function of its inputs — that is what makes determinism testable and reports reproducible. A Prisma or Nest import there breaks the guarantee silently.',
    appliesTo: (f) => f.includes('/pipeline/'),
    forbids: (i) => i.includes('prisma') || i === '@nestjs/common' || i === '@nestjs/core',
  },
  {
    name: 'Read-only governance subsystems must not import the write path',
    why: 'V4.0–V4.4: rollout, governance, promotion, rollback and canary OBSERVE. Importing logs or a mutating service would let an observer become an actor.',
    appliesTo: (f) => /^vision\/(rollout|governance|promotion|rollback|canary)\//.test(f),
    forbids: (i) => i.includes('logs.service') || i.includes('logs/logs'),
  },
  {
    name: 'Contracts must not import Prisma',
    why: 'Every types/ contract is the anti-corruption boundary: a schema change must never silently change a published contract.',
    appliesTo: (f) => f.includes('/types/'),
    forbids: (i) => i.includes('@prisma/client') || i.includes('prisma.service'),
  },
];

/**
 * KNOWN, PRE-EXISTING violations — the ratchet.
 *
 * Introducing a boundary checker to a codebase that predates it always finds
 * debt. Weakening the rule to make the tool green would defeat its purpose;
 * blocking CI on debt this slice is forbidden to touch would make it useless.
 * So known violations are pinned here EXPLICITLY: the build stays green, no
 * NEW violation can be added, and the debt is visible in code review instead
 * of forgotten.
 *
 * These two contracts import Prisma-generated enums (BehaviorFlag,
 * PlateauStatus) directly. The project's own newer standard rejects this —
 * CoachingContext (2C.0) states "It imports NOTHING from @prisma/client" and
 * pins its own vocabularies (CtxBehaviorFlag, CtxPlateau) for exactly this
 * reason. Fixing these is a nutrition-state change, which V5.4 explicitly
 * freezes; tracked in the docs as recommended future work.
 */
const BASELINE: { file: string; importPath: string }[] = [
  { file: 'nutrition-state/types/intelligence-snapshot.ts', importPath: '@prisma/client' },
  { file: 'nutrition-state/types/weekly-ledger.ts', importPath: '@prisma/client' },
];

function isBaselined(file: string, importPath: string): boolean {
  return BASELINE.some((b) => b.file === file && b.importPath === importPath);
}

interface Violation {
  file: string;
  importPath: string;
  rule: Rule;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Import specifiers only — comments and strings that merely mention a path are ignored. */
function extractImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

export function findViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const absolute of walk(SRC)) {
    const relative = path.relative(SRC, absolute).split(path.sep).join('/');
    const source = fs.readFileSync(absolute, 'utf8');
    const imports = extractImports(source);

    for (const rule of RULES) {
      if (!rule.appliesTo(relative)) continue;
      for (const importPath of imports) {
        // Normalize so '../../prisma/prisma.service' and 'src/prisma/...' both match.
        const normalized = importPath.split(path.sep).join('/');
        if (rule.forbids(normalized) && !isBaselined(relative, importPath)) {
          violations.push({ file: relative, importPath, rule });
        }
      }
    }
  }
  return violations;
}

if (require.main === module) {
  console.log('━━━ ARCHITECTURAL BOUNDARIES ━━━\n');
  const violations = findViolations();

  for (const rule of RULES) {
    const broken = violations.filter((v) => v.rule.name === rule.name);
    console.log(`${broken.length === 0 ? '✅' : '❌'} ${rule.name}`);
    if (broken.length > 0) {
      console.log(`   ↳ ${rule.why}`);
      for (const v of broken) console.log(`   ✗ ${v.file} imports "${v.importPath}"`);
    }
  }

  if (BASELINE.length > 0) {
    console.log(`\nℹ️  ${BASELINE.length} violación(es) preexistente(s) en baseline (deuda conocida, no bloquean):`);
    for (const b of BASELINE) console.log(`   · ${b.file} → "${b.importPath}"`);
    console.log('   El trinquete impide añadir NUEVAS; ver docs/adr/ para el plan de pago.');
  }

  console.log(
    `\n${violations.length === 0 ? '🎉 Todos los límites respetados' : `⚠️  ${violations.length} violación(es) NUEVA(S)`} — ${RULES.length} regla(s) verificada(s).`,
  );
  process.exit(violations.length === 0 ? 0 : 1);
}
