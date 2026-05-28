import { AnthropicService } from '../../ai/services/anthropic.service';
import { PromptBuilderService } from '../../ai/services/prompt-builder.service';
import { ParserService } from '../../ai/services/parser.service';
import { TelemetryService } from '../../ai/services/telemetry.service';
import { ContextBuilderService } from './context-builder.service';
export declare class RecommendationService {
    private readonly anthropic;
    private readonly promptBuilder;
    private readonly parser;
    private readonly contextBuilder;
    private readonly telemetry;
    private static readonly FALLBACK;
    private static readonly MAX_TOKENS;
    private readonly logger;
    constructor(anthropic: AnthropicService, promptBuilder: PromptBuilderService, parser: ParserService, contextBuilder: ContextBuilderService, telemetry: TelemetryService);
    generateForUser(userId: string, trigger: string): Promise<string>;
}
