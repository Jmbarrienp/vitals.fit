/**
 * Deployment preflight (V5.3) — the reproducible gate that runs BEFORE any
 * migration is applied to a real database.
 *
 *   npm run preflight
 *
 * It answers the question that has been open since the platform started
 * shipping: "am I about to migrate the database I THINK I am?" The recorded
 * risk was concrete — production may have pointed at the same Supabase
 * instance as local `.env`, where seed/test data was created. Applying
 * migrations or, worse, a seed to the wrong database is not recoverable from
 * the application side.
 *
 * READ-ONLY: this script executes no DDL, no seed and no migration. It
 * inspects and reports, then exits non-zero if the target looks unsafe.
 * Credentials are NEVER printed — the connection is identified by host,
 * database name and a short fingerprint.
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const { Client } = require('pg');

/** Rows that only ever come from tests/seeds. Their presence in production is a red flag. */
const TEST_EMAIL_PATTERNS = ['%@test.local', '%@example.com'];

interface Finding {
  level: 'INFO' | 'WARN' | 'BLOCK';
  message: string;
}

const findings: Finding[] = [];
const info = (m: string) => findings.push({ level: 'INFO', message: m });
const warn = (m: string) => findings.push({ level: 'WARN', message: m });
const block = (m: string) => findings.push({ level: 'BLOCK', message: m });

/** Host + database + a stable fingerprint, with credentials stripped. */
function describeTarget(url: string): { host: string; database: string; fingerprint: string; isLocal: boolean } {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(default)';
    const host = parsed.hostname;
    return {
      host,
      database,
      fingerprint: createHash('sha256').update(`${host}/${database}`).digest('hex').slice(0, 12),
      isLocal: ['localhost', '127.0.0.1', '::1'].includes(host),
    };
  } catch {
    return { host: '(unparseable)', database: '(unknown)', fingerprint: 'unknown', isLocal: false };
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';

  console.log('━━━ PREFLIGHT — Nutrition Platform ━━━\n');

  if (!url) {
    block('DATABASE_URL no está definida. Nada que verificar.');
    return report(1);
  }

  const target = describeTarget(url);
  console.log(`  entorno:      ${nodeEnv}`);
  console.log(`  host:         ${target.host}`);
  console.log(`  base:         ${target.database}`);
  console.log(`  fingerprint:  ${target.fingerprint}`);
  console.log(`  (las credenciales nunca se imprimen)\n`);

  // Confirmación explícita del objetivo: el operador declara el fingerprint
  // esperado y el script verifica que coincide. Así un DATABASE_URL cambiado
  // por accidente no pasa desapercibido.
  const expected = process.env.EXPECTED_DB_FINGERPRINT;
  if (expected && expected !== target.fingerprint) {
    block(
      `El fingerprint NO coincide con EXPECTED_DB_FINGERPRINT (esperado ${expected}, real ${target.fingerprint}). Estás apuntando a otra base.`,
    );
  } else if (expected) {
    info(`Fingerprint confirmado contra EXPECTED_DB_FINGERPRINT.`);
  } else {
    warn(
      'EXPECTED_DB_FINGERPRINT no está definida — no se puede confirmar que esta sea la base pretendida. Defínela para blindar futuros despliegues.',
    );
  }

  if (isProduction && target.isLocal) {
    block('NODE_ENV=production pero DATABASE_URL apunta a localhost.');
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    info('Conexión establecida.');
  } catch (err) {
    block(`No se pudo conectar: ${err instanceof Error ? err.message : err}`);
    return report(1);
  }

  try {
    // ── Estado de migraciones (leído de la tabla, no del CLI) ──
    const applied = await client
      .query(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`)
      .catch(() => null);

    if (!applied) {
      warn('No existe _prisma_migrations — esta base nunca ha sido migrada (base nueva o equivocada).');
    } else {
      const finished = applied.rows.filter((r: any) => r.finished_at && !r.rolled_back_at);
      const failed = applied.rows.filter((r: any) => !r.finished_at || r.rolled_back_at);
      info(`Migraciones aplicadas: ${finished.length}.`);
      if (failed.length > 0) {
        block(
          `Hay ${failed.length} migración(es) fallida(s) o revertida(s): ${failed.map((r: any) => r.migration_name).join(', ')}. Resuélvelas antes de continuar.`,
        );
      }

      const local = execSync(
        "node -e \"const fs=require('fs');console.log(fs.readdirSync('prisma/migrations').filter(d=>fs.existsSync(`prisma/migrations/${d}/migration.sql`)).sort().join(','))\"",
      )
        .toString()
        .trim();
      const localNames = local ? local.split(',') : [];
      const appliedNames = new Set(finished.map((r: any) => r.migration_name));
      const pending = localNames.filter((n) => !appliedNames.has(n));
      if (pending.length > 0) {
        warn(`PENDIENTES (${pending.length}): ${pending.join(', ')}`);
        console.log('\n  → aplicar con:  npm run migrate:deploy\n');
      } else {
        info('No hay migraciones pendientes.');
      }
    }

    // ── Detección de datos de prueba / seed ──
    const users = await client.query('SELECT COUNT(*)::int AS n FROM "User"').catch(() => ({ rows: [{ n: -1 }] }));
    const userCount = users.rows[0].n;
    if (userCount >= 0) info(`Usuarios en la base: ${userCount}.`);

    let testUsers = 0;
    for (const pattern of TEST_EMAIL_PATTERNS) {
      const r = await client
        .query('SELECT COUNT(*)::int AS n FROM "User" WHERE email LIKE $1', [pattern])
        .catch(() => ({ rows: [{ n: 0 }] }));
      testUsers += r.rows[0].n;
    }
    if (testUsers > 0) {
      const message = `Se detectaron ${testUsers} usuario(s) de prueba (@test.local / @example.com) en esta base.`;
      // En producción esto es exactamente el riesgo registrado: datos de
      // prueba conviviendo con cuentas reales.
      if (isProduction)
        block(`${message} En producción esto indica que una suite de pruebas o un seed corrió contra la base real.`);
      else warn(message);
    } else {
      info('Sin usuarios de prueba detectados.');
    }

    const meals = await client
      .query('SELECT COUNT(*)::int AS n FROM "LoggedMeal"')
      .catch(() => ({ rows: [{ n: -1 }] }));
    if (meals.rows[0].n >= 0) info(`Comidas registradas: ${meals.rows[0].n}.`);

    const foods = await client.query('SELECT COUNT(*)::int AS n FROM "FoodItem"').catch(() => ({ rows: [{ n: -1 }] }));
    if (foods.rows[0].n === 0)
      warn('El catálogo de alimentos está VACÍO — la app no podrá buscar comida. ¿Falta el seed?');
    else if (foods.rows[0].n > 0) info(`Alimentos en catálogo: ${foods.rows[0].n}.`);

    // Producción con la base vacía de usuarios pero con migraciones aplicadas
    // es normal (primer deploy); con usuarios reales exige más cuidado.
    if (isProduction && userCount > 0) {
      warn(
        `Esta base de PRODUCCIÓN ya tiene ${userCount} usuario(s). Confirma que existe un backup reciente antes de migrar.`,
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  const blockers = findings.filter((f) => f.level === 'BLOCK').length;
  return report(blockers > 0 ? 1 : 0);
}

function report(code: number): number {
  console.log('\n━━━ RESULTADO ━━━');
  for (const f of findings) {
    const icon = f.level === 'BLOCK' ? '⛔' : f.level === 'WARN' ? '⚠️ ' : '✅';
    console.log(`${icon} ${f.message}`);
  }
  const blockers = findings.filter((f) => f.level === 'BLOCK').length;
  const warns = findings.filter((f) => f.level === 'WARN').length;
  console.log(
    `\n${blockers > 0 ? '⛔ PREFLIGHT FALLIDO' : '✅ PREFLIGHT OK'} — ${blockers} bloqueante(s), ${warns} advertencia(s).`,
  );
  if (blockers > 0) console.log('   NO continúes con el despliegue hasta resolver los bloqueantes.');
  process.exitCode = code;
  return code;
}

main().catch((e) => {
  console.error('preflight crashed:', e);
  process.exit(1);
});
