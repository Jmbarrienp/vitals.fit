"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PromptBuilderService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptBuilderService = void 0;
const common_1 = require("@nestjs/common");
let PromptBuilderService = PromptBuilderService_1 = class PromptBuilderService {
    getSystemPrompt() {
        return PromptBuilderService_1.SYSTEM_PROMPT;
    }
    buildUserPrompt(snap) {
        const calRem = snap.targets.calories - snap.today.caloriesLogged;
        const protRem = snap.targets.proteinG - snap.today.proteinG;
        const trendStr = snap.progress.weightTrendKg !== null
            ? `${snap.progress.weightTrendKg > 0 ? '+' : ''}${snap.progress.weightTrendKg}kg`
            : 'sin datos';
        const mealsStr = snap.today.recentMeals.length > 0
            ? snap.today.recentMeals
                .map((m) => `${m.mealType}: ${m.name} (${m.calories}kcal)`)
                .join(', ')
            : 'ninguna registrada';
        return `Meta: ${snap.goal} | Persona: ${snap.persona} | Sexo: ${snap.sex}
Calorías restantes hoy: ${calRem} kcal (${snap.today.caloriesLogged}/${snap.targets.calories}) | TDEE: ${snap.targets.tdee}
Proteína restante: ${protRem}g (${snap.today.proteinG}/${snap.targets.proteinG}g)
Carbos: ${snap.today.carbsG}/${snap.targets.carbsG}g | Grasa: ${snap.today.fatG}/${snap.targets.fatG}g
Últimas comidas: ${mealsStr}
Racha: ${snap.streak.currentDays} días | Adherencia 7d: ${snap.progress.adherencePct7d}% | Tendencia peso: ${trendStr}`;
    }
};
exports.PromptBuilderService = PromptBuilderService;
PromptBuilderService.SYSTEM_PROMPT = `Eres el motor de recomendaciones de Vitals Fit.
Tu función es generar UNA recomendación nutricional concreta basada en los datos del usuario.

REGLAS ESTRICTAS DE SALIDA:
- MÁXIMO 2-3 frases. NUNCA más.
- Sin saludos, sin despedidas, sin emojis, sin markdown, sin preguntas.
- Sin frases motivacionales genéricas ("¡Sigue así!", "¡Buen trabajo!").
- Texto plano, directo, accionable.
- Siempre menciona un alimento concreto o una cantidad específica.
- Si el usuario va bien, confirma qué mantener. Si va mal, di exactamente qué ajustar.`;
exports.PromptBuilderService = PromptBuilderService = PromptBuilderService_1 = __decorate([
    (0, common_1.Injectable)()
], PromptBuilderService);
//# sourceMappingURL=prompt-builder.service.js.map