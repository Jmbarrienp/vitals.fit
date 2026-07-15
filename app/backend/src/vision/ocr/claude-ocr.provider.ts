import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LabelExtraction } from '../types/ocr-contract';
import { OCRProvider } from './ocr-provider.port';
import { VISION_IMAGE_STORE, VisionImageStore } from '../images/image-store.port';
import {
  LABEL_SCHEMA,
  OCR_PROMPT_VERSION,
  OCR_SYSTEM_PROMPT,
  OCR_USER_PROMPT,
  parseLabelExtraction,
} from './claude-ocr.prompt';

const TIMEOUT_MS = 25_000;
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;
const MAX_TOKENS = 1_000; // nine short string slots — generous headroom, far from truncation
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * The first real OCR backend (Phase 2D.2 V3.2) — one of only two files in the
 * platform that know a vendor exists (the other is `claude-vision.provider.ts`).
 * It implements the same `OCRProvider` port as the fixture; the parser, the
 * validator, the service and mobile cannot tell which one is active.
 *
 * A deliberate near-copy of the V2 vision adapter's structure rather than a
 * shared abstraction: the two do different jobs (recognize vs transcribe) with
 * different prompts, schemas and failure semantics, and prematurely unifying them
 * would couple two modalities that must stay independently swappable. The shared
 * parts that genuinely ARE shared — image transport, timeout discipline, the
 * hasKey gate — are reused, not duplicated.
 *
 * Vendor containment: the raw API response never leaves this class, prompts and
 * schema live in `claude-ocr.prompt.ts` and are never returned, and `model`
 * rides the internal contract for eval attribution only — the mobile-facing
 * `NutritionLabel.source` carries the provider id, never a model identifier.
 *
 * Degradation: no key, unresolvable image, timeout, refusal, truncation or
 * malformed JSON all raise, and `VisionScanService` degrades the scan to the
 * prefilled manual flow. OCR can fail; logging cannot.
 */
@Injectable()
export class ClaudeOCRProvider implements OCRProvider {
  readonly id = 'claude';

  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly logger = new Logger(ClaudeOCRProvider.name);

  /** Mirrors AnthropicService/ClaudeVisionProvider: the platform never assumes a vendor is configured. */
  readonly hasKey: boolean;

  constructor(
    config: ConfigService,
    @Inject(VISION_IMAGE_STORE) private readonly images: VisionImageStore,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY', '');
    this.hasKey = !!apiKey;
    this.client = this.hasKey ? new Anthropic({ apiKey }) : null;
    this.model = config.get<string>('OCR_MODEL', DEFAULT_MODEL);
  }

  async extract(req: { imageRef: string; hints?: { userId?: string } }): Promise<LabelExtraction> {
    if (!this.client) {
      // Not an outage — the documented unconfigured state. Scan degrades to manual.
      throw new Error('OCR_PROVIDER_UNAVAILABLE: no ANTHROPIC_API_KEY configured');
    }

    const image = await this.images.resolve(req.imageRef);
    if (!image) {
      throw new Error('OCR_IMAGE_UNRESOLVED: no image bytes for ref');
    }

    const startedAt = Date.now();
    const response = await this.callApi(image.base64, image.mimeType);
    const latencyMs = Date.now() - startedAt;

    if (response.stop_reason === 'refusal') {
      throw new Error('OCR_PROVIDER_REFUSAL: model declined to process the image');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('OCR_PROVIDER_TRUNCATED: response hit the token ceiling');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('OCR_PROVIDER_MALFORMED_JSON: response was not valid JSON');
    }

    return {
      providerId: this.id,
      model: this.model,
      providerVersion: OCR_PROMPT_VERSION,
      fields: parseLabelExtraction(payload),
      latencyMs,
      // Audit only, never persisted. Excludes the prompt and the response text so
      // no vendor payload can leak through `raw`.
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
        this.logger.warn('OCR rate limited — retrying once after 1s');
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
            text: OCR_SYSTEM_PROMPT,
            // Byte-identical across every scan; the image is the only volatile part.
            cache_control: { type: 'ephemeral' },
          } as Anthropic.TextBlockParam,
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: OCR_USER_PROMPT },
            ],
          },
        ],
        // Constrained decoding: the response is schema-valid by construction, so
        // `parseLabelExtraction` is a backstop rather than the common path.
        output_config: { format: { type: 'json_schema', schema: LABEL_SCHEMA } },
      },
      { timeout: TIMEOUT_MS },
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
