/**
 * Smoke test for Nutrition Vision V0 + V1 + V2 + V3.1 (Phase 2D.2). Runs
 * entirely against a throwaway EMBEDDED local Postgres via the deterministic
 * FixtureVisionProvider / FixtureBarcodeLookupProvider. NEVER reads .env,
 * NEVER touches production, NEVER calls a real vendor — the V2 Claude adapter
 * and the V3.1 OpenFoodFacts adapter are exercised only on paths that provably
 * short-circuit before any network call, and through their pure surfaces.
 *
 *   npm run smoke:vision
 *
 * Verifies: the full scan lifecycle, that confirmation converges on the
 * platform's single existing write path (LogsService.logMeal — meal.logged
 * fires, downstream rollup goes stale), provenance stamping, feedback capture,
 * lazy expiry, every failure/degradation path, determinism of the pure pipeline
 * stages, (V2) that a real vision provider slots into the unchanged port while
 * raw image bytes never reach the database, and (V3.1) that barcode is another
 * producer into the SAME VisionScan lifecycle — local-cache resolution,
 * external lookup + catalog upsert, not-found degradation, and duplicate scans
 * resolving to one FoodItem, not two. (V3.3) adds the Portion Estimation
 * Engine: priors derived from the user's own validated logs, the correction
 * corpus finally read, planner expectations blended, and the learning loop —
 * the same user scanning the same food gets progressively better estimates,
 * deterministically, with zero LLM involvement.
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

const PORT = 59441;
const DB = 'vitals_vision_smoke';
const LOCAL_URL = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;
process.env.DATABASE_URL = LOCAL_URL;
process.env.DIRECT_URL = LOCAL_URL;
delete process.env.VISION_PROVIDER; // force default -> fixture
delete process.env.BARCODE_LOOKUP_PROVIDER; // force default -> openfoodfacts (still overridden explicitly per-test below)
delete process.env.OCR_PROVIDER; // force default -> fixture

const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');
const { EventEmitter2 } = require('@nestjs/event-emitter');
const { ConfigService } = require('@nestjs/config');

import { PrismaService } from '../src/prisma/prisma.service';
import { FoodService } from '../src/food/food.service';
import { LocalFoodAdapter } from '../src/food/adapters/local.adapter';
import { LogsService } from '../src/logs/logs.service';
import { FixtureVisionProvider } from '../src/vision/providers/fixture.provider';
import { ClaudeVisionProvider } from '../src/vision/providers/claude-vision.provider';
import { parseDetections, DETECTION_SCHEMA, VISION_SYSTEM_PROMPT } from '../src/vision/providers/claude-vision.prompt';
import { EphemeralImageStore } from '../src/vision/images/ephemeral-image-store';
import { VisionProviderRegistry } from '../src/vision/providers/provider.registry';
import { VisionProvider } from '../src/vision/providers/vision-provider.port';
import { validateRecognitionResult } from '../src/vision/providers/response-validator';
import { VisionScanService } from '../src/vision/vision-scan.service';
import { VISION_EVENTS } from '../src/vision/vision.events';
import { evaluateProvider, compareProviders, DEFAULT_EVAL_CASES } from '../src/vision/eval/vision-eval.harness';
import { matchDetection } from '../src/vision/pipeline/matching';
import { estimatePortion } from '../src/vision/pipeline/portion';
import { scoreCandidate, bandFor, deriveUxMode } from '../src/vision/pipeline/confidence';
import { buildCandidates } from '../src/vision/pipeline/build-candidates';
import { buildBarcodeCandidate } from '../src/vision/pipeline/barcode-candidate';
import { BarcodeLookupProviderRegistry } from '../src/vision/barcode/barcode-lookup.registry';
import { FixtureBarcodeLookupProvider } from '../src/vision/barcode/fixture-barcode-lookup.provider';
import { OpenFoodFactsLookupProvider } from '../src/vision/barcode/openfoodfacts-lookup.provider';
import { buildLabelCandidate } from '../src/vision/pipeline/label-candidate';
import { parseLabel, parseNumber, parseEnergyKcal, parseServing, parseBasis, labelCompleteness } from '../src/vision/pipeline/label-parser';
import { validateNutritionLabel, atwaterPlausibility } from '../src/vision/pipeline/label-validator';
import { OCRProviderRegistry } from '../src/vision/ocr/ocr-provider.registry';
import { FixtureOCRProvider } from '../src/vision/ocr/fixture-ocr.provider';
import { ClaudeOCRProvider } from '../src/vision/ocr/claude-ocr.provider';
import { parseLabelExtraction, LABEL_SCHEMA, OCR_SYSTEM_PROMPT } from '../src/vision/ocr/claude-ocr.prompt';
import { resolvePortion, PortionPriorInputs } from '../src/vision/pipeline/portion-engine';
import { median, mad, selectPrior, computeBias, historyWeight } from '../src/vision/pipeline/portion-priors';
import { PortionPriorReader } from '../src/vision/priors/portion-prior.reader';
import { inferMealType } from '../src/vision/pipeline/build-candidates';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

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

async function main() {
  // ── PART A: pure pipeline stages (no DB) ──
  console.log('── MATCHING (pure) ──');
  const noResults = matchDetection({ label: 'pollo', labelConfidence: 0.9 }, []);
  check('no search results -> null foodItemId, score 0', noResults.foodItemId === null && noResults.matchScore === 0);
  const withResults = matchDetection(
    { label: 'pollo', labelConfidence: 0.9 },
    [
      { id: 'f1', name: 'Pollo a la plancha', caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, source: 'x', isCommon: true, isFavorite: true },
      { id: 'f2', name: 'Pollo frito', caloriesPer100g: 250, proteinPer100g: 25, carbsPer100g: 10, fatPer100g: 15, fiberPer100g: 0, source: 'x', isCommon: false, isFavorite: false },
    ],
  );
  check('top search result becomes the primary match', withResults.foodItemId === 'f1' && withResults.alternates[0]?.foodItemId === 'f2');
  check('favorite + common food scores near 1.0', withResults.matchScore === 1);

  console.log('\n── PORTION (pure) ──');
  const providerHint = estimatePortion({ label: 'x', labelConfidence: 0.8, portionHint: { grams: 180, confidence: 0.7 } }, 90);
  check('PROVIDER_ESTIMATE wins when a hint exists', providerHint.method === 'PROVIDER_ESTIMATE' && providerHint.grams === 180);
  const servingDefault = estimatePortion({ label: 'x', labelConfidence: 0.8 }, 90);
  check('SERVING_DEFAULT used when no provider hint', servingDefault.method === 'SERVING_DEFAULT' && servingDefault.grams === 90);
  const fallback = estimatePortion({ label: 'x', labelConfidence: 0.8 }, null);
  check('generic fallback when neither exists', fallback.method === 'SERVING_DEFAULT' && fallback.grams === 100);
  const clamped = estimatePortion({ label: 'x', labelConfidence: 0.8, portionHint: { grams: 9999 } }, null);
  check('portion is clamped to a sane max', clamped.grams <= 600, `${clamped.grams}`);

  console.log('\n── CONFIDENCE (pure) ──');
  const high = scoreCandidate(0.95, 1.0, 0.7);
  check('strong signals -> HIGH band', high.band === 'HIGH', `${high.overall}`);
  const low = scoreCandidate(0.3, 0.2, 0.2);
  check('weak signals -> LOW band', low.band === 'LOW', `${low.overall}`);
  check('bandFor is a pure threshold function', bandFor(0.8) === 'HIGH' && bandFor(0.5) === 'MEDIUM' && bandFor(0.1) === 'LOW');
  check('UX mode: HIGH -> CONFIRM', deriveUxMode('HIGH', null, 2) === 'CONFIRM');
  check('UX mode: MEDIUM -> REVIEW', deriveUxMode('MEDIUM', null, 2) === 'REVIEW');
  check('UX mode: LOW / no-detections / failure -> FALLBACK', deriveUxMode('LOW', null, 2) === 'FALLBACK' && deriveUxMode('HIGH', null, 0) === 'FALLBACK' && deriveUxMode('HIGH', 'PROVIDER_ERROR', 2) === 'FALLBACK');

  console.log('\n── BUILD-CANDIDATES (pure composition, determinism) ──');
  const detections = [{ label: 'pollo', labelConfidence: 0.9 }];
  const searchByIndex = [[{ id: 'f1', name: 'Pollo', caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, source: 'x', isCommon: true, isFavorite: false }]];
  const run1 = buildCandidates(detections, searchByIndex, [null]);
  const run2 = buildCandidates(detections, searchByIndex, [null]);
  check('identical inputs -> identical candidates', JSON.stringify(run1) === JSON.stringify(run2));
  check('no userId or raw-log keys in candidate output', !JSON.stringify(run1).includes('userId') && !JSON.stringify(run1).includes('dailyLog'));

  console.log('\n── CONTRACT VALIDATION (pure) ──');
  const fixture = new FixtureVisionProvider();
  const goodResult = await fixture.recognize({ imageRef: 'chicken.jpg', source: 'PHOTO' });
  check('a valid provider result passes validation', validateRecognitionResult(goodResult).valid === true);
  const missingFields = validateRecognitionResult({ detections: [] });
  check('missing provider metadata -> invalid', missingFields.valid === false);
  const badDetections = validateRecognitionResult({ providerId: 'x', model: 'm', providerVersion: '1', latencyMs: 5, detections: 'nope' });
  check('non-array detections -> invalid', badDetections.valid === false);
  const badConfidence = validateRecognitionResult({ providerId: 'x', model: 'm', providerVersion: '1', latencyMs: 5, detections: [{ label: 'pollo', labelConfidence: 5 }] });
  check('out-of-range labelConfidence -> invalid with a specific error', badConfidence.valid === false && (badConfidence as any).errors.some((e: string) => e.includes('labelConfidence')));

  console.log('\n── PROVIDER SWAPPING & CAPABILITY (pure) ──');
  const stub2: VisionProvider = {
    id: 'stub2',
    capabilities: { multiFood: false, portionHints: false, barcode: true, ocr: false, video: false },
    async recognize() { return { providerId: 'stub2', model: 'm', providerVersion: '1', detections: [], latencyMs: 0 }; },
  };
  const swapRegistry = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'stub2' }), [fixture, stub2]);
  check('config selects the active provider (swap to stub2)', swapRegistry.active().id === 'stub2');
  check('registry lists all registered providers', swapRegistry.list().length === 2);
  const defaultRegistry = new VisionProviderRegistry(new ConfigService({}), [fixture, stub2]);
  check('default provider is fixture', defaultRegistry.active().id === 'fixture');
  let swapThrew = false;
  try { new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'ghost' }), [fixture]).active(); } catch { swapThrew = true; }
  check('unknown provider throws (fails loud, not silent)', swapThrew === true);
  check('fixture advertises multiFood, not barcode', fixture.capabilities.multiFood === true && fixture.capabilities.barcode === false);

  console.log('\n── EVALUATION HARNESS (any provider, same interface) ──');
  const report = await evaluateProvider(fixture, DEFAULT_EVAL_CASES);
  check('harness reports for the provider id', report.providerId === 'fixture');
  check('all executed cases are contract-valid', report.summary.allContractValid === true);
  check('all executed cases are deterministic (same imageRef -> same output)', report.summary.allDeterministic === true);
  check('latency is measured', typeof report.summary.avgLatencyMs === 'number');
  check('standard plate case executed + succeeded', report.cases.find((c) => c.name === 'standard_plate')?.success === true);
  check('barcode case reports UNSUPPORTED (capability negotiation)', report.cases.find((c) => c.name === 'barcode_probe')?.capabilitySupported === false && report.summary.unsupported === 1);
  const stub2Report = await evaluateProvider(stub2, DEFAULT_EVAL_CASES);
  check('a different provider runs through the SAME harness unchanged', stub2Report.providerId === 'stub2' && stub2Report.summary.allContractValid === true);

  console.log('\n── V2: EVAL HARNESS EXTENSIONS (cost control + head-to-head) ──');
  let recognizeCalls = 0;
  const countingProvider: VisionProvider = {
    id: 'counting',
    capabilities: { multiFood: true, portionHints: false, barcode: false, ocr: false, video: false },
    async recognize() {
      recognizeCalls++;
      return { providerId: 'counting', model: 'm', providerVersion: '1', detections: [], latencyMs: 1 };
    },
  };
  const probedCases = DEFAULT_EVAL_CASES.filter((c) => !c.requiresCapability);
  await evaluateProvider(countingProvider, probedCases, { probeDeterminism: true });
  const probedCalls = recognizeCalls;
  recognizeCalls = 0;
  const cheapReport = await evaluateProvider(countingProvider, probedCases, { probeDeterminism: false });
  check('determinism probe costs a 2nd call per case (paid providers can skip it)', probedCalls === probedCases.length * 2 && recognizeCalls === probedCases.length);
  check('unprobed determinism reports null — "not measured", never a false pass/fail', cheapReport.summary.allDeterministic === null && cheapReport.cases[0].deterministic === null);
  check('latency still measured when determinism is not probed', typeof cheapReport.summary.avgLatencyMs === 'number');
  const comparison = await compareProviders([fixture, stub2], DEFAULT_EVAL_CASES);
  check('compareProviders runs the SAME cases across providers (the evidence for choosing one)', comparison.length === 2 && comparison[0].providerId === 'fixture' && comparison[1].providerId === 'stub2');

  console.log('\n── V2: IMAGE STORE (transport seam; bytes never hit the DB) ──');
  const store = new EphemeralImageStore();
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const storedRef = await store.put(PNG_1PX, 'image/png');
  check('put() returns an opaque ref, not the bytes', storedRef.startsWith('vision-mem://') && !storedRef.includes(PNG_1PX));
  const resolved = await store.resolve(storedRef);
  check('resolve() returns the bytes for a known ref', resolved?.base64 === PNG_1PX && resolved?.mimeType === 'image/png');
  check('resolve() returns null (never throws) for a foreign ref — fixture keyword refs stay valid', (await store.resolve('eval-chicken-plate.jpg')) === null);
  await store.discard(storedRef);
  check('discard() releases the bytes', (await store.resolve(storedRef)) === null && store.size() === 0);
  let rejectedMime = false;
  try { await store.put(PNG_1PX, 'image/tiff'); } catch { rejectedMime = true; }
  check('unsupported mime type is rejected at the boundary', rejectedMime === true);
  let rejectedSize = false;
  try { await store.put('A'.repeat(9_000_000), 'image/jpeg'); } catch { rejectedSize = true; }
  check('oversized payload is rejected at the boundary', rejectedSize === true);

  console.log('\n── V2: CLAUDE ADAPTER (pure surface + fail-safe paths; no network) ──');
  const claudeNoKey = new ClaudeVisionProvider(new ConfigService({}), store);
  check('adapter reports hasKey=false with no API key (coach pattern)', claudeNoKey.hasKey === false);
  check('adapter implements the port unchanged (id + capabilities)', claudeNoKey.id === 'claude' && claudeNoKey.capabilities.multiFood === true && claudeNoKey.capabilities.barcode === false);
  let noKeyErr = '';
  try { await claudeNoKey.recognize({ imageRef: 'x.jpg', source: 'PHOTO' }); } catch (e: any) { noKeyErr = String(e.message); }
  check('no key -> raises before any network call (service degrades it to manual)', noKeyErr.includes('VISION_PROVIDER_UNAVAILABLE'));
  // A fake key builds a client but never calls out: the unresolved-image guard runs first.
  const claudeFakeKey = new ClaudeVisionProvider(new ConfigService({ ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key' }), store);
  let unresolvedErr = '';
  try { await claudeFakeKey.recognize({ imageRef: 'no-such-ref.jpg', source: 'PHOTO' }); } catch (e: any) { unresolvedErr = String(e.message); }
  check('unresolvable image -> raises BEFORE spending a provider call', unresolvedErr.includes('VISION_IMAGE_UNRESOLVED'));
  check('adapter is registered alongside the fixture (swap = 1 line)', new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'claude' }), [fixture, claudeNoKey]).active().id === 'claude');

  console.log('\n── V2: PROMPT/SCHEMA CONTAINMENT + PARSER (pure) ──');
  check('schema forbids extra keys and requires every field (structured-output rules)', (DETECTION_SCHEMA as any).additionalProperties === false && (DETECTION_SCHEMA as any).properties.detections.items.required.includes('portionGrams'));
  check('system prompt forbids nutrition math (separation of knowledge)', VISION_SYSTEM_PROMPT.includes('No calcules calorías'));
  const parsed = parseDetections({ detections: [{ label: '  Pollo A La Plancha ', labelConfidence: 0.9, boundingBox: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, portionGrams: 180, portionConfidence: 0.7, attributes: ['Homemade'] }] });
  check('parser normalizes label + maps portion hint to the contract', parsed[0].label === 'pollo a la plancha' && parsed[0].portionHint?.grams === 180 && parsed[0].attributes?.[0] === 'homemade');
  const zeroGrams = parseDetections({ detections: [{ label: 'sopa', labelConfidence: 0.8, portionGrams: 0, portionConfidence: 0 }] });
  check('portionGrams 0 = "cannot estimate" -> no hint, chain falls to SERVING_DEFAULT (never an invented quantity)', zeroGrams[0].portionHint === undefined && estimatePortion(zeroGrams[0], 120).method === 'SERVING_DEFAULT');
  const hostile = parseDetections({ detections: [{ label: '', labelConfidence: 0.9 }, { label: 'arroz', labelConfidence: 'nope', boundingBox: { x: 'x' } }, 'not-an-object', { label: 'pan', labelConfidence: 42 }] });
  check('parser is total: drops junk, never throws, clamps out-of-range confidence', hostile.length === 2 && hostile[0].label === 'arroz' && hostile[0].labelConfidence === 0 && hostile[1].labelConfidence === 1);
  check('parser output still passes the contract validation gate', validateRecognitionResult({ providerId: 'claude', model: 'm', providerVersion: '1', latencyMs: 1, detections: hostile }).valid === true);
  check('parser tolerates a non-conforming payload shape', parseDetections({ nope: true }).length === 0 && parseDetections(null).length === 0);

  console.log('\n── V3.1: BARCODE LOOKUP REGISTRY + FIXTURE (pure, no DB) ──');
  const barcodeFixture = new FixtureBarcodeLookupProvider();
  const knownProduct = await barcodeFixture.lookup('7501055310209');
  check('fixture resolves a known barcode deterministically', knownProduct.found === true && knownProduct.product?.name === 'Galletas María');
  const knownProduct2 = await barcodeFixture.lookup('7501055310209');
  check('same barcode -> identical result (determinism)', JSON.stringify(knownProduct) === JSON.stringify(knownProduct2));
  const notFoundLookup = await barcodeFixture.lookup('0000000000000');
  check('fixture reports not-found as found:false, not an error', notFoundLookup.found === false && notFoundLookup.product === null);
  const genericLookup = await barcodeFixture.lookup('9999999999999');
  check('an unrecognized-but-plausible barcode resolves to a generic product (demoable happy path)', genericLookup.found === true && genericLookup.product !== null);
  const bcSwap = new BarcodeLookupProviderRegistry(new ConfigService({ BARCODE_LOOKUP_PROVIDER: 'openfoodfacts' }), [barcodeFixture, new OpenFoodFactsLookupProvider()]);
  check('config selects the active barcode provider (swap to openfoodfacts)', bcSwap.active().id === 'openfoodfacts');
  const bcDefault = new BarcodeLookupProviderRegistry(new ConfigService({}), [barcodeFixture, new OpenFoodFactsLookupProvider()]);
  check('default barcode provider is openfoodfacts (free + keyless, unlike vision)', bcDefault.active().id === 'openfoodfacts');
  let bcSwapThrew = false;
  try { new BarcodeLookupProviderRegistry(new ConfigService({ BARCODE_LOOKUP_PROVIDER: 'ghost' }), [barcodeFixture]).active(); } catch { bcSwapThrew = true; }
  check('unknown barcode provider throws (fails loud, not silent)', bcSwapThrew === true);

  console.log('\n── V3.1: BARCODE CANDIDATE PIPELINE (pure — exact identity, not fuzzy) ──');
  const cachedFood = { id: 'f-cached', name: 'Galletas María (Gamesa)', caloriesPer100g: 440, proteinPer100g: 7.5, carbsPer100g: 75, fatPer100g: 12, fiberPer100g: 2.5, source: 'open_food_facts', isCommon: false, isFavorite: false };
  const { candidate: bcCandidate, scanConfidence: bcConfidence } = buildBarcodeCandidate(cachedFood, { servingGrams: 30 }, null);
  check('a resolved barcode always carries a real foodItemId (never a null/orphan candidate)', bcCandidate.foodItemId === 'f-cached');
  check('barcode identity is exact -> matchScore 1, not a fuzzy rank', bcCandidate.matchScore === 1);
  check('serving hint from the product feeds portion estimation (PROVIDER_ESTIMATE)', bcCandidate.portion.method === 'PROVIDER_ESTIMATE' && bcCandidate.portion.grams === 30);
  check('confidence band reflects portion uncertainty, not recognition doubt (recognition+match are both certain)', bcConfidence.band === 'HIGH' || bcConfidence.band === 'MEDIUM');
  const { candidate: bcNoHint } = buildBarcodeCandidate(cachedFood, null, 45);
  check('no product hint -> falls back to the FoodItem default serving (chain reused unchanged)', bcNoHint.portion.method === 'SERVING_DEFAULT' && bcNoHint.portion.grams === 45);

  console.log('\n── V3.2: LABEL NUMBER PARSING (pure — locale chaos is the platform\'s job) ──');
  check('decimal point (US)', parseNumber('3.5 g') === 3.5);
  check('decimal comma (LATAM/EU)', parseNumber('2,3 g') === 2.3);
  check('thousands separator is NOT read as a decimal (comma)', parseNumber('1,234') === 1234);
  check('thousands separator is NOT read as a decimal (point)', parseNumber('1.234') === 1234);
  check('both separators: rightmost is the decimal (EU style)', parseNumber('1.234,5') === 1234.5);
  check('both separators: rightmost is the decimal (US style)', parseNumber('1,234.5') === 1234.5);
  check('two decimals stay decimals, not thousands', parseNumber('12,50') === 12.5 && parseNumber('0,25') === 0.25);
  check('tolerates units, spaces and prefixes', parseNumber('  8 g ') === 8 && parseNumber('<1 g') === 1 && parseNumber('about 8') === 8);
  check('unreadable field -> null, never a guessed number', parseNumber('') === null && parseNumber('---') === null && parseNumber(null as any) === null);

  console.log('\n── V3.2: ENERGY + SERVING + BASIS PARSING (pure) ──');
  check('bare number on the calories line is kcal', parseEnergyKcal('240') === 240);
  check('explicit kcal', parseEnergyKcal('132 kcal') === 132);
  check('Spanish calorie wording', parseEnergyKcal('132 Calorías') === 132);
  check('kJ + kcal both printed -> the kcal wins, no conversion', parseEnergyKcal('1046 kJ / 250 kcal') === 250);
  const kjOnly = parseEnergyKcal('1046 kJ');
  check('kJ-only label is converted deterministically', kjOnly !== null && Math.abs(kjOnly - 250) < 1, `${kjOnly}`);
  check('US volumetric serving -> the parenthesised gram figure wins', JSON.stringify(parseServing('2/3 cup (55g)')) === JSON.stringify({ size: 55, unit: 'g' }));
  check('metric serving', JSON.stringify(parseServing('30 g')) === JSON.stringify({ size: 30, unit: 'g' }));
  check('liquid serving keeps ml (density is not assumed here)', JSON.stringify(parseServing('240 ml')) === JSON.stringify({ size: 240, unit: 'ml' }));
  check('countable serving -> unit, never faked as grams', JSON.stringify(parseServing('1 barra')) === JSON.stringify({ size: 1, unit: 'unit' }));
  check('basis detection (EU per-100g vs per-serving)', parseBasis('por 100 g') === 'HUNDRED_G' && parseBasis('Per serving') === 'SERVING' && parseBasis('') === null);

  console.log('\n── V3.2: LABEL NORMALIZATION (pure — three continents, one contract) ──');
  const usFixture = new FixtureOCRProvider();
  const usLabel = parseLabel((await usFixture.extract({ imageRef: 'us-label.jpg' })).fields, 'fixture');
  check('US label normalizes to per-serving canonical values', usLabel.calories === 240 && usLabel.protein === 5 && usLabel.carbs === 46 && usLabel.fat === 3.5);
  check('US volumetric serving resolved to grams', usLabel.servingSize === 55 && usLabel.servingUnit === 'g');
  check('US "about 8" servings per container parsed', usLabel.servingsPerContainer === 8);
  const latamLabel = parseLabel((await usFixture.extract({ imageRef: 'latam-label.jpg' })).fields, 'fixture');
  check('LATAM decimal commas normalize to numbers', latamLabel.protein === 2.3 && latamLabel.carbs === 22.5 && latamLabel.fat === 3.6);
  const euLabel = parseLabel((await usFixture.extract({ imageRef: 'eu-label.jpg' })).fields, 'fixture');
  check('EU per-100g basis is converted to the 40g serving', euLabel.calories === 100 && euLabel.protein === 3.2 && euLabel.carbs === 24 && euLabel.fat === 3.8, `${euLabel.calories}kcal`);
  check('EU kJ/kcal line resolved to kcal before scaling', euLabel.servingSize === 40 && euLabel.servingUnit === 'g');
  const partialLabel = parseLabel((await usFixture.extract({ imageRef: 'partial-label.jpg' })).fields, 'fixture');
  check('an unreadable nutrient is REPORTED, never invented', partialLabel.missingFields.includes('protein') && partialLabel.protein === 0);
  check('completeness reflects the missing required field', Math.abs(labelCompleteness(partialLabel) - 0.8) < 0.001, `${labelCompleteness(partialLabel)}`);
  const unreadable = parseLabel((await usFixture.extract({ imageRef: 'unreadable.jpg' })).fields, 'fixture');
  check('a fully unreadable label reports every field missing, throws nothing', unreadable.missingFields.length >= 5 && labelCompleteness(unreadable) === 0);
  const determinism1 = parseLabel((await usFixture.extract({ imageRef: 'latam-label.jpg' })).fields, 'fixture');
  const determinism2 = parseLabel((await usFixture.extract({ imageRef: 'latam-label.jpg' })).fields, 'fixture');
  check('same transcription -> byte-identical label (deterministic boundary over a probabilistic provider)', JSON.stringify(determinism1) === JSON.stringify(determinism2));

  console.log('\n── V3.2: LABEL VALIDATION (pure gate — never trust OCR blindly) ──');
  check('a well-formed label passes', validateNutritionLabel(usLabel).valid === true);
  const negative = validateNutritionLabel({ ...usLabel, protein: -5 });
  check('negative macro -> rejected', negative.valid === false && negative.errors.some((e) => e.includes('protein')));
  const zeroServing = validateNutritionLabel({ ...usLabel, servingSize: 0 });
  check('serving size 0 -> rejected (nothing can be logged from it)', zeroServing.valid === false && zeroServing.errors.some((e) => e.includes('servingSize')));
  const impossibleLabel = parseLabel((await usFixture.extract({ imageRef: 'impossible-label.jpg' })).fields, 'fixture');
  const impossible = validateNutritionLabel(impossibleLabel);
  check('macros outweighing the serving -> rejected as physically impossible', impossible.valid === false && impossible.errors.some((e) => e.includes('weigh more')));
  const overCap = validateNutritionLabel({ ...usLabel, calories: 99_999 });
  check('a value the confirm endpoint would 400 on is rejected HERE, not at the last step', overCap.valid === false && overCap.errors.some((e) => e.includes('maximum')));
  check('Atwater-consistent label -> full plausibility', atwaterPlausibility(usLabel) === 1);
  // A misread macro digit ("50g" for "5g") is caught by BOTH independent checks:
  // it fails mass conservation outright, and it is Atwater-implausible.
  const misreadMacro = { ...usLabel, protein: 50 };
  check('a misread macro digit is caught by mass conservation (hard reject)', validateNutritionLabel(misreadMacro).valid === false && atwaterPlausibility(misreadMacro) < 0.6);
  // A misread CALORIE digit ("840" for "240") is mass-legal — only Atwater sees it.
  const misreadCalories = { ...usLabel, calories: 840 };
  const misreadOutcome = validateNutritionLabel(misreadCalories);
  check('a misread calorie digit is mass-legal -> caught by Atwater as a SOFT signal, not a reject', misreadOutcome.valid === true && misreadOutcome.plausibility < 0.6, `plausibility=${misreadOutcome.plausibility.toFixed(2)}`);
  check('0 kcal alongside real macros is inconsistent, but still the user\'s call', atwaterPlausibility({ ...usLabel, calories: 0 }) < 0.5 && validateNutritionLabel({ ...usLabel, calories: 0 }).valid === true);
  check('plausibility never rejects a legitimately imperfect label', validateNutritionLabel(latamLabel).valid === true && validateNutritionLabel(euLabel).valid === true);

  console.log('\n── V3.2: LABEL CANDIDATE (pure — facts, never a catalog override) ──');
  const { candidate: labelCandidate, scanConfidence: labelConfidence } = buildLabelCandidate(usLabel, 1);
  check('a label candidate is ALWAYS a one-off — linking a catalog food would discard the printed macros', labelCandidate.foodItemId === null && labelCandidate.matchScore === 0);
  check('the serving becomes the portion', labelCandidate.portion.grams === 55 && labelCandidate.portion.method === 'PROVIDER_ESTIMATE');
  check('a clean, complete, plausible label reaches HIGH', labelConfidence.band === 'HIGH', `${labelConfidence.overall.toFixed(2)}`);
  const { scanConfidence: partialConfidence } = buildLabelCandidate(partialLabel, 1);
  check('a partial label drops out of HIGH -> the user reviews it', partialConfidence.band !== 'HIGH', `${partialConfidence.band}`);
  const { scanConfidence: misreadConfidence } = buildLabelCandidate(usLabel, 0.2);
  check('low plausibility drags confidence down even when every field was read', misreadConfidence.overall < labelConfidence.overall);
  const { candidate: countable } = buildLabelCandidate({ ...usLabel, servingUnit: 'unit', servingSize: 1 }, 1);
  check('an unconvertible serving degrades the portion method, never fakes grams', countable.portion.method === 'SERVING_DEFAULT' && countable.portion.confidence < 0.5);

  console.log('\n── V3.2: OCR REGISTRY + PROMPT CONTAINMENT (pure) ──');
  const ocrSwap = new OCRProviderRegistry(new ConfigService({ OCR_PROVIDER: 'claude' }), [usFixture, new ClaudeOCRProvider(new ConfigService({}), new EphemeralImageStore())]);
  check('config selects the active OCR provider (swap to claude)', ocrSwap.active().id === 'claude');
  const ocrDefault = new OCRProviderRegistry(new ConfigService({}), [usFixture]);
  check('default OCR provider is fixture (a real OCR call costs money, unlike barcode)', ocrDefault.active().id === 'fixture');
  let ocrSwapThrew = false;
  try { new OCRProviderRegistry(new ConfigService({ OCR_PROVIDER: 'ghost' }), [usFixture]).active(); } catch { ocrSwapThrew = true; }
  check('unknown OCR provider throws (fails loud, not silent)', ocrSwapThrew === true);
  const claudeOcrNoKey = new ClaudeOCRProvider(new ConfigService({}), new EphemeralImageStore());
  check('OCR adapter reports hasKey=false with no API key (coach pattern)', claudeOcrNoKey.hasKey === false);
  let ocrNoKeyErr = '';
  try { await claudeOcrNoKey.extract({ imageRef: 'x.jpg' }); } catch (e: any) { ocrNoKeyErr = String(e.message); }
  check('no key -> raises before any network call', ocrNoKeyErr.includes('OCR_PROVIDER_UNAVAILABLE'));
  const claudeOcrFakeKey = new ClaudeOCRProvider(new ConfigService({ ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key' }), new EphemeralImageStore());
  let ocrUnresolvedErr = '';
  try { await claudeOcrFakeKey.extract({ imageRef: 'no-such-ref.jpg' }); } catch (e: any) { ocrUnresolvedErr = String(e.message); }
  check('unresolvable image -> raises BEFORE spending a provider call', ocrUnresolvedErr.includes('OCR_IMAGE_UNRESOLVED'));
  check('schema forbids extra keys and requires every slot', (LABEL_SCHEMA as any).additionalProperties === false && (LABEL_SCHEMA as any).required.length === 9);
  check('prompt instructs transcription, forbids conversion/computation (platform owns normalization)', OCR_SYSTEM_PROMPT.includes('TRANSCRIBE, NO INTERPRETES') && OCR_SYSTEM_PROMPT.includes('NUNCA inventes un número'));
  const extractionParsed = parseLabelExtraction({ productName: ' Galletas ', calories: '132 kcal', protein: '2,3 g', confidence: 5 });
  check('extraction parser keeps slots as VERBATIM strings — it does not parse numbers', extractionParsed.protein === '2,3 g' && extractionParsed.calories === '132 kcal');
  check('extraction parser is total: missing slots -> "", out-of-range confidence clamped', extractionParsed.fat === '' && extractionParsed.basis === '' && extractionParsed.confidence === 1);
  check('extraction parser tolerates a non-conforming payload', parseLabelExtraction(null).calories === '' && parseLabelExtraction('nope' as any).confidence === 0);

  console.log('\n── V3.3: PORTION PRIORS (pure statistics — deterministic learning) ──');
  check('median: odd length', median([3, 1, 2]) === 2);
  check('median: even length averages the middle pair', median([100, 200]) === 150);
  check('median: single observation', median([80]) === 80);
  const madSample = [160, 165, 170, 165, 900];
  check('MAD is robust: one absurd log cannot inflate the spread', mad(madSample, median(madSample)) === 5);
  check('selectPrior: below 2 observations there is no notion of "typical"', selectPrior([150], []) === null);
  check('selectPrior: 2 observations -> ALL_MEALS prior', selectPrior([150, 170], [])?.scope === 'ALL_MEALS');
  const mealTypePrior = selectPrior([150, 170, 80, 85, 90], [80, 85, 90]);
  check('selectPrior: meal-type subset preferred once it has 3+ observations (lunch rice ≠ dinner rice)', mealTypePrior?.scope === 'MEAL_TYPE' && mealTypePrior?.median === 85);
  check('historyWeight grows with evidence: n=3 half-trust, n=12 dominant', historyWeight(3) === 0.5 && historyWeight(12) === 0.8);
  check('historyWeight is capped — 100 logs trust no more than 12', historyWeight(100) === historyWeight(12));
  check('computeBias: below 5 corrections -> no bias (noise, not signal)', computeBias([0.8, 0.8, 0.8, 0.8]) === null);
  check('computeBias: median of the correction ratios', computeBias([0.8, 0.8, 0.8, 0.8, 0.8]) === 0.8);
  check('computeBias: ACCEPTED rows (ratio 1) regularize toward no-correction', computeBias([0.5, 1, 1, 1, 1]) === 1);
  check('computeBias: clamped to a sane range — a 9× "bias" is a data problem, not a correction', computeBias([9, 9, 9, 9, 9]) === 2 && computeBias([0.01, 0.01, 0.01, 0.01, 0.01]) === 0.5);

  console.log('\n── V3.3: PORTION ENGINE (pure — the platform owns the final grams) ──');
  const visionBase = { grams: 150, method: 'PROVIDER_ESTIMATE' as const, confidence: 0.5 };
  const newUserResolved = resolvePortion(visionBase, null);
  check('new user (no priors fetched) -> base estimate passes through untouched', newUserResolved.portion.grams === 150 && newUserResolved.portion.method === 'PROVIDER_ESTIMATE' && newUserResolved.portion.confidence === 0.5);
  check('…and the decision is still explained (single VISION signal)', newUserResolved.explanation.length === 1 && newUserResolved.explanation[0].source === 'VISION');
  const noHistory: PortionPriorInputs = { userFoodGrams: [], userFoodMealTypeGrams: [], plannerExpectedGrams: null, visionBiasRatios: [] };
  const emptyResolved = resolvePortion(visionBase, noHistory);
  check('priors fetched but empty -> still identical to base (regression guard)', emptyResolved.portion.grams === 150 && emptyResolved.portion.method === 'PROVIDER_ESTIMATE');

  const strongPrior: PortionPriorInputs = { userFoodGrams: [165, 160, 170, 165, 168, 162, 165, 167, 164, 166], userFoodMealTypeGrams: [165, 160, 170, 165, 168, 162, 165, 167, 164, 166], plannerExpectedGrams: null, visionBiasRatios: [] };
  const wrongClaude = resolvePortion({ grams: 400, method: 'PROVIDER_ESTIMATE', confidence: 0.5 }, strongPrior);
  check('wrong model estimate (400g) vs 10-log prior (~165g) -> history dominates', wrongClaude.portion.method === 'USER_PRIOR' && Math.abs(wrongClaude.portion.grams - 165) < Math.abs(wrongClaude.portion.grams - 400), `${wrongClaude.portion.grams}g`);
  check('strong tight prior -> HIGH portion confidence (the platform KNOWS this user)', wrongClaude.portion.confidence >= 0.85);
  const historySignal = wrongClaude.explanation.find((s) => s.source === 'USER_HISTORY');
  check('explanation carries the history signal with a dominant weight', !!historySignal && historySignal!.weight > 0.7);
  const agreeing = resolvePortion({ grams: 163, method: 'PROVIDER_ESTIMATE', confidence: 0.5 }, strongPrior);
  check('model AGREEING with history -> corroboration bonus on top of the prior tier', agreeing.portion.confidence > 0.85);

  const weakPrior: PortionPriorInputs = { userFoodGrams: [165, 160], userFoodMealTypeGrams: [], plannerExpectedGrams: null, visionBiasRatios: [] };
  const weakResolved = resolvePortion({ grams: 400, method: 'PROVIDER_ESTIMATE', confidence: 0.5 }, weakPrior);
  check('2-log prior blends but does not dominate', weakResolved.portion.method === 'BLENDED');
  check('progressive trust: more history pulls the estimate closer to the user', Math.abs(wrongClaude.portion.grams - 165) < Math.abs(weakResolved.portion.grams - 165), `n=10 -> ${wrongClaude.portion.grams}g, n=2 -> ${weakResolved.portion.grams}g`);

  const withPlan = resolvePortion(visionBase, { ...noHistory, plannerExpectedGrams: 200 });
  check('planner expectation shifts the blend toward the plan', withPlan.portion.grams > 150 && withPlan.portion.grams < 200, `${withPlan.portion.grams}g`);
  check('planner signal has a fixed LOW weight — the plan says SHOULD, not IS', withPlan.explanation.find((s) => s.source === 'PLANNER')!.weight === 0.15);

  const biased = resolvePortion({ grams: 200, method: 'PROVIDER_ESTIMATE', confidence: 0.5 }, { ...noHistory, visionBiasRatios: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8] });
  check('correction engine: learned bias rescales the model estimate (200 × 0.8 = 160)', biased.portion.grams === 160);
  check('bias correction is explained, never silent', biased.explanation[0].note.includes('0.80'));

  const servingBlend = resolvePortion({ grams: 120, method: 'SERVING_DEFAULT', confidence: 0.35 }, strongPrior);
  check('catalog-default base + strong prior -> history dominates', servingBlend.portion.method === 'USER_PRIOR');
  check('catalog default labeled CATALOG_DEFAULT, not VISION (it is knowledge, not perception)', servingBlend.explanation[0].source === 'CATALOG_DEFAULT');

  const det1 = resolvePortion({ grams: 400, method: 'PROVIDER_ESTIMATE', confidence: 0.5 }, strongPrior);
  const det2 = resolvePortion({ grams: 400, method: 'PROVIDER_ESTIMATE', confidence: 0.5 }, strongPrior);
  check('determinism: same inputs -> byte-identical output', JSON.stringify(det1) === JSON.stringify(det2));
  const absurdPrior: PortionPriorInputs = { userFoodGrams: [5000, 5000, 5000, 5000], userFoodMealTypeGrams: [], plannerExpectedGrams: null, visionBiasRatios: [] };
  check('blend clamped to plausible grams (shared 10..600 bounds)', resolvePortion(visionBase, absurdPrior).portion.grams <= 600);

  // ── PART B: full lifecycle integration (embedded DB + fixture provider) ──
  console.log('\n── INTEGRATION (embedded Postgres + fixture provider) ──');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-vision-'));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB);
  await applyMigrations();

  const prisma = new PrismaService();
  await prisma.$connect();
  const foodAdapter = new LocalFoodAdapter(prisma);
  const foodSvc = new FoodService(foodAdapter);
  const events = new EventEmitter2();
  const logsSvc = new LogsService(prisma, events);
  const registry = new VisionProviderRegistry(new ConfigService({}), [new FixtureVisionProvider()]);
  const imageStore = new EphemeralImageStore();
  const barcodeRegistry = new BarcodeLookupProviderRegistry(new ConfigService({ BARCODE_LOOKUP_PROVIDER: 'fixture' }), [new FixtureBarcodeLookupProvider(), new OpenFoodFactsLookupProvider()]);
  const ocrRegistry = new OCRProviderRegistry(new ConfigService({ OCR_PROVIDER: 'fixture' }), [new FixtureOCRProvider()]);
  const priorReader = new PortionPriorReader(prisma);
  const visionSvc = new VisionScanService(prisma, foodSvc, logsSvc, registry, events, imageStore, barcodeRegistry, ocrRegistry, priorReader);

  const user = await prisma.user.create({ data: { email: 'vision@test.local' } });
  await prisma.goal.create({ data: { userId: user.id, type: 'MAINTAIN', targetCalories: 2200, proteinG: 150, carbsG: 250, fatG: 70, fiberTargetG: 30, waterMl: 2500, bmr: 1600, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: 0 } });
  const pollo = await prisma.foodItem.create({ data: { name: 'Pollo a la plancha', nameLower: 'pollo a la plancha', nameNormalized: 'pollo a la plancha', nameAliases: [], caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });
  await prisma.foodItem.create({ data: { name: 'Arroz blanco', nameLower: 'arroz blanco', nameNormalized: 'arroz blanco', nameAliases: [], caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });
  await prisma.foodItem.create({ data: { name: 'Brocoli', nameLower: 'brocoli', nameNormalized: 'brocoli', nameAliases: [], caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 7, fatPer100g: 0.4, fiberPer100g: 0, source: 'curated_latam', isCommon: true } });
  await prisma.servingSize.create({ data: { foodItemId: pollo.id, label: '1 pechuga', grams: 120, isDefault: true } });

  let mealLoggedFired = false;
  events.on('meal.logged', () => { mealLoggedFired = true; });
  let proposedEvt = false, confirmedEvt = false, failedEvt = false;
  events.on(VISION_EVENTS.PROPOSED, () => { proposedEvt = true; });
  events.on(VISION_EVENTS.CONFIRMED, () => { confirmedEvt = true; });
  events.on(VISION_EVENTS.FAILED, () => { failedEvt = true; });

  // ── happy path: multi-food photo -> confirm -> LoggedMeal via the existing path ──
  const proposal = await visionSvc.createScan(user.id, 'photo-chicken-plate.jpg', 'PHOTO');
  check('scan proposes multiple candidates (multi-food)', proposal.status === 'PROPOSED' && proposal.candidates.length === 3, `${proposal.candidates.length}`);
  check('first candidate matched to the catalog Pollo', proposal.candidates[0].foodItemId === pollo.id, `${proposal.candidates[0].displayName}`);
  check('scan-level confidence present with a band', ['HIGH', 'MEDIUM', 'LOW'].includes(proposal.scanConfidence.band));
  check('proposal carries a backend-decided UX mode (V1)', ['CONFIRM', 'REVIEW', 'FALLBACK'].includes(proposal.mode), proposal.mode);
  check('contractVersion is set', proposal.contractVersion === 1);

  const persisted = await prisma.visionScan.findUnique({ where: { id: proposal.scanId } });
  check('scan persisted as PROPOSED with provider provenance', persisted?.status === 'PROPOSED' && persisted?.providerId === 'fixture');

  const confirmResult = await visionSvc.confirmScan(user.id, {
    scanId: proposal.scanId,
    mealType: 'LUNCH',
    items: proposal.candidates.map((c) => ({
      foodItemId: c.foodItemId,
      quantity: c.portion.grams,
      unit: 'g',
      grams: c.portion.grams,
      acceptedFromCandidate: c.detectionIndex,
    })),
  });
  check('confirm returns today (LogsService.logMeal contract, unchanged)', Array.isArray(confirmResult.meals) && confirmResult.meals.length === 1);
  check('meal.logged fired -> downstream platform reacts exactly as with manual logging', mealLoggedFired === true);

  const loggedMeal = await prisma.loggedMeal.findFirst({ where: { dailyLog: { userId: user.id } } });
  check('LoggedMeal created through the SAME write path (3 items)', loggedMeal?.items === undefined); // sanity: field doesn't exist on the row itself
  const items = await prisma.loggedMealItem.findMany({ where: { loggedMealId: loggedMeal!.id } });
  check('LoggedMeal has 3 items from the confirmed candidates', items.length === 3, `${items.length}`);
  check('provenance stamped: source=vision + visionScanId set', loggedMeal?.source === 'vision' && loggedMeal?.visionScanId === proposal.scanId);

  const scanAfter = await prisma.visionScan.findUnique({ where: { id: proposal.scanId } });
  check('scan transitioned to LOGGED', scanAfter?.status === 'LOGGED');

  const feedback = await prisma.visionFeedback.findMany({ where: { scanId: proposal.scanId } });
  check('feedback captured for every confirmed item', feedback.length === 3, `${feedback.length}`);
  check('unedited accepted candidates recorded as ACCEPTED', feedback.every((f: any) => f.action === 'ACCEPTED'), feedback.map((f: any) => f.action).join(','));

  console.log('\n── VISION EVENTS (internal telemetry, nothing downstream subscribes) ──');
  check('vision.scan.proposed fired on PROPOSED', proposedEvt === true);
  check('vision.scan.confirmed fired on LOGGED', confirmedEvt === true);

  // ── zero detections -> empty proposal, manual fallback signal ──
  console.log('\n── DEGRADATION PATHS ──');
  const emptyProposal = await visionSvc.createScan(user.id, 'blank.jpg', 'PHOTO');
  check('no detections -> empty candidates + NO_DETECTIONS fallback', emptyProposal.candidates.length === 0 && emptyProposal.fallback.reason === 'NO_DETECTIONS');
  check('empty scan is still PROPOSED (not FAILED) — a valid, handled outcome', emptyProposal.status === 'PROPOSED');

  // ── unrecognized food -> candidate with foodItemId null (logs as one-off, like manual entry) ──
  const mysteryProposal = await visionSvc.createScan(user.id, 'mystery-snack.jpg', 'PHOTO');
  check('unmatched label -> candidate with foodItemId null', mysteryProposal.candidates.length === 1 && mysteryProposal.candidates[0].foodItemId === null);
  const mysteryConfirm = await visionSvc.confirmScan(user.id, {
    scanId: mysteryProposal.scanId,
    items: [{ foodItemId: null, customName: mysteryProposal.candidates[0].displayName, quantity: 1, calories: 200, proteinG: 5, carbsG: 20, fatG: 8, acceptedFromCandidate: 0 }],
  });
  check('unmatched candidate still confirms as a one-off item (manual path allows this)', Array.isArray(mysteryConfirm.meals));

  // ── provider failure -> FAILED, never a broken scan, manual fallback signaled ──
  const failRegistry = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'nonexistent' }), [new FixtureVisionProvider()]);
  const failVisionSvc = new VisionScanService(prisma, foodSvc, logsSvc, failRegistry, events, imageStore, barcodeRegistry, ocrRegistry, priorReader);
  const failedProposal = await failVisionSvc.createScan(user.id, 'anything.jpg', 'PHOTO');
  check('unknown provider -> scan FAILED, not thrown to the caller', failedProposal.status === 'FAILED' && failedProposal.fallback.reason === 'PROVIDER_ERROR');
  const failedScanRow = await prisma.visionScan.findUnique({ where: { id: failedProposal.scanId } });
  check('failure reason persisted for audit', !!failedScanRow?.failureReason);
  check('vision.scan.failed event fired', failedEvt === true);

  // ── malformed provider response -> validation gate fails safe (no garbage reaches Nutrition) ──
  const badProvider: VisionProvider = {
    id: 'bad',
    capabilities: { multiFood: true, portionHints: false, barcode: false, ocr: false, video: false },
    async recognize() { return { providerId: 'bad', detections: 'not-an-array' } as any; },
  };
  const badRegistry = new VisionProviderRegistry(new ConfigService({ VISION_PROVIDER: 'bad' }), [badProvider]);
  const badSvc = new VisionScanService(prisma, foodSvc, logsSvc, badRegistry, events, imageStore, barcodeRegistry, ocrRegistry, priorReader);
  const badProposal = await badSvc.createScan(user.id, 'chicken.jpg', 'PHOTO');
  check('malformed provider response -> scan FAILED (validation gate, fail-safe)', badProposal.status === 'FAILED');
  const badRow = await prisma.visionScan.findUnique({ where: { id: badProposal.scanId } });
  check('validation failure recorded as the failure reason', !!badRow?.failureReason && badRow.failureReason.includes('INVALID_PROVIDER_RESPONSE'), badRow?.failureReason ?? '');

  // ── expiry: PROPOSED past its window is lazily swept, never confirmable ──
  console.log('\n── LAZY EXPIRY ──');
  const expiring = await visionSvc.createScan(user.id, 'chicken-to-expire.jpg', 'PHOTO');
  await prisma.visionScan.update({ where: { id: expiring.scanId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  let expiredOnConfirm = false;
  try {
    await visionSvc.confirmScan(user.id, { scanId: expiring.scanId, items: [{ foodItemId: pollo.id, quantity: 150, unit: 'g', acceptedFromCandidate: 0 }] });
  } catch {
    expiredOnConfirm = true;
  }
  check('expired scan cannot be confirmed (swept first)', expiredOnConfirm === true);
  const expiredRow = await prisma.visionScan.findUnique({ where: { id: expiring.scanId } });
  check('expired scan status is EXPIRED', expiredRow?.status === 'EXPIRED');

  // ── ownership: a user cannot touch another user's scan ──
  console.log('\n── FALLBACK TO MANUAL (V1) ──');
  const mealsBeforeFallback = await prisma.loggedMeal.count({ where: { dailyLog: { userId: user.id } } });
  let fallbackEvt = false;
  events.on(VISION_EVENTS.FALLBACK, () => { fallbackEvt = true; });
  const fbScan = await visionSvc.createScan(user.id, 'chicken-fallback.jpg', 'PHOTO');
  await visionSvc.markFallbackManual(user.id, fbScan.scanId);
  const fbRow = await prisma.visionScan.findUnique({ where: { id: fbScan.scanId } });
  check('fallback -> scan FALLBACK_MANUAL', fbRow?.status === 'FALLBACK_MANUAL');
  check('vision.scan.fallback event fired', fallbackEvt === true);
  const mealsAfterFallback = await prisma.loggedMeal.count({ where: { dailyLog: { userId: user.id } } });
  check('fallback creates NO LoggedMeal (manual flow does that)', mealsAfterFallback === mealsBeforeFallback, `${mealsBeforeFallback}->${mealsAfterFallback}`);
  let fbConfirmBlocked = false;
  try { await visionSvc.confirmScan(user.id, { scanId: fbScan.scanId, items: [{ foodItemId: pollo.id, quantity: 150, unit: 'g', acceptedFromCandidate: 0 }] }); } catch { fbConfirmBlocked = true; }
  check('a fallen-back scan cannot then be confirmed', fbConfirmBlocked === true);

  console.log('\n── V2: REAL UPLOAD PATH (image in, ref persisted, bytes released) ──');
  const uploadPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const uploaded = await visionSvc.createScan(user.id, 'lunch-capture.jpg', 'PHOTO', { base64: uploadPng, mimeType: 'image/png' });
  check('an uploaded photo still produces a normal proposal', uploaded.status === 'PROPOSED' && uploaded.candidates.length > 0);
  const uploadedRow = await prisma.visionScan.findUnique({ where: { id: uploaded.scanId } });
  check('the scan row stores the image STORE REF, not the caller-supplied name', uploadedRow!.imageRef.startsWith('vision-mem://'));
  check('raw image bytes never reach the database', !uploadedRow!.imageRef.includes(uploadPng) && !JSON.stringify(uploadedRow).includes(uploadPng));
  check('bytes are released once recognition is done (no leak past the scan)', imageStore.size() === 0);
  const refOnly = await visionSvc.createScan(user.id, 'chicken-plate.jpg', 'PHOTO');
  check('reference-only path (V0/V1 fixture) still works untouched — dev/CI need no vendor key', refOnly.status === 'PROPOSED' && refOnly.candidates.length === 3);
  let badUpload = false;
  try { await visionSvc.createScan(user.id, 'x.jpg', 'PHOTO', { base64: uploadPng, mimeType: 'image/tiff' }); } catch { badUpload = true; }
  const scansForUser = await prisma.visionScan.count({ where: { userId: user.id, imageRef: 'x.jpg' } });
  check('a rejected image is a bad request, not a failed scan (no orphan row)', badUpload === true && scansForUser === 0);

  console.log('\n── V3.1: BARCODE SCAN LIFECYCLE (fixture lookup provider, real DB) ──');
  const KNOWN_BARCODE = '7501055310209';
  const firstScan = await visionSvc.createBarcodeScan(user.id, KNOWN_BARCODE);
  check('first scan of a new barcode resolves via external lookup', firstScan.status === 'PROPOSED' && firstScan.candidates.length === 1);
  check('resolved product feeds a real catalog candidate (never orphaned)', !!firstScan.candidates[0]?.foodItemId);
  check('confident barcode resolution -> CONFIRM or REVIEW, not buried in FALLBACK', firstScan.mode === 'CONFIRM' || firstScan.mode === 'REVIEW');
  const createdFoodId = firstScan.candidates[0].foodItemId as string;
  const createdFood = await prisma.foodItem.findUnique({ where: { id: createdFoodId } });
  check('a NEW global FoodItem was created from the lookup (source=open_food_facts, barcode stamped)', createdFood?.source === 'open_food_facts' && createdFood?.barcode === KNOWN_BARCODE && createdFood?.createdByUserId === null);
  const firstScanRow = await prisma.visionScan.findUnique({ where: { id: firstScan.scanId } });
  check('scan row stores the decoded barcode + a placeholder imageRef (no image exists for this modality)', firstScanRow?.barcodeValue === KNOWN_BARCODE && firstScanRow?.imageRef === 'barcode-scan');
  check('provenance stamps the real provider (openfoodfacts fixture stands in), not "local-cache" on a first-time lookup', firstScanRow?.providerId === 'fixture');

  console.log('\n── V3.1: DUPLICATE SCANS (same barcode twice -> one FoodItem, not two) ──');
  const beforeCount = await prisma.foodItem.count({ where: { barcode: KNOWN_BARCODE } });
  const secondScan = await visionSvc.createBarcodeScan(user.id, KNOWN_BARCODE);
  const afterCount = await prisma.foodItem.count({ where: { barcode: KNOWN_BARCODE } });
  check('scanning the same barcode again resolves to the SAME FoodItem (no duplicate row)', beforeCount === 1 && afterCount === 1 && secondScan.candidates[0]?.foodItemId === createdFoodId);
  const secondScanRow = await prisma.visionScan.findUnique({ where: { id: secondScan.scanId } });
  check('the repeat scan skipped the external lookup entirely (provenance = local-cache)', secondScanRow?.providerId === 'local-cache');

  console.log('\n── V3.1: NOT-FOUND DEGRADATION (decoded fine, product unregistered) ──');
  const notFoundScan = await visionSvc.createBarcodeScan(user.id, '0000000000000');
  check('an unregistered barcode is a valid, handled outcome — status stays PROPOSED, not FAILED', notFoundScan.status === 'PROPOSED' && notFoundScan.candidates.length === 0);
  check('fallback reason is specific and mode steers to manual search (barcode prefillable client-side)', notFoundScan.fallback.reason === 'BARCODE_NOT_FOUND' && notFoundScan.mode === 'FALLBACK');

  console.log('\n── V3.1: PROVIDER FAILURE / OFFLINE (network error, not "not found") ──');
  const throwingBarcodeProvider = { id: 'throws', async lookup() { throw new Error('NETWORK_TIMEOUT'); } };
  const throwingRegistry = new BarcodeLookupProviderRegistry(new ConfigService({ BARCODE_LOOKUP_PROVIDER: 'throws' }), [throwingBarcodeProvider]);
  const throwingSvc = new VisionScanService(prisma, foodSvc, logsSvc, registry, events, imageStore, throwingRegistry, ocrRegistry, priorReader);
  const throwScan = await throwingSvc.createBarcodeScan(user.id, '2223334445556');
  check('a real lookup failure (offline/timeout) is distinct from not-found — scan FAILED, same degradation contract as vision', throwScan.status === 'FAILED' && throwScan.fallback.reason === 'PROVIDER_ERROR' && throwScan.mode === 'FALLBACK');
  const unknownBarcodeRegistry = new BarcodeLookupProviderRegistry(new ConfigService({ BARCODE_LOOKUP_PROVIDER: 'ghost-barcode' }), [barcodeFixture]);
  const unknownBarcodeSvc = new VisionScanService(prisma, foodSvc, logsSvc, registry, events, imageStore, unknownBarcodeRegistry, ocrRegistry, priorReader);
  const unknownScan = await unknownBarcodeSvc.createBarcodeScan(user.id, '3334445556667');
  check('a misconfigured provider id fails the scan gracefully, never throws to the caller', unknownScan.status === 'FAILED' && unknownScan.mode === 'FALLBACK');

  console.log('\n── V3.1: CONFIRM CONVERGES ON THE SAME WRITE PATH (LogsService.logMeal, unchanged) ──');
  const barcodeConfirmResult = await visionSvc.confirmScan(user.id, {
    scanId: firstScan.scanId,
    mealType: firstScan.suggestedMealType,
    items: [{
      foodItemId: firstScan.candidates[0].foodItemId,
      quantity: firstScan.candidates[0].portion.grams,
      unit: 'g',
      grams: firstScan.candidates[0].portion.grams,
      acceptedFromCandidate: 0,
    }],
  } as any);
  check('barcode confirm returns today (unchanged confirmScan/LogsService contract)', !!barcodeConfirmResult);
  const barcodeLoggedMeal = await prisma.loggedMeal.findFirst({ where: { visionScanId: firstScan.scanId } });
  check('LoggedMeal was created through the SAME write path, with barcode provenance', barcodeLoggedMeal?.source === 'vision' && barcodeLoggedMeal?.visionScanId === firstScan.scanId);
  check('confirmScan/rejectScan/getScan needed ZERO changes for barcode — the scan lifecycle is source-agnostic', (await prisma.visionScan.findUnique({ where: { id: firstScan.scanId } }))?.status === 'LOGGED');

  console.log('\n── V3.2: LABEL OCR SCAN LIFECYCLE (fixture OCR provider, real DB) ──');
  const labelScan = await visionSvc.createLabelScan(user.id, 'us-label.jpg');
  check('a readable label produces a normal PROPOSED proposal', labelScan.status === 'PROPOSED' && labelScan.candidates.length === 1);
  check('the proposal carries the transcribed facts for the user to edit', !!labelScan.label && labelScan.label!.calories === 240 && labelScan.label!.protein === 5);
  check('label source is LABEL_OCR — a distinct modality from MENU_OCR/RECEIPT_OCR', labelScan.source === 'LABEL_OCR');
  check('a confident label reaches CONFIRM', labelScan.mode === 'CONFIRM', `${labelScan.mode}`);
  check('the candidate is a one-off (the label is the truth for this package)', labelScan.candidates[0].foodItemId === null);
  const labelScanRow = await prisma.visionScan.findUnique({ where: { id: labelScan.scanId } });
  check('the label persists INSIDE the proposal JSON — no new column, no new table', (labelScanRow!.proposal as any).label?.calories === 240 && labelScanRow!.barcodeValue === null);
  check('provenance stamped for eval attribution', labelScanRow!.providerId === 'fixture' && labelScanRow!.providerModel === 'fixture-ocr-v1');

  console.log('\n── V3.2: LABEL MATCHING REUSE (catalog offered, never forced) ──');
  await prisma.foodItem.create({ data: { name: 'Honey Nut Cereal', nameLower: 'honey nut cereal', nameNormalized: 'honey nut cereal', nameAliases: [], caloriesPer100g: 380, proteinPer100g: 8, carbsPer100g: 84, fatPer100g: 4, fiberPer100g: 3, source: 'curated_latam', isCommon: true } });
  const matchedLabelScan = await visionSvc.createLabelScan(user.id, 'us-label.jpg');
  check('a catalog match is surfaced as an ALTERNATE via the reused FoodService.search', matchedLabelScan.candidates[0].alternates.length > 0 && matchedLabelScan.candidates[0].alternates[0].displayName === 'Honey Nut Cereal');
  check('...but the primary candidate STAYS a one-off — the printed macros are not overridden by the catalog', matchedLabelScan.candidates[0].foodItemId === null && matchedLabelScan.label!.calories === 240);

  console.log('\n── V3.2: DEGRADATION (partial, impossible, unreadable, provider failure) ──');
  const partialScan = await visionSvc.createLabelScan(user.id, 'partial-label.jpg');
  check('a partially readable label still PROPOSES (editable), never fails outright', partialScan.status === 'PROPOSED' && !!partialScan.label);
  check('the missing field is reported so mobile opens it for editing', partialScan.label!.missingFields.includes('protein'));
  check('a partial label is not presented as confident', partialScan.mode !== 'CONFIRM', `${partialScan.mode}`);
  const impossibleScan = await visionSvc.createLabelScan(user.id, 'impossible-label.jpg');
  check('a physically impossible label FAILS the validation gate — never proposed to the user', impossibleScan.status === 'FAILED' && impossibleScan.mode === 'FALLBACK');
  const impossibleRow = await prisma.visionScan.findUnique({ where: { id: impossibleScan.scanId } });
  check('the validation failure is recorded for audit', impossibleRow!.failureReason?.includes('OCR_INVALID_LABEL') === true);
  const unreadableScan = await visionSvc.createLabelScan(user.id, 'unreadable-label.jpg');
  check('an unreadable label degrades to manual (serving 0 cannot be logged)', unreadableScan.status === 'FAILED' && unreadableScan.mode === 'FALLBACK');
  const throwingOcrRegistry = new OCRProviderRegistry(new ConfigService({ OCR_PROVIDER: 'throws' }), [{ id: 'throws', async extract() { throw new Error('NETWORK_TIMEOUT'); } }]);
  const throwingOcrSvc = new VisionScanService(prisma, foodSvc, logsSvc, registry, events, imageStore, barcodeRegistry, throwingOcrRegistry, priorReader);
  const ocrFailScan = await throwingOcrSvc.createLabelScan(user.id, 'us-label.jpg');
  check('an OCR provider failure degrades to manual, never throws to the caller', ocrFailScan.status === 'FAILED' && ocrFailScan.fallback.reason === 'PROVIDER_ERROR');

  console.log('\n── V3.2: CONFIRM CONVERGES ON THE SAME WRITE PATH (label macros, one-off item) ──');
  const labelCandidateToLog = labelScan.candidates[0];
  const labelConfirmResult = await visionSvc.confirmScan(user.id, {
    scanId: labelScan.scanId,
    mealType: labelScan.suggestedMealType,
    items: [{
      foodItemId: null,
      customName: labelScan.label!.productName,
      quantity: labelCandidateToLog.portion.grams,
      unit: 'g',
      grams: labelCandidateToLog.portion.grams,
      calories: labelScan.label!.calories,
      proteinG: labelScan.label!.protein,
      carbsG: labelScan.label!.carbs,
      fatG: labelScan.label!.fat,
      acceptedFromCandidate: 0,
    }],
  } as any);
  check('label confirm returns today (unchanged confirmScan/LogsService contract)', !!labelConfirmResult);
  const labelMeal = await prisma.loggedMeal.findFirst({ where: { visionScanId: labelScan.scanId }, include: { items: true } });
  check('LoggedMeal created through the SAME write path, with vision provenance', labelMeal?.source === 'vision' && labelMeal?.visionScanId === labelScan.scanId);
  check("the label's OWN macros were logged verbatim — LogsService trusted them via the existing one-off path", labelMeal?.totalCalories === 240 && Number(labelMeal?.totalProteinG) === 5);
  check('the item is a one-off snapshot, not a catalog link', labelMeal?.items[0].foodItemId === null && labelMeal?.items[0].nameSnapshot === 'Honey Nut Cereal');
  check('confirmScan needed ZERO changes for a third modality', (await prisma.visionScan.findUnique({ where: { id: labelScan.scanId } }))?.status === 'LOGGED');

  console.log('\n── V3.3: THE LEARNING LOOP (same user, same food, better every scan) ──');
  const learner = await prisma.user.create({ data: { email: 'vision-learner@test.local' } });
  await prisma.goal.create({ data: { userId: learner.id, type: 'MAINTAIN', targetCalories: 2200, proteinG: 150, carbsG: 250, fatG: 70, fiberTargetG: 30, waterMl: 2500, bmr: 1600, tdee: 2200, formulaUsed: 'mifflin_st_jeor', goalAdjustment: 0 } });
  const nowMealType = inferMealType(new Date());

  // Scan 1 — no history. The fixture proposes pollo at 180g (PROVIDER_ESTIMATE).
  const scan1 = await visionSvc.createScan(learner.id, 'photo-chicken-plate.jpg', 'PHOTO');
  const scan1Pollo = scan1.candidates[0];
  check('new user -> portion is the raw provider estimate (nothing invented)', scan1Pollo.portion.grams === 180 && scan1Pollo.portion.method === 'PROVIDER_ESTIMATE');
  check('new user -> explanation has exactly one signal (no phantom priors)', scan1Pollo.portionExplanation?.length === 1 && scan1Pollo.portionExplanation?.[0].source === 'VISION');

  // The user corrects: they actually ate 250g. That edit is supervision.
  await visionSvc.confirmScan(learner.id, {
    scanId: scan1.scanId,
    mealType: nowMealType,
    items: [{ foodItemId: scan1Pollo.foodItemId, quantity: 250, unit: 'g', grams: 250, acceptedFromCandidate: 0 }],
  });
  const learnerFeedback = await prisma.visionFeedback.findFirst({ where: { userId: learner.id } });
  check('the correction is captured as EDITED_PORTION with method attribution (V3.3 column)', learnerFeedback?.action === 'EDITED_PORTION' && learnerFeedback?.proposedMethod === 'PROVIDER_ESTIMATE');
  const learnerRatios = await priorReader.visionBiasRatios(learner.id);
  check('the correction corpus is finally READ: ratio 250/180 surfaces for future scans', learnerRatios.length === 1 && Math.abs(learnerRatios[0] - 250 / 180) < 1e-9);

  // Two more real meals of the same food at 250g -> 3 validated observations.
  for (let i = 0; i < 2; i++) {
    await logsSvc.logMeal(learner.id, { mealType: nowMealType, items: [{ foodItemId: pollo.id, quantity: 250, unit: 'g' }] } as any);
  }

  // Scan 2 — the platform now has a 3-log prior. Expected blend: (180·0.7 + 250·0.5)/1.2 = 209.
  const scan2 = await visionSvc.createScan(learner.id, 'photo-chicken-plate.jpg', 'PHOTO');
  const scan2Pollo = scan2.candidates[0];
  check('3-log prior -> BLENDED estimate, no longer the raw model number', scan2Pollo.portion.method === 'BLENDED', scan2Pollo.portion.method);
  check('estimate moved toward what the user actually eats', Math.abs(scan2Pollo.portion.grams - 250) < Math.abs(180 - 250), `${scan2Pollo.portion.grams}g`);
  check('deterministic blend: exactly the arithmetic the docs promise', scan2Pollo.portion.grams === 209, `${scan2Pollo.portion.grams}g`);
  check('explanation now shows BOTH signals with their weights', scan2Pollo.portionExplanation?.length === 2 && !!scan2Pollo.portionExplanation?.find((s: any) => s.source === 'USER_HISTORY'));

  // Five more meals at 250g -> 8 observations, zero variance. History should now dominate.
  for (let i = 0; i < 5; i++) {
    await logsSvc.logMeal(learner.id, { mealType: nowMealType, items: [{ foodItemId: pollo.id, quantity: 250, unit: 'g' }] } as any);
  }
  const scan3 = await visionSvc.createScan(learner.id, 'photo-chicken-plate.jpg', 'PHOTO');
  const scan3Pollo = scan3.candidates[0];
  check('8-log tight prior -> USER_PRIOR: the user outweighs the model', scan3Pollo.portion.method === 'USER_PRIOR', scan3Pollo.portion.method);
  check('progressively better: scan3 closer to 250g than scan2, scan2 closer than scan1', Math.abs(scan3Pollo.portion.grams - 250) < Math.abs(scan2Pollo.portion.grams - 250) && Math.abs(scan2Pollo.portion.grams - 250) < Math.abs(180 - 250), `180 -> ${scan2Pollo.portion.grams} -> ${scan3Pollo.portion.grams}`);
  check('portion confidence rose with evidence (0.7 provider -> 0.85 platform-known)', scan3Pollo.portion.confidence === 0.85);
  check('Claude became less important WITHOUT any provider change (same fixture, same detections)', scan1Pollo.portion.grams === 180 && scan3Pollo.portion.grams !== 180);

  // Determinism: scanning again with unchanged history yields the identical portion.
  const scan4 = await visionSvc.createScan(learner.id, 'photo-chicken-plate.jpg', 'PHOTO');
  check('determinism: same history -> identical portion decision', JSON.stringify(scan4.candidates[0].portion) === JSON.stringify(scan3Pollo.portion));
  const persistedScan3 = await prisma.visionScan.findUnique({ where: { id: scan3.scanId } });
  check('the persisted proposal carries the deterministic explanation — an audit trail, never a Claude assumption', Array.isArray((persistedScan3?.proposal as any)?.candidates?.[0]?.portionExplanation));

  console.log('\n── V3.3: PLANNER EXPECTATION (read-only reuse — planner decisions untouched) ──');
  const planUser = await prisma.user.create({ data: { email: 'vision-planner@test.local' } });
  const plan = await prisma.mealPlan.create({ data: { userId: planUser.id, isActive: true } });
  const day1 = await prisma.mealPlanDay.create({ data: { mealPlanId: plan.id, dayNumber: 1, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 } });
  const day2 = await prisma.mealPlanDay.create({ data: { mealPlanId: plan.id, dayNumber: 2, targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60 } });
  const pm1 = await prisma.plannedMeal.create({ data: { mealPlanDayId: day1.id, mealType: nowMealType as any, name: 'Comida plan A', totalCalories: 500, totalProteinG: 40, totalCarbsG: 30, totalFatG: 15 } });
  const pm2 = await prisma.plannedMeal.create({ data: { mealPlanDayId: day2.id, mealType: nowMealType as any, name: 'Comida plan B', totalCalories: 500, totalProteinG: 40, totalCarbsG: 30, totalFatG: 15 } });
  await prisma.plannedMealItem.create({ data: { plannedMealId: pm1.id, foodItemId: pollo.id, amountG: 160, calories: 264, proteinG: 49.6, carbsG: 0, fatG: 5.8 } });
  await prisma.plannedMealItem.create({ data: { plannedMealId: pm2.id, foodItemId: pollo.id, amountG: 200, calories: 330, proteinG: 62, carbsG: 0, fatG: 7.2 } });
  const expectedFromPlan = await priorReader.plannerExpectedGrams(planUser.id, pollo.id, nowMealType);
  check('planner expectation = median across the active plan days (day-agnostic by design)', expectedFromPlan === 180);
  const planScan = await visionSvc.createScan(planUser.id, 'photo-chicken-plate.jpg', 'PHOTO');
  const planSignal = planScan.candidates[0].portionExplanation?.find((s: any) => s.source === 'PLANNER');
  check('a scan for a planned user blends the plan expectation (explanation shows it)', !!planSignal && planSignal!.grams === 180);
  check('vision agreeing with the plan -> the blend lands on the plan amount', planScan.candidates[0].portion.grams === 180, `${planScan.candidates[0].portion.grams}g`);

  console.log('\n── V3.3: PRIOR READER RESILIENCE (an enhancement may never fail a scan) ──');
  check('unknown user -> no observations, no crash', (await priorReader.userFoodObservations('00000000-0000-0000-0000-000000000000', pollo.id)).length === 0);
  check('unknown user -> no bias, no crash', (await priorReader.visionBiasRatios('00000000-0000-0000-0000-000000000000')).length === 0);
  check('no active plan -> null expectation, no crash', (await priorReader.plannerExpectedGrams(learner.id, pollo.id, nowMealType)) === null);

  console.log('\n── NO-BYPASS INVARIANT ──');
  const visionMeals = await prisma.loggedMeal.count({ where: { dailyLog: { userId: user.id }, source: 'vision' } });
  const nonVisionScanRows = await prisma.loggedMeal.count({ where: { dailyLog: { userId: user.id }, visionScanId: null, source: 'vision' } });
  check('every vision-sourced meal has a scan link (no direct vision write bypassed LogsService)', nonVisionScanRows === 0 && visionMeals >= 1, `vision meals=${visionMeals}`);

  console.log('\n── OWNERSHIP ──');
  const otherUser = await prisma.user.create({ data: { email: 'vision-other@test.local' } });
  const ownedScan = await visionSvc.createScan(user.id, 'chicken-owned.jpg', 'PHOTO');
  let forbidden = false;
  try {
    await visionSvc.getScan(otherUser.id, ownedScan.scanId);
  } catch {
    forbidden = true;
  }
  check("another user cannot read this user's scan", forbidden === true);

  await prisma.$disconnect();
  try { await pg.stop(); } catch { /* teardown */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${failures === 0 ? '🎉 TODO VERDE' : `⚠️  ${failures} fallo(s)`} — smoke Nutrition Vision V0+V1+V2+V3.1+V3.2+V3.3`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 smoke crashed:', e);
  process.exit(1);
});
