import { RecognitionResult } from '../types/vision-contract';

/**
 * Provider-response validation (Phase 2D.2 V0). EVERY provider response is
 * validated against the contract before it enters the system — no malformed
 * model output may reach the pipeline or Nutrition. Pure and deterministic; the
 * caller fails safe (treats an invalid result like a provider error -> FAILED scan).
 *
 * This is what keeps future adapters (Claude/GPT/Gemini/local) honest: they must
 * normalize into a valid RecognitionResult or be rejected at the boundary.
 */

export interface ValidationOutcome {
  valid: boolean;
  errors: string[]; // always present; empty when valid
  result?: RecognitionResult; // present only when valid
}

const MAX_DETECTIONS = 30; // a sane upper bound; more than this is almost certainly garbage

export function validateRecognitionResult(raw: unknown): ValidationOutcome {
  const errors: string[] = [];
  if (!isObject(raw)) return { valid: false, errors: ['result is not an object'] };
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyString(r.providerId)) errors.push('providerId must be a non-empty string');
  if (!isNonEmptyString(r.model)) errors.push('model must be a non-empty string');
  if (!isNonEmptyString(r.providerVersion)) errors.push('providerVersion must be a non-empty string');
  if (!isFiniteNumber(r.latencyMs) || (r.latencyMs as number) < 0) errors.push('latencyMs must be a number >= 0');

  if (!Array.isArray(r.detections)) {
    errors.push('detections must be an array');
    return { valid: false, errors };
  }
  if (r.detections.length > MAX_DETECTIONS) errors.push(`too many detections (> ${MAX_DETECTIONS})`);
  r.detections.forEach((d, i) => errors.push(...validateDetection(d, i)));

  // V3.4 — scene is an OPTIONAL enhancement, so it gets a different failure
  // policy than the core result: a malformed scene is stripped at this gate
  // (the cue is expendable) instead of failing the scan (which would give the
  // user a worse experience than manual entry over a hint they never asked
  // for). Nothing malformed passes; the scan itself is not hostage to it.
  if (r.scene !== undefined && !isValidScene(r.scene)) {
    delete r.scene;
  }

  // V3.5 — usage is telemetry, same policy as scene: optional, and stripped
  // when malformed rather than failing the scan. A billing counter must never
  // cost a user their proposal.
  if (r.usage !== undefined && !isValidUsage(r.usage)) {
    delete r.usage;
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], result: raw as unknown as RecognitionResult };
}

function isValidUsage(u: unknown): boolean {
  if (!isObject(u)) return false;
  return (
    isFiniteNumber(u.inputTokens) &&
    (u.inputTokens as number) >= 0 &&
    isFiniteNumber(u.outputTokens) &&
    (u.outputTokens as number) >= 0
  );
}

const SCENE_SETTINGS = ['RESTAURANT', 'HOME', 'UNKNOWN'];

function isValidScene(s: unknown): boolean {
  if (!isObject(s)) return false;
  if (typeof s.setting !== 'string' || !SCENE_SETTINGS.includes(s.setting)) return false;
  if (!isProbability(s.confidence)) return false;
  if (s.restaurantName !== null && typeof s.restaurantName !== 'string') return false;
  if (s.category !== null && typeof s.category !== 'string') return false;
  return true;
}

function validateDetection(d: unknown, i: number): string[] {
  if (!isObject(d)) return [`detection[${i}] is not an object`];
  const det = d as Record<string, unknown>;
  const e: string[] = [];

  if (!isNonEmptyString(det.label)) e.push(`detection[${i}].label must be a non-empty string`);
  if (!isProbability(det.labelConfidence)) e.push(`detection[${i}].labelConfidence must be a number in [0,1]`);

  if (det.boundingBox !== undefined) {
    const b = det.boundingBox as Record<string, unknown>;
    if (!isObject(b) || !['x', 'y', 'w', 'h'].every((k) => isFiniteNumber(b[k]))) {
      e.push(`detection[${i}].boundingBox must have numeric x/y/w/h`);
    }
  }
  if (det.portionHint !== undefined) {
    const p = det.portionHint as Record<string, unknown>;
    if (!isObject(p)) e.push(`detection[${i}].portionHint must be an object`);
    else {
      if (p.grams !== undefined && (!isFiniteNumber(p.grams) || (p.grams as number) < 0)) {
        e.push(`detection[${i}].portionHint.grams must be a number >= 0`);
      }
      if (p.confidence !== undefined && !isProbability(p.confidence)) {
        e.push(`detection[${i}].portionHint.confidence must be in [0,1]`);
      }
    }
  }
  if (
    det.attributes !== undefined &&
    (!Array.isArray(det.attributes) || !det.attributes.every((a) => typeof a === 'string'))
  ) {
    e.push(`detection[${i}].attributes must be a string[]`);
  }
  return e;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}
function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function isProbability(x: unknown): x is number {
  return isFiniteNumber(x) && (x as number) >= 0 && (x as number) <= 1;
}
