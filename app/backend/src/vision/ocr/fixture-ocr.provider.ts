import { Injectable } from '@nestjs/common';
import { LabelExtraction, RawLabelFields } from '../types/ocr-contract';
import { OCRProvider } from './ocr-provider.port';

/**
 * Deterministic, zero-cost OCRProvider (Phase 2D.2 V3.2). Mirrors
 * `FixtureVisionProvider` and `FixtureBarcodeLookupProvider`: ships alongside the
 * real adapter so the whole OCR pipeline is buildable, testable and demoable with
 * no vendor key and no network. Never random — the same imageRef always yields
 * the same transcription.
 *
 * The canned cases are transcriptions of REAL label conventions, not tidy test
 * data: US decimal points with a volumetric serving, LATAM decimal commas, EU
 * kJ-first per-100g, a partially readable label, and an unreadable one. They are
 * what proves the platform's parser handles the world rather than a happy path.
 */
@Injectable()
export class FixtureOCRProvider implements OCRProvider {
  readonly id = 'fixture';

  private static readonly CASES: Record<string, RawLabelFields> = {
    // US: decimal points, volumetric serving with the metric weight in parens.
    us: {
      productName: 'Honey Nut Cereal',
      servingSize: '2/3 cup (55g)',
      servingsPerContainer: 'about 8',
      calories: '240',
      protein: '5 g',
      carbs: '46 g',
      fat: '3.5 g',
      basis: 'Per serving',
      confidence: 0.93,
    },
    // LATAM: decimal commas, Spanish field names, explicit kcal.
    latam: {
      productName: 'Galletas María',
      servingSize: '30 g',
      servingsPerContainer: '8',
      calories: '132 kcal',
      protein: '2,3 g',
      carbs: '22,5 g',
      fat: '3,6 g',
      basis: 'Por porción',
      confidence: 0.9,
    },
    // EU: kJ printed first, values per 100 g rather than per serving.
    eu: {
      productName: 'Müsli Crunchy',
      servingSize: '40 g',
      servingsPerContainer: '12',
      calories: '1046 kJ / 250 kcal',
      protein: '8,0 g',
      carbs: '60,0 g',
      fat: '9,5 g',
      basis: 'por 100 g',
      confidence: 0.88,
    },
    // Partially readable — protein smudged. Must degrade to REVIEW, not fail.
    partial: {
      productName: 'Barra de Proteína',
      servingSize: '50 g',
      servingsPerContainer: '',
      calories: '200',
      protein: '',
      carbs: '20 g',
      fat: '7 g',
      basis: 'per serving',
      confidence: 0.6,
    },
    // Physically impossible — macros outweigh the serving. The validator must reject.
    impossible: {
      productName: 'Etiqueta Dañada',
      servingSize: '10 g',
      servingsPerContainer: '1',
      calories: '400',
      protein: '40 g',
      carbs: '50 g',
      fat: '20 g',
      basis: 'per serving',
      confidence: 0.8,
    },
  };

  private static readonly UNREADABLE: RawLabelFields = {
    productName: '',
    servingSize: '',
    servingsPerContainer: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    basis: '',
    confidence: 0.1,
  };

  async extract(req: { imageRef: string }): Promise<LabelExtraction> {
    const start = Date.now();
    const ref = req.imageRef.toLowerCase();

    for (const [keyword, fields] of Object.entries(FixtureOCRProvider.CASES)) {
      if (ref.includes(keyword)) return this.result(fields, start);
    }
    if (ref.includes('unreadable') || ref.includes('blank')) {
      return this.result(FixtureOCRProvider.UNREADABLE, start);
    }
    // Default: a clean LATAM label — the region this product serves first.
    return this.result(FixtureOCRProvider.CASES.latam, start);
  }

  private result(fields: RawLabelFields, start: number): LabelExtraction {
    return {
      providerId: this.id,
      model: 'fixture-ocr-v1',
      providerVersion: '1.0.0',
      fields,
      latencyMs: Math.max(1, Date.now() - start),
      raw: { fixture: true },
    };
  }
}
