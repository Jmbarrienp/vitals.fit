import { Injectable } from '@nestjs/common';
import { BarcodeLookupResult } from '../types/barcode-contract';
import { BarcodeLookupProvider } from './barcode-lookup.port';

/**
 * Deterministic, zero-cost BarcodeLookupProvider (Phase 2D.2 V3.1). Mirrors
 * `FixtureVisionProvider`: ships FIRST, makes the whole barcode pipeline
 * buildable/testable/demoable without any network call. Never random — the
 * same barcode always yields the same result. This is ALSO the honest
 * production default for an environment that wants deterministic behavior
 * (dev, CI, offline testing) without depending on OpenFoodFacts' uptime.
 */
@Injectable()
export class FixtureBarcodeLookupProvider implements BarcodeLookupProvider {
  readonly id = 'fixture';

  private static readonly PRODUCTS: Record<string, BarcodeLookupResult['product']> = {
    // GS1 prefix 750 = Mexico
    '7501055310209': {
      name: 'Galletas María',
      brand: 'Gamesa',
      servingGrams: 30,
      caloriesPer100g: 440,
      proteinPer100g: 7.5,
      carbsPer100g: 75,
      fatPer100g: 12,
      fiberPer100g: 2.5,
    },
    // GS1 prefix 770 = Colombia
    '7702010000015': {
      name: 'Arroz blanco',
      brand: 'Diana',
      servingGrams: 80,
      caloriesPer100g: 360,
      proteinPer100g: 7,
      carbsPer100g: 79,
      fatPer100g: 0.6,
      fiberPer100g: 1.3,
    },
  };

  async lookup(barcode: string): Promise<BarcodeLookupResult> {
    const start = Date.now();

    if (barcode.includes('notfound') || barcode === '0000000000000') {
      return this.result(false, null, start);
    }

    const known = FixtureBarcodeLookupProvider.PRODUCTS[barcode];
    if (known) return this.result(true, known, start);

    // Any other syntactically plausible barcode resolves to a generic packaged
    // product — keeps the happy path demoable without enumerating every case.
    return this.result(true, {
      name: 'Producto empacado',
      brand: null,
      servingGrams: null,
      caloriesPer100g: 250,
      proteinPer100g: 8,
      carbsPer100g: 30,
      fatPer100g: 10,
      fiberPer100g: 1,
    }, start);
  }

  private result(found: boolean, product: BarcodeLookupResult['product'], start: number): BarcodeLookupResult {
    return {
      providerId: this.id,
      providerVersion: '1.0.0',
      found,
      product,
      latencyMs: Date.now() - start,
      raw: { fixture: true },
    };
  }
}
