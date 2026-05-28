"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var AnthropicService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const TIMEOUT_MS = 10_000;
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;
let AnthropicService = AnthropicService_1 = class AnthropicService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(AnthropicService_1.name);
        const apiKey = config.get('ANTHROPIC_API_KEY', '');
        this.hasKey = !!apiKey;
        this.client = this.hasKey ? new sdk_1.default({ apiKey }) : null;
        this.model = config.get('CLAUDE_MODEL', 'claude-haiku-4-5');
    }
    async complete(req) {
        if (!this.hasKey)
            throw new Error('NO_API_KEY');
        try {
            return await this.callApi(req);
        }
        catch (err) {
            if (err instanceof sdk_1.default.RateLimitError) {
                this.logger.warn('Rate limited — retrying once after 1s');
                await sleep(RATE_LIMIT_RETRY_DELAY_MS);
                return this.callApi(req);
            }
            throw err;
        }
    }
    async callApi(req) {
        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: req.maxTokens ?? 250,
            system: [
                {
                    type: 'text',
                    text: req.systemPrompt,
                    cache_control: { type: 'ephemeral' },
                },
            ],
            messages: [{ role: 'user', content: req.userPrompt }],
        }, { timeout: TIMEOUT_MS });
        const text = response.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
        const u = response.usage;
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
};
exports.AnthropicService = AnthropicService;
exports.AnthropicService = AnthropicService = AnthropicService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AnthropicService);
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=anthropic.service.js.map