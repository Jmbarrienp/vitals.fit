import { Injectable } from '@nestjs/common';
import { RecognitionHints, RecognitionResult, ScanSource } from '../types/vision-contract';
import { VisionProvider, VisionProviderCapabilities } from './vision-provider.port';

/**
 * Deterministic, zero-cost VisionProvider (Phase 2D.2 V0). Ships FIRST, before any
 * vendor key exists — it makes the whole pipeline buildable, testable and
 * demoable without a single external call. Mirrors the coach's `hasKey=false`
 * pattern: the platform never depends on a vendor being configured.
 *
 * Canned outcomes are selected by a keyword in `imageRef` (test/dev convenience),
 * defaulting to a generic two-food plate. Never random — same imageRef always
 * yields the same detections.
 */
@Injectable()
export class FixtureVisionProvider implements VisionProvider {
  readonly id = 'fixture';
  readonly capabilities: VisionProviderCapabilities = {
    multiFood: true,
    portionHints: true,
    barcode: false,
    ocr: false,
    video: false,
  };

  async recognize(req: { imageRef: string; source: ScanSource; hints?: RecognitionHints }): Promise<RecognitionResult> {
    const ref = req.imageRef.toLowerCase();

    if (ref.includes('empty') || ref.includes('blank')) {
      return this.result([], req.imageRef);
    }

    if (ref.includes('unrecognized') || ref.includes('mystery')) {
      return this.result(
        [{ label: 'alimento no identificado', labelConfidence: 0.22, attributes: ['unknown'] }],
        req.imageRef,
      );
    }

    // V3.4 — restaurant scenes. Same plate as the chicken ref (so catalog
    // matching exercises the SAME pipeline), plus scene-level perception.
    // 'faint' simulates a weak signal that must NOT clear the threshold.
    if (ref.includes('restaurant')) {
      const detections = [
        { label: 'pollo a la plancha', labelConfidence: 0.9, portionHint: { grams: 200, confidence: 0.6 } },
        { label: 'arroz blanco', labelConfidence: 0.82, portionHint: { grams: 180, confidence: 0.55 } },
      ];
      const scene = ref.includes('faint')
        ? { setting: 'RESTAURANT' as const, confidence: 0.3, restaurantName: null, category: null }
        : { setting: 'RESTAURANT' as const, confidence: 0.85, restaurantName: 'La Esquina Criolla', category: 'latam casera' };
      return { ...this.result(detections, req.imageRef), scene };
    }

    if (ref.includes('chicken') || ref.includes('pollo')) {
      return this.result(
        [
          { label: 'pollo a la plancha', labelConfidence: 0.92, boundingBox: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, portionHint: { grams: 180, confidence: 0.7 } },
          { label: 'arroz blanco', labelConfidence: 0.85, boundingBox: { x: 0.5, y: 0.1, w: 0.35, h: 0.35 }, portionHint: { grams: 150, confidence: 0.6 } },
          { label: 'brocoli', labelConfidence: 0.78, boundingBox: { x: 0.1, y: 0.5, w: 0.3, h: 0.3 } },
        ],
        req.imageRef,
      );
    }

    // Default: a generic plate.
    return this.result(
      [
        { label: 'proteina a la plancha', labelConfidence: 0.7, portionHint: { grams: 150, confidence: 0.5 } },
        { label: 'porcion de carbohidrato', labelConfidence: 0.62, portionHint: { grams: 120, confidence: 0.4 } },
      ],
      req.imageRef,
    );
  }

  private result(detections: RecognitionResult['detections'], imageRef: string): RecognitionResult {
    return {
      providerId: this.id,
      model: 'fixture-v1',
      providerVersion: '1.0.0',
      detections,
      latencyMs: 1,
      raw: { imageRef, fixture: true },
    };
  }
}
