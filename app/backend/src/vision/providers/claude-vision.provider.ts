import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { RecognitionHints, RecognitionResult, ScanSource } from '../types/vision-contract';
import { VisionProvider, VisionProviderCapabilities } from './vision-provider.port';
import { VISION_IMAGE_STORE, VisionImageStore } from '../images/image-store.port';
import {
  DETECTION_SCHEMA,
  VISION_PROMPT_VERSION,
  VISION_SYSTEM_PROMPT,
  VISION_USER_PROMPT,
  parseDetections,
} from './claude-vision.prompt';

const TIMEOUT_MS = 25_000; // vision + a full image is slower than the coach's text call
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;
const MAX_TOKENS = 2_000; // ~30 detections of structured JSON, well clear of truncation
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * The first REAL recognition backend (Phase 2D.2 V2) — and the only file in the
 * platform that knows a vendor exists. It implements the same `VisionProvider`
 * port as `FixtureVisionProvider`; the pipeline, the service, the eval harness
 * and mobile cannot tell which one is active.
 *
 * Vendor containment, per the architecture's provider-agnostic rule:
 * - The raw API response never leaves this class. Callers get a `RecognitionResult`.
 * - Prompts and the schema live in `claude-vision.prompt.ts` and are never returned.
 * - `model` rides the internal contract for audit/eval attribution only; the
 *   mobile-facing `VisionScanProposal` has no such field, so no model identifier
 *   ever reaches a client.
 * - Zero nutrition knowledge. It emits labels, boxes and gram hints. Catalog
 *   matching and macro math stay in the platform.
 *
 * Degradation (architecture §"every failure degrades to manual"): no key, an
 * unresolvable image, a timeout, a refusal, truncation, malformed JSON, or a
 * network error all raise — `VisionScanService` catches, marks the scan FAILED,
 * and hands the user the prefilled manual flow. Recognition can fail; logging
 * cannot.
 *
 * Cost/latency is one env var: `VISION_MODEL` (claude-opus-4-8 default,
 * claude-sonnet-5 / claude-haiku-4-5 are cheaper tiers), no code change.
 */
@Injectable()
export class ClaudeVisionProvider implements VisionProvider {
  readonly id = 'claude';
  readonly capabilities: VisionProviderCapabilities = {
    multiFood: true,
    portionHints: true,
    barcode: false, // a dedicated decoder beats a VLM here — a future adapter's job
    ocr: false,
    video: false,
  };

  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly logger = new Logger(ClaudeVisionProvider.name);

  /** Mirrors AnthropicService: the platform never assumes a vendor is configured. */
  readonly hasKey: boolean;

  constructor(
    config: ConfigService,
    @Inject(VISION_IMAGE_STORE) private readonly images: VisionImageStore,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY', '');
    this.hasKey = !!apiKey;
    this.client = this.hasKey ? new Anthropic({ apiKey }) : null;
    this.model = config.get<string>('VISION_MODEL', DEFAULT_MODEL);
  }

  async recognize(req: { imageRef: string; source: ScanSource; hints?: RecognitionHints }): Promise<RecognitionResult> {
    if (!this.client) {
      // Not an outage — the documented unconfigured state. Scan degrades to manual.
      throw new Error('VISION_PROVIDER_UNAVAILABLE: no ANTHROPIC_API_KEY configured');
    }

    // The port hands over an opaque ref; bytes come from the store, never the wire.
    const image = await this.images.resolve(req.imageRef);
    if (!image) {
      throw new Error(`VISION_IMAGE_UNRESOLVED: no image bytes for ref (source=${req.source})`);
    }

    const startedAt = Date.now();
    const response = await this.callApi(image.base64, image.mimeType);
    const latencyMs = Date.now() - startedAt;

    if (response.stop_reason === 'refusal') {
      throw new Error('VISION_PROVIDER_REFUSAL: model declined to process the image');
    }
    if (response.stop_reason === 'max_tokens') {
      // Truncated JSON is unparseable by construction — fail rather than half-read it.
      throw new Error('VISION_PROVIDER_TRUNCATED: response hit the token ceiling');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      // Structured outputs should make this unreachable; if it happens the
      // validation gate would reject downstream anyway — fail here, explicitly.
      throw new Error('VISION_PROVIDER_MALFORMED_JSON: response was not valid JSON');
    }

    return {
      providerId: this.id,
      model: this.model,
      providerVersion: VISION_PROMPT_VERSION,
      detections: parseDetections(payload),
      latencyMs,
      // Audit only, and never persisted by the service. Deliberately excludes the
      // prompt and the response text so no vendor payload can leak through `raw`.
      raw: {
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      },
    };
  }

  private async callApi(base64: string, mimeType: Anthropic.Base64ImageSource['media_type']) {
    try {
      return await this.create(base64, mimeType);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        this.logger.warn('Vision rate limited — retrying once after 1s');
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        return this.create(base64, mimeType);
      }
      throw err;
    }
  }

  private create(base64: string, mimeType: Anthropic.Base64ImageSource['media_type']) {
    return this.client!.messages.create(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: VISION_SYSTEM_PROMPT,
            // The prompt is byte-identical across every scan; the image that
            // follows is the only volatile part, so the prefix caches cleanly.
            cache_control: { type: 'ephemeral' },
          } as Anthropic.TextBlockParam,
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: VISION_USER_PROMPT },
            ],
          },
        ],
        // Constrained decoding: the response is schema-valid by construction, which
        // is what turns the response-validator from a routine filter into a backstop.
        output_config: { format: { type: 'json_schema', schema: DETECTION_SCHEMA } },
      },
      { timeout: TIMEOUT_MS },
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
