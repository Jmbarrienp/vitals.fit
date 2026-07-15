import { ConfidenceBand, ScanSource } from './types/vision-contract';

/**
 * Vision-internal event definitions (Phase 2D.2 V0). These describe the scan
 * lifecycle for Vision's OWN telemetry/feedback surface. They are deliberately
 * NOT the platform's `meal.logged` event — nothing outside `vision/` subscribes
 * to them, so the plug-in stays severable and Nutrition is never coupled to
 * Vision. The one event that matters to the platform, `meal.logged`, is still
 * emitted only by LogsService when confirmation converges on the write path.
 */

export const VISION_EVENTS = {
  PROPOSED: 'vision.scan.proposed',
  CONFIRMED: 'vision.scan.confirmed',
  FAILED: 'vision.scan.failed',
} as const;

export class VisionScanProposedEvent {
  constructor(
    readonly userId: string,
    readonly scanId: string,
    readonly source: ScanSource,
    readonly candidateCount: number,
    readonly scanConfidence: { overall: number; band: ConfidenceBand },
  ) {}
}

export class VisionScanConfirmedEvent {
  constructor(
    readonly userId: string,
    readonly scanId: string,
    readonly loggedMealId: string | null,
    readonly itemCount: number,
  ) {}
}

export class VisionScanFailedEvent {
  constructor(
    readonly userId: string,
    readonly scanId: string,
    readonly reason: string,
  ) {}
}
