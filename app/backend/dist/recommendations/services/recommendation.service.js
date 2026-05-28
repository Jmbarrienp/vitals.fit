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
var RecommendationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationService = void 0;
const common_1 = require("@nestjs/common");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const anthropic_service_1 = require("../../ai/services/anthropic.service");
const prompt_builder_service_1 = require("../../ai/services/prompt-builder.service");
const parser_service_1 = require("../../ai/services/parser.service");
const telemetry_service_1 = require("../../ai/services/telemetry.service");
const context_builder_service_1 = require("./context-builder.service");
let RecommendationService = RecommendationService_1 = class RecommendationService {
    constructor(anthropic, promptBuilder, parser, contextBuilder, telemetry) {
        this.anthropic = anthropic;
        this.promptBuilder = promptBuilder;
        this.parser = parser;
        this.contextBuilder = contextBuilder;
        this.telemetry = telemetry;
        this.logger = new common_1.Logger(RecommendationService_1.name);
    }
    async generateForUser(userId, trigger) {
        const startMs = Date.now();
        let snap;
        let inputTokenApprox;
        let outputTokens;
        let cacheHit = false;
        let fallbackUsed = false;
        let errorType;
        let result = RecommendationService_1.FALLBACK;
        let success = false;
        try {
            snap = await this.contextBuilder.buildSnapshot(userId);
            if (!this.anthropic.hasKey) {
                result = rulesEngine(snap);
                success = true;
                return result;
            }
            const systemPrompt = this.promptBuilder.getSystemPrompt();
            const userPrompt = this.promptBuilder.buildUserPrompt(snap);
            inputTokenApprox = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
            const response = await this.anthropic.complete({
                systemPrompt,
                userPrompt,
                maxTokens: RecommendationService_1.MAX_TOKENS,
            });
            outputTokens = response.usage.outputTokens;
            cacheHit = response.usage.cacheReadTokens > 0;
            result = this.parser.clean(response.text);
            success = true;
            return result;
        }
        catch (err) {
            const isTransient = err instanceof sdk_1.default.APIConnectionError ||
                err instanceof sdk_1.default.RateLimitError ||
                err instanceof sdk_1.default.InternalServerError ||
                (err instanceof Error && err.message.includes('timeout'));
            errorType = err instanceof Error ? err.constructor.name : 'UnknownError';
            fallbackUsed = isTransient;
            if (!isTransient)
                throw err;
            return result;
        }
        finally {
            const latencyMs = Date.now() - startMs;
            if (success) {
                this.logger.log(`userId=${userId} trigger=${trigger} latency=${latencyMs}ms ` +
                    `tokens=${outputTokens} cache=${cacheHit} success=true`);
            }
            else {
                this.logger.warn(`userId=${userId} trigger=${trigger} fallback=${fallbackUsed} ` +
                    `error=${errorType ?? 'none'} latency=${latencyMs}ms`);
            }
            this.telemetry.record({
                userId,
                trigger,
                model: this.anthropic.model,
                latencyMs,
                success,
                fallbackUsed,
                inputTokenApprox,
                outputTokens,
                cacheHit,
                compactSnapshot: snap ? toCompactSnapshot(snap) : undefined,
                finalRecommendation: success || fallbackUsed ? result.slice(0, 200) : undefined,
                errorType,
            });
        }
    }
};
exports.RecommendationService = RecommendationService;
RecommendationService.FALLBACK = 'Sigue manteniendo tus macros del día.';
RecommendationService.MAX_TOKENS = 250;
exports.RecommendationService = RecommendationService = RecommendationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [anthropic_service_1.AnthropicService,
        prompt_builder_service_1.PromptBuilderService,
        parser_service_1.ParserService,
        context_builder_service_1.ContextBuilderService,
        telemetry_service_1.TelemetryService])
], RecommendationService);
function rulesEngine(snap) {
    const calLogged = snap.today.caloriesLogged;
    const calTarget = snap.targets.calories;
    const calRemaining = calTarget - calLogged;
    const protRemaining = snap.targets.proteinG - snap.today.proteinG;
    const meals = snap.today.mealsLogged;
    const streak = snap.streak.currentDays;
    if (meals === 0)
        return 'Aún no registraste nada hoy. Empieza con el desayuno para trackear bien el día.';
    if (calLogged > calTarget)
        return `Superaste tu meta por ${calLogged - calTarget} kcal. Mañana vuelves al plan.`;
    if (calRemaining < 100 && meals >= 3)
        return `¡Meta casi cumplida! Solo te faltan ${calRemaining} kcal.`;
    if (protRemaining > 40)
        return `Llevas ${Math.round(snap.today.proteinG)}g de proteína. Agrega ${Math.round(protRemaining)}g más para cumplir el objetivo.`;
    if (calRemaining > 400 && meals >= 3)
        return `Te quedan ${calRemaining} kcal. Considera otra comida para no quedarte corto.`;
    if (streak >= 7)
        return `${streak} días seguidos registrando. Consistencia es la clave.`;
    if (snap.progress.adherencePct7d < 50)
        return 'Esta semana has cumplido menos del 50% de tus metas. Un día a la vez.';
    return `Llevas ${calLogged} de ${calTarget} kcal hoy. Vas por buen camino.`;
}
function toCompactSnapshot(snap) {
    return {
        goal: snap.goal,
        persona: snap.persona,
        calRemaining: snap.targets.calories - snap.today.caloriesLogged,
        protRemaining: snap.targets.proteinG - snap.today.proteinG,
        mealsLogged: snap.today.mealsLogged,
        streak: snap.streak.currentDays,
        adherence7d: snap.progress.adherencePct7d,
        weightTrend: snap.progress.weightTrendKg,
    };
}
//# sourceMappingURL=recommendation.service.js.map