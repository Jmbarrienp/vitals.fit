import { ScanSource } from '../types/vision-contract';
import { VisionProvider, VisionProviderCapabilities } from '../providers/vision-provider.port';
import { validateRecognitionResult } from '../providers/response-validator';

/**
 * Provider evaluation harness (Phase 2D.2 V0). Runs ANY VisionProvider through
 * the SAME port and measures the axes that decide whether a provider is fit for
 * production — execution success, latency, confidence, contract validity,
 * deterministic output, and unsupported-capability reporting.
 *
 * Built now, not postponed: this is exactly how Claude/GPT/Gemini/local models
 * will be compared later WITHOUT touching application code — each is just another
 * `VisionProvider` fed to `evaluateProvider`. Pure of app state; no DB, no network
 * of its own (a provider may do I/O, the harness does not).
 */

export interface EvalCase {
  name: string;
  imageRef: string;
  source: ScanSource;
  /** If set, the provider must advertise this capability; otherwise the case reports UNSUPPORTED. */
  requiresCapability?: keyof VisionProviderCapabilities;
}

export interface EvalCaseResult {
  name: string;
  capabilitySupported: boolean;
  executed: boolean;
  success: boolean; // resolved AND produced a contract-valid result
  errored: boolean;
  errorMessage: string | null;
  latencyMs: number | null;
  detectionCount: number | null;
  avgConfidence: number | null;
  contractValid: boolean | null;
  validationErrors: string[];
  deterministic: boolean | null; // same imageRef twice -> identical detections
}

export interface ProviderEvalReport {
  providerId: string;
  capabilities: VisionProviderCapabilities;
  cases: EvalCaseResult[];
  summary: {
    totalCases: number;
    executed: number;
    successRate: number; // successes / executed (0..1)
    avgLatencyMs: number | null;
    allDeterministic: boolean;
    allContractValid: boolean;
    unsupported: number;
  };
}

/** A default, provider-agnostic case set: normal, empty, unrecognized, and a barcode capability probe. */
export const DEFAULT_EVAL_CASES: EvalCase[] = [
  { name: 'standard_plate', imageRef: 'eval-chicken-plate.jpg', source: 'PHOTO' },
  { name: 'empty_image', imageRef: 'eval-blank.jpg', source: 'PHOTO' },
  { name: 'unrecognized_food', imageRef: 'eval-mystery.jpg', source: 'PHOTO' },
  { name: 'barcode_probe', imageRef: 'eval-barcode.jpg', source: 'BARCODE', requiresCapability: 'barcode' },
];

export async function evaluateProvider(provider: VisionProvider, cases: EvalCase[] = DEFAULT_EVAL_CASES): Promise<ProviderEvalReport> {
  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    results.push(await runCase(provider, c));
  }

  const executed = results.filter((r) => r.executed);
  const successes = executed.filter((r) => r.success);
  const latencies = executed.map((r) => r.latencyMs).filter((x): x is number => x !== null);

  return {
    providerId: provider.id,
    capabilities: provider.capabilities,
    cases: results,
    summary: {
      totalCases: results.length,
      executed: executed.length,
      successRate: executed.length > 0 ? successes.length / executed.length : 0,
      avgLatencyMs: latencies.length > 0 ? round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      allDeterministic: executed.every((r) => r.deterministic === true),
      allContractValid: executed.every((r) => r.contractValid === true),
      unsupported: results.filter((r) => !r.capabilitySupported).length,
    },
  };
}

async function runCase(provider: VisionProvider, c: EvalCase): Promise<EvalCaseResult> {
  // Capability negotiation: never run a case a provider can't support — report it.
  if (c.requiresCapability && !provider.capabilities[c.requiresCapability]) {
    return {
      name: c.name,
      capabilitySupported: false,
      executed: false,
      success: false,
      errored: false,
      errorMessage: null,
      latencyMs: null,
      detectionCount: null,
      avgConfidence: null,
      contractValid: null,
      validationErrors: [],
      deterministic: null,
    };
  }

  try {
    const start = Date.now();
    const first = await provider.recognize({ imageRef: c.imageRef, source: c.source });
    const latencyMs = Date.now() - start;
    const second = await provider.recognize({ imageRef: c.imageRef, source: c.source });

    const validation = validateRecognitionResult(first);
    const detections = validation.result?.detections ?? [];
    const avgConfidence =
      detections.length > 0 ? round(detections.reduce((s, d) => s + d.labelConfidence, 0) / detections.length) : null;
    const deterministic = JSON.stringify(first.detections) === JSON.stringify(second.detections);

    return {
      name: c.name,
      capabilitySupported: true,
      executed: true,
      success: validation.valid,
      errored: false,
      errorMessage: null,
      latencyMs,
      detectionCount: first.detections?.length ?? null,
      avgConfidence,
      contractValid: validation.valid,
      validationErrors: validation.valid ? [] : validation.errors,
      deterministic,
    };
  } catch (err) {
    return {
      name: c.name,
      capabilitySupported: true,
      executed: true,
      success: false,
      errored: true,
      errorMessage: err instanceof Error ? err.message : 'unknown error',
      latencyMs: null,
      detectionCount: null,
      avgConfidence: null,
      contractValid: false,
      validationErrors: [],
      deterministic: null,
    };
  }
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
