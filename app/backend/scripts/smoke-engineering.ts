/**
 * Smoke test for V5.4 — Engineering Foundation.
 *
 *   npm run smoke:engineering
 *
 * Verifies that the ENGINEERING PROCESS itself is wired and reproducible: CI
 * exists and covers every gate, the scripts a new developer needs are present,
 * lint/format/typecheck actually run, OpenAPI is mounted, the ADR standard
 * exists, and the architectural boundaries hold.
 *
 * This suite is deliberately fast (no database): it is the first thing CI runs,
 * so a broken pipeline fails in seconds rather than after 20 embedded-Postgres
 * suites.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { findViolations } from './check-boundaries';

const BACKEND = path.join(__dirname, '..');
const REPO = path.join(BACKEND, '..', '..');

let failures = 0;
function check(label: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
}

const read = (p: string): string => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const exists = (p: string): boolean => fs.existsSync(p);

function main() {
  const pkg = JSON.parse(read(path.join(BACKEND, 'package.json')) || '{}');
  const scripts: Record<string, string> = pkg.scripts ?? {};

  console.log('── V5.4: NPM SCRIPTS (one documented sequence for a new developer) ──');
  for (const s of ['lint', 'lint:fix', 'format', 'format:check', 'typecheck', 'build', 'check:boundaries', 'verify']) {
    check(`script "${s}" existe`, !!scripts[s]);
  }
  check(
    '"verify" encadena las puertas de calidad en un solo comando',
    /lint/.test(scripts.verify ?? '') &&
      /typecheck/.test(scripts.verify ?? '') &&
      /boundaries/.test(scripts.verify ?? ''),
  );
  const smokeScripts = Object.keys(scripts).filter((s) => s.startsWith('smoke:'));
  check('las 21 suites de smoke siguen registradas', smokeScripts.length >= 21, `${smokeScripts.length}`);

  console.log('\n── V5.4: LINT + FORMAT (config presente, consistente, sin pelear entre sí) ──');
  const eslintConfig = read(path.join(BACKEND, 'eslint.config.mjs'));
  check('existe eslint.config.mjs (flat config, ESLint 9)', eslintConfig.length > 0);
  check(
    'eslint-config-prettier va AL FINAL — formato es trabajo de Prettier, no de ESLint',
    /prettier,\s*\);?\s*$/.test(eslintConfig.trim()),
  );
  check(
    'los scripts quedan más laxos que src/ (fixtures parciales a propósito)',
    eslintConfig.includes("files: ['scripts/**/*.ts']"),
  );
  check('existe .prettierrc.json en la raíz (una sola fuente de formato)', exists(path.join(REPO, '.prettierrc.json')));
  check('existe .prettierignore', exists(path.join(REPO, '.prettierignore')));
  const devDeps = pkg.devDependencies ?? {};
  for (const d of ['eslint', 'typescript-eslint', 'prettier', 'eslint-config-prettier', 'husky', 'lint-staged']) {
    check(`devDependency "${d}" declarada`, !!devDeps[d]);
  }

  console.log('\n── V5.4: PRE-COMMIT (el proceso depende de tooling, no de memoria) ──');
  const hook = read(path.join(REPO, '.husky', 'pre-commit'));
  check('existe el hook .husky/pre-commit', hook.length > 0);
  check(
    'el hook corre lint-staged, typecheck y boundaries',
    hook.includes('lint-staged') && hook.includes('typecheck') && hook.includes('check:boundaries'),
  );
  check('el hook FALLA el commit ante error (exit 1, no solo aviso)', /exit 1/.test(hook));
  check('el hook NO corre las 21 suites (un hook lento se saltea con --no-verify)', !hook.includes('smoke:vision'));
  check('lint-staged configurado en package.json', !!pkg['lint-staged'] && !!pkg['lint-staged']['*.ts']);

  console.log('\n── V5.4: CI (todo automatizado, falla ante cualquier error) ──');
  const ci = read(path.join(REPO, '.github', 'workflows', 'ci.yml'));
  check('existe .github/workflows/ci.yml', ci.length > 0);
  check('corre en push Y en pull_request', ci.includes('push:') && ci.includes('pull_request:'));
  for (const step of [
    'npm run lint',
    'npm run format:check',
    'npm run typecheck',
    'npm run check:boundaries',
    'npm run build',
  ]) {
    check(`CI ejecuta "${step}"`, ci.includes(step));
  }
  check(
    'CI hace typecheck de mobile en un job propio',
    ci.includes('Mobile typecheck') && ci.includes('npx tsc --noEmit'),
  );
  check(
    'CI ejecuta TODAS las suites de smoke',
    smokeScripts.every((s) => ci.includes(`npm run ${s}`)),
    `${smokeScripts.filter((s) => !ci.includes(`npm run ${s}`)).join(',') || 'todas'}`,
  );
  check('el job de smokes depende del estático (fallo de lint no gasta 20 Postgres)', ci.includes('needs: static'));
  check('cancela runs superseded en la misma rama', ci.includes('cancel-in-progress: true'));
  check('CI usa --legacy-peer-deps (conflicto de peers documentado del repo)', ci.includes('--legacy-peer-deps'));
  check('CI corre prisma generate antes de compilar/testear', ci.includes('npx prisma generate'));

  console.log('\n── V5.4: OPENAPI (solo documentación, sin cambio de comportamiento) ──');
  const mainTs = read(path.join(BACKEND, 'src', 'main.ts'));
  check('@nestjs/swagger declarado como dependencia', !!(pkg.dependencies ?? {})['@nestjs/swagger']);
  check(
    'OpenAPI montado en /api/docs',
    mainTs.includes("SwaggerModule.setup('api/docs'") || mainTs.includes('api/docs'),
  );
  check(
    'APAGADO en producción salvo opt-in explícito',
    mainTs.includes("NODE_ENV !== 'production'") && mainTs.includes('SWAGGER_ENABLED'),
  );
  check('el documento declara auth Bearer', mainTs.includes('addBearerAuth'));
  check('advierte que los endpoints de gobernanza son de OPERADOR', mainTs.includes('OPERATOR-only'));

  console.log('\n── V5.4: ADR (estándar para decisiones futuras) ──');
  const adrDir = path.join(REPO, 'docs', 'adr');
  check('existe docs/adr/', exists(adrDir));
  check('existe la plantilla', exists(path.join(adrDir, 'template.md')));
  const template = read(path.join(adrDir, 'template.md'));
  check(
    'la plantilla exige alternativas consideradas (evita reproponer lo descartado)',
    template.includes('Alternativas consideradas'),
  );
  check('la plantilla exige consecuencias NEGATIVAS explícitas', template.includes('Negativas'));
  check('la plantilla exige cuándo revisar la decisión', template.includes('Cuándo revisar'));
  const adrReadme = read(path.join(adrDir, 'README.md'));
  check(
    'el README define estados y el proceso de superseding',
    adrReadme.includes('Superseded by') && adrReadme.includes('inmutable'),
  );
  check(
    'NO se migraron los docs existentes (decisión explícita)',
    adrReadme.includes('No se migran los documentos existentes'),
  );
  const adrs = fs.readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f));
  check('existen ADRs iniciales que ejercitan el estándar', adrs.length >= 2, adrs.join(', '));

  console.log('\n── V5.4: LÍMITES ARQUITECTÓNICOS ──');
  const violations = findViolations();
  check(
    'cero violaciones NUEVAS de límites',
    violations.length === 0,
    violations.map((v) => `${v.file}→${v.importPath}`).join(', '),
  );
  const boundarySrc = read(path.join(BACKEND, 'scripts', 'check-boundaries.ts'));
  check(
    'el checker codifica las invariantes documentadas del proyecto',
    [
      'Food must never import Vision',
      'Copilot Runtime must not import PrismaService',
      'Pure pipeline modules must stay pure',
    ].every((r) => boundarySrc.includes(r)),
  );
  check('cada regla lleva su JUSTIFICACIÓN, no solo el patrón', (boundarySrc.match(/why:/g) ?? []).length >= 6);
  check(
    'el baseline es explícito y se imprime siempre (no silencia en secreto)',
    boundarySrc.includes('BASELINE') && boundarySrc.includes('preexistente'),
  );

  console.log('\n── V5.4: LAS PUERTAS CORREN DE VERDAD (no solo están configuradas) ──');
  const run = (cmd: string): boolean => {
    try {
      execSync(cmd, { cwd: BACKEND, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
  check('`npm run lint` pasa (0 errores)', run('npm run lint'));
  check('`npm run format:check` pasa', run('npm run format:check'));
  check('`npm run typecheck` pasa', run('npm run typecheck'));

  console.log(
    `\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Engineering Foundation (V5.4)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
