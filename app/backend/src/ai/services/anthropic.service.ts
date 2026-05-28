import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AiRequest, AiResponse } from '../types/ai.types';

const TIMEOUT_MS = 10_000;
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;

@Injectable()
export class AnthropicService {
  private readonly client: Anthropic;
  readonly model: string; // public — used by TelemetryService
  private readonly logger = new Logger(AnthropicService.name);

  readonly hasKey: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY', '');
    this.hasKey = !!apiKey;
    this.client = this.hasKey ? new Anthropic({ apiKey }) : (null as unknown as Anthropic);
    this.model = config.get('CLAUDE_MODEL', 'claude-haiku-4-5');
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    if (!this.hasKey) throw new Error('NO_API_KEY');
    try {
      return await this.callApi(req);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        this.logger.warn('Rate limited — retrying once after 1s');
        await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        return this.callApi(req);
      }
      throw err;
    }
  }

  private async callApi(req: AiRequest): Promise<AiResponse> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 250,
        system: [
          {
            type: 'text' as const,
            text: req.systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          } as Anthropic.TextBlockParam,
        ],
        messages: [{ role: 'user', content: req.userPrompt }],
      },
      { timeout: TIMEOUT_MS },
    );

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('');

    const u = response.usage as Anthropic.Usage & {
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };

    return {
      text,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
