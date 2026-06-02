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
    const protRemaining = Math.round(snap.targets.proteinG - snap.today.proteinG);
    const meals = snap.today.mealsLogged;
    const streak = snap.streak.currentDays;
    const pct = calTarget > 0 ? Math.round((calLogged / calTarget) * 100) : 0;
    if (meals === 0)
        return 'Empieza registrando el desayuno — los primeros datos del día son los más importantes.';
    if (calLogged > calTarget + 200)
        return `Hoy te pasaste ${calLogged - calTarget} kcal de tu meta. Sin drama — mañana retomas el plan.`;
    if (calLogged > calTarget)
        return `Llegaste a tu meta calórica por hoy. Buen trabajo.`;
    if (pct >= 85 && meals >= 3)
        return `Estás al ${pct}% de tu meta. Casi llegas — una comida pequeña puede completar el día.`;
    if (protRemaining > 40)
        return `Te faltan ${protRemaining}g de proteína para hoy. Agrega una fuente proteica en tu próxima comida.`;
    if (calRemaining > 500 && meals >= 3)
        return `Llevas ${meals} comidas pero te quedan ${calRemaining} kcal. Considera un snack proteico.`;
    if (streak >= 14)
        return `${streak} días seguidos. Eso ya no es motivación — es un hábito.`;
    if (streak >= 7)
        return `Una semana completa trackeando. La consistencia es lo que más importa.`;
    if (snap.progress.adherencePct7d < 40)
        return 'Esta semana fue difícil. No necesitas ser perfecto — solo registrar un poco cada día ya ayuda.';
    if (snap.progress.weightTrendKg !== null && snap.goal === 'lose' && snap.progress.weightTrendKg < -0.1)
        return 'Tus datos muestran progreso en la dirección correcta. Sigue así.';
    return `Llevas ${calLogged} de ${calTarget} kcal hoy (${pct}%). Vas bien.`;
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