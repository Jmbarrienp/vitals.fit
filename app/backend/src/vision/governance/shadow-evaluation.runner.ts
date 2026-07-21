import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { VisionProviderRegistry } from '../providers/provider.registry';
import { VISION_IMAGE_STORE, VisionImageStore } from '../images/image-store.port';
import { validateRecognitionResult } from '../providers/response-validator';
import { ScanSource } from '../types/vision-contract';

/**
 * The Shadow Evaluation Runner (V4.1) — runs a CHALLENGER provider against a
 * real scan so the platform can compare providers on identical input.
 *
 * THE BINDING CONSTRAINT, and why this class is shaped the way it is: images
 * are ephemeral BY DESIGN (privacy over replayability — V2's decision, restated
 * by V3.5's replay engine, which is exactly why replay cannot re-run a
 * provider). `createScan` discards the bytes in its `finally`. So a challenger
 * can only ever see a real photo AT SCAN TIME. There is no "later".
 *
 * That forces a two-step design, and every step is chosen against the shadow
 * rules:
 *
 *   capture()  runs INSIDE the user's request but is pure in-memory Map work
 *              (resolve + put a shadow-owned copy). Sub-millisecond, no
 *              network, so the user cannot feel it. It exists ONLY to take
 *              ownership of the bytes before the main path's `finally` frees
 *              them — without it the challenger would race the discard.
 *
 *   run()      is fire-and-forget AFTER the proposal is on its way back. It
 *              makes the vendor call, writes append-only evidence, and always
 *              discards its own ref. It can never throw into the request: the
 *              caller invokes it with `void` and every path here is wrapped.
 *
 * What it will never do: influence the returned proposal, participate in a
 * vote, enter the write path, or write to any table other than its own
 * append-only evidence table.
 */

/** Shadow work never gets the main path's patience — a slow challenger is dropped, not waited on. */
const SHADOW_TIMEOUT_MS = 20_000;

export interface ShadowTicket {
  /** a shadow-OWNED image ref; the main path's ref lifecycle is untouched */
  ref: string;
  challengerId: string;
  source: ScanSource;
}

@Injectable()
export class ShadowEvaluationRunner {
  private readonly logger = new Logger(ShadowEvaluationRunner.name);
  private readonly challengerId: string | null;
  private readonly sampleRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: VisionProviderRegistry,
    @Inject(VISION_IMAGE_STORE) private readonly images: VisionImageStore,
    private readonly config: ConfigService,
  ) {
    const configured = this.config.get<string>('SHADOW_CHALLENGER_PROVIDER', '').trim();
    this.challengerId = configured.length > 0 ? configured : null;
    const rate = Number(this.config.get<string>('SHADOW_SAMPLE_RATE', '0'));
    this.sampleRate = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
  }

  /** Off unless a challenger is configured AND sampling is above zero. Ships inert. */
  get enabled(): boolean {
    return this.challengerId !== null && this.sampleRate > 0;
  }

  /**
   * Take ownership of the pixels for a sampled scan. In-memory only; returns
   * null (cheaply, silently) whenever shadow is off, unsampled, unresolvable,
   * or misconfigured. Never throws — a shadow problem must never become a user
   * problem.
   *
   * Sampling is DETERMINISTIC in the scan id, not random: the same scan always
   * makes the same decision, so an operator can reason about (and a test can
   * assert) exactly which scans carry shadow evidence.
   */
  async capture(scanId: string, imageRef: string, source: ScanSource): Promise<ShadowTicket | null> {
    try {
      if (!this.enabled || !this.challengerId) return null;
      if (!this.providers.get(this.challengerId)) return null; // unregistered challenger: nothing to run
      if (this.challengerId === this.providers.active().id) return null; // never shadow the incumbent against itself
      if (!sampled(scanId, this.sampleRate)) return null;

      const image = await this.images.resolve(imageRef);
      if (!image) return null; // fixture/keyword refs and expired entries: nothing to hand over

      const ref = await this.images.put(image.base64, image.mimeType);
      return { ref, challengerId: this.challengerId, source };
    } catch {
      return null;
    }
  }

  /**
   * Fire-and-forget. Runs the challenger, records append-only evidence, and
   * always releases its own image ref. Callers invoke this WITHOUT awaiting;
   * it resolves rather than rejects on every failure path.
   */
  async run(scanId: string, userId: string, ticket: ShadowTicket): Promise<void> {
    const started = Date.now();
    try {
      const provider = this.providers.get(ticket.challengerId);
      if (!provider) return;

      let detections: unknown = null;
      let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
      let failureReason: string | null = null;
      let model: string | null = null;
      let providerVersion: string | null = null;
      let tokensIn: number | null = null;
      let tokensOut: number | null = null;
      let latencyMs: number | null = null;

      try {
        const raw = await withTimeout(
          provider.recognize({ imageRef: ticket.ref, source: ticket.source, hints: { userId } }),
          SHADOW_TIMEOUT_MS,
        );
        latencyMs = raw?.latencyMs ?? Date.now() - started;

        // The SAME validation gate production uses. A challenger that cannot
        // produce a contract-valid result has failed — recorded as such, so
        // its availability is measured honestly rather than silently excused.
        const validation = validateRecognitionResult(raw);
        if (!validation.valid || !validation.result) {
          status = 'FAILED';
          failureReason = `VISION_INVALID_PROVIDER_RESPONSE: ${validation.errors.join('; ')}`;
        } else {
          detections = validation.result.detections;
          model = validation.result.model;
          providerVersion = validation.result.providerVersion;
          tokensIn = validation.result.usage?.inputTokens ?? null;
          tokensOut = validation.result.usage?.outputTokens ?? null;
        }
      } catch (err) {
        status = 'FAILED';
        failureReason = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
        latencyMs = Date.now() - started;
      }

      // Idempotent by the (scanId, providerId) unique index: a duplicate run
      // can never inflate the evidence corpus.
      await this.prisma.visionShadowRun.upsert({
        where: { scanId_providerId: { scanId, providerId: ticket.challengerId } },
        create: {
          scanId,
          userId,
          providerId: ticket.challengerId,
          providerModel: model,
          providerVersion,
          source: ticket.source,
          status,
          failureReason,
          detections: detections as never,
          latencyMs,
          tokensIn,
          tokensOut,
        },
        update: {}, // append-only: an existing verdict is never rewritten
      });
    } catch (err) {
      this.logger.warn(`shadow run failed for scan ${scanId}: ${err instanceof Error ? err.message : err}`);
    } finally {
      try {
        await this.images.discard(ticket.ref);
      } catch {
        /* the store is bounded by TTL and entry cap — a missed discard degrades to eviction */
      }
    }
  }
}

/**
 * Deterministic sampling: a stable hash of the scan id mapped into [0,1).
 * Not random, so the same scan always yields the same decision — reproducible
 * for operators and assertable in tests.
 */
export function sampled(scanId: string, rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < scanId.length; i++) {
    hash ^= scanId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000 < rate;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('SHADOW_RECOGNIZE_TIMEOUT')), ms)),
  ]);
}
