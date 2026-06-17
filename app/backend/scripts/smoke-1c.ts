/**
 * Smoke test for Nutrition Phase 1C — runs entirely against a throwaway,
 * EMBEDDED local Postgres. It NEVER reads .env and NEVER touches production.
 *
 *   npx ts-node --transpile-only scripts/smoke-1c.ts
 *
 * It boots a local PG, applies the real migrations (0_init → 1a → 1c) via raw
 * SQL, seeds a handful of foods, and exercises the real FoodService +
 * LogsService end-to-end: search (accent/typo), favorites, custom foods, and
 * catalog logging → recents/frequents.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Killing the embedded PG makes the still-open pg Pool emit "Connection
// terminated" after the assertions already finished — harmless teardown noise.
const ignoreTeardownNoise = (e: any) => {
  if (String(e?.message ?? e).includes('Connection terminated')) return;
  throw e;
};
process.on('uncaughtException', ignoreTeardownNoise);
process.on('unhandledRejection', ignoreTeardownNoise);

// ── Point everything at a local, disposable database BEFORE importing Prisma ──
const PORT = 59432;
const DB = 'vitals_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');

import { PrismaService } from '../src/prisma/prisma.service';
import { LocalFoodAdapter, normalizeFood } from '../src/food/adapters/local.adapter';
import { FoodService } from '../src/food/food.service';
import { LogsService } from '../src/logs/logs.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

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
  for (const d of dirs) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, d, 'migration.sql'), 'utf8');
    await client.query(sql);
    console.log(`   · applied ${d}`);
  }
  await client.end();
}

async function seedFoods(prisma: PrismaService) {
  const foods = [
    { name: 'Pechuga de pollo', aliases: ['pollo'], cal: 165, p: 31, c: 0, f: 3.6, common: true },
    { name: 'Brócoli', aliases: ['brocoli'], cal: 34, p: 2.8, c: 7, f: 0.4, common: true },
    { name: 'Plátano maduro', aliases: ['platano', 'banana'], cal: 89, p: 1.1, c: 23, f: 0.3, common: true },
    { name: 'Arroz blanco cocido', aliases: ['arroz'], cal: 130, p: 2.7, c: 28, f: 0.3, common: true },
    { name: 'Atún en agua', aliases: ['atun'], cal: 116, p: 26, c: 0, f: 1, common: true },
    { name: 'Manzana', aliases: ['manzana roja'], cal: 52, p: 0.3, c: 14, f: 0.2, common: false },
  ];
  const ids: Record<string, string> = {};
  for (const fd of foods) {
    const row = await prisma.foodItem.create({
      data: {
        name: fd.name,
        nameLower: fd.name.toLowerCase(),
        nameNormalized: normalizeFood(fd.name),
        nameAliases: fd.aliases,
        caloriesPer100g: fd.cal,
        proteinPer100g: fd.p,
        carbsPer100g: fd.c,
        fatPer100g: fd.f,
        fiberPer100g: 0,
        source: 'curated_latam',
        isVerified: true,
        isCommon: fd.common,
      },
    });
    ids[fd.name] = row.id;
  }
  return ids;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
  });

  console.log('▶ Booting embedded Postgres…');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);

  console.log('▶ Applying migrations (0_init → 1a → 1c)…');
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();

  console.log('▶ Seeding foods…');
  const ids = await seedFoods(prisma);

  const food = new FoodService(new LocalFoodAdapter(prisma));
  const logs = new LogsService(prisma, new EventEmitter2());

  const user = await prisma.user.create({ data: { email: 'smoke@test.local' } });
  const uid = user.id;

  console.log('\n── SMOKE ASSERTIONS ──');

  // 1. Búsqueda con acento (query sin acento debe encontrar "Brócoli")
  const r1 = await food.search('brocoli', 15, uid);
  check('search "brocoli" → encuentra Brócoli (acento)', r1.some((f) => f.name === 'Brócoli'));

  // 2. Búsqueda con typo (levenshtein)
  const r2 = await food.search('brocli', 15, uid);
  check('search "brocli" (typo) → encuentra Brócoli', r2.some((f) => f.name === 'Brócoli'));

  // 3. Búsqueda por alias
  const r3 = await food.search('banana', 15, uid);
  check('search "banana" (alias) → encuentra Plátano maduro', r3.some((f) => f.name === 'Plátano maduro'));

  // 4. Favorito: marcar y persistir
  await food.addFavorite(uid, ids['Brócoli']);
  const favs = await food.getFavorites(uid);
  check('favorito persiste en getFavorites', favs.some((f) => f.id === ids['Brócoli']));
  const r4 = await food.search('brocoli', 15, uid);
  check('search refleja isFavorite=true', !!r4.find((f) => f.id === ids['Brócoli'])?.isFavorite);

  // 5. Registro desde catálogo → guarda foodItemId
  await logs.logMeal(uid, { mealType: 'LUNCH', items: [{ foodItemId: ids['Pechuga de pollo'], quantity: 150, unit: 'g' }] } as any);
  const persistedItem = await prisma.loggedMealItem.findFirst({ where: { foodItemId: ids['Pechuga de pollo'] } });
  check('logMeal guarda LoggedMealItem.foodItemId', !!persistedItem, `foodItemId=${persistedItem?.foodItemId ?? 'null'}`);
  check('macros calculados en server (165*1.5≈248)', persistedItem?.calories === 248, `calories=${persistedItem?.calories}`);

  // 6. Recientes: el pollo registrado aparece
  const recent = await food.getRecent(uid);
  check('getRecent incluye Pechuga de pollo', recent.some((f) => f.id === ids['Pechuga de pollo']));

  // 7. Frecuentes: requiere umbral mínimo de registros (no aparece con pocos).
  await logs.logMeal(uid, { mealType: 'DINNER', items: [{ foodItemId: ids['Pechuga de pollo'], quantity: 100, unit: 'g' }] } as any);
  const frequentAt2 = await food.getFrequent(uid); // pollo lleva 2 registros
  check('getFrequent NO incluye pollo con 2 registros (bajo umbral)', !frequentAt2.some((f) => f.id === ids['Pechuga de pollo']));
  await logs.logMeal(uid, { mealType: 'SNACK', items: [{ foodItemId: ids['Pechuga de pollo'], quantity: 50, unit: 'g' }] } as any);
  const frequent = await food.getFrequent(uid); // pollo llega a 3 registros
  check('getFrequent incluye pollo al alcanzar el umbral (3)', frequent.some((f) => f.id === ids['Pechuga de pollo']));

  // 8. Custom food: crear, buscar y registrar
  const custom = await food.createCustom(uid, {
    name: 'Granola casera', caloriesPer100g: 471, proteinPer100g: 10, carbsPer100g: 64, fatPer100g: 20,
  });
  check('createCustom devuelve alimento', !!custom?.id, `id=${custom?.id}`);
  const r5 = await food.search('granola', 15, uid);
  check('custom food es buscable por su dueño', r5.some((f) => f.id === custom.id));
  await logs.logMeal(uid, { mealType: 'SNACK', items: [{ foodItemId: custom.id, quantity: 50, unit: 'g' }] } as any);
  const recent2 = await food.getRecent(uid);
  check('custom food reutilizable → aparece en recientes', recent2.some((f) => f.id === custom.id));

  // 9. Aislamiento: otro usuario NO ve el custom food ajeno
  const other = await prisma.user.create({ data: { email: 'other@test.local' } });
  const r6 = await food.search('granola', 15, other.id);
  check('custom food NO visible para otro usuario (privacidad)', !r6.some((f) => f.id === custom.id));

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke 1C`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
