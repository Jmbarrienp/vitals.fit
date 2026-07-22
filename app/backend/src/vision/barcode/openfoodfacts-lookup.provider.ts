import { Injectable, Logger } from '@nestjs/common';
import { BarcodeLookupResult } from '../types/barcode-contract';
import { BarcodeLookupProvider } from './barcode-lookup.port';

const TIMEOUT_MS = 8_000; // a lookup is a simple GET; no reason to hold the scan as long as vision recognition
const API_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'product_name,brands,nutriments,serving_size,serving_quantity';

/**
 * The first REAL barcode backend (Phase 2D.2 V3.1). A free, public, keyless
 * REST API — unlike the vision provider, there is no `hasKey` gate here: no
 * account, no secret, no cost. `source: "open_food_facts"` was already a
 * pinned value in `FoodItem.source` before this slice existed, so the schema
 * anticipated this integration.
 *
 * Contained the same way `ClaudeVisionProvider` contains its vendor: this is
 * the only file that knows OpenFoodFacts' response shape. Callers get a
 * `BarcodeLookupResult`; the raw vendor JSON never leaves this class.
 */
@Injectable()
export class OpenFoodFactsLookupProvider implements BarcodeLookupProvider {
  readonly id = 'openfoodfacts';
  private readonly logger = new Logger(OpenFoodFactsLookupProvider.name);

  async lookup(barcode: string): Promise<BarcodeLookupResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE}/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'VitalsFit/1.0 (nutrition tracking app)' }, // OFF asks integrators to identify themselves
      });

      if (!response.ok) {
        // A 404 from OFF means "not registered" — a normal outcome, not a fetch error.
        if (response.status === 404) return this.notFound(start);
        throw new Error(`OPENFOODFACTS_HTTP_${response.status}`);
      }

      const body = (await response.json()) as OpenFoodFactsResponse;
      if (body.status !== 1 || !body.product) return this.notFound(start);

      const product = normalizeProduct(body.product);
      // The product exists in OFF but lacks usable macros — for a nutrition
      // tracker that is equivalent to not-found: nothing here can be logged.
      if (!product) return this.notFound(start);

      return {
        providerId: this.id,
        providerVersion: '1.0.0',
        found: true,
        product,
        latencyMs: Date.now() - start,
        raw: undefined, // OFF payloads carry no secrets, but nothing downstream needs them either
      };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error('BARCODE_LOOKUP_TIMEOUT');
      }
      this.logger.warn(`OpenFoodFacts lookup failed: ${(err as Error)?.message}`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private notFound(start: number): BarcodeLookupResult {
    return {
      providerId: this.id,
      providerVersion: '1.0.0',
      found: false,
      product: null,
      latencyMs: Date.now() - start,
    };
  }
}

interface OpenFoodFactsResponse {
  status: number;
  product?: {
    product_name?: string;
    brands?: string;
    serving_size?: string;
    serving_quantity?: number | string;
    nutriments?: Record<string, unknown>;
  };
}

/**
 * PURE, total: never throws. Returns null when the response can't be turned
 * into usable per-100g macros — that is the platform's line for "this is not
 * a loggable product," regardless of what else OFF returned.
 */
function normalizeProduct(raw: NonNullable<OpenFoodFactsResponse['product']>): BarcodeLookupResult['product'] {
  const n = raw.nutriments ?? {};
  const calories = num(n['energy-kcal_100g']);
  const protein = num(n['proteins_100g']);
  const carbs = num(n['carbohydrates_100g']);
  const fat = num(n['fat_100g']);
  if (calories === null || protein === null || carbs === null || fat === null) return null;

  const name = typeof raw.product_name === 'string' ? raw.product_name.trim() : '';
  if (!name) return null;

  return {
    name,
    brand: typeof raw.brands === 'string' && raw.brands.trim() ? raw.brands.trim().split(',')[0].trim() : null,
    servingGrams: num(raw.serving_quantity),
    caloriesPer100g: calories,
    proteinPer100g: protein,
    carbsPer100g: carbs,
    fatPer100g: fat,
    fiberPer100g: num(n['fiber_100g']) ?? 0,
  };
}

function num(x: unknown): number | null {
  const n = typeof x === 'string' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}
