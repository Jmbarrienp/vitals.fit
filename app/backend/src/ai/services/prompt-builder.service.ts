import { Injectable } from '@nestjs/common';
import { UserSnapshot } from '../../recommendations/types/user-snapshot';

@Injectable()
export class PromptBuilderService {
  private static readonly SYSTEM_PROMPT = `Eres el motor de recomendaciones de Vitals Fit.
Tu función es generar UNA recomendación nutricional concreta basada en los datos del usuario.

REGLAS ESTRICTAS DE SALIDA:
- MÁXIMO 2-3 frases. NUNCA más.
- Sin saludos, sin despedidas, sin emojis, sin markdown, sin preguntas.
- Sin frases motivacionales genéricas ("¡Sigue así!", "¡Buen trabajo!").
- Texto plano, directo, accionable.
- Siempre menciona un alimento concreto o una cantidad específica.
- Si el usuario va bien, confirma qué mantener. Si va mal, di exactamente qué ajustar.`;

  getSystemPrompt(): string {
    return PromptBuilderService.SYSTEM_PROMPT;
  }

  buildUserPrompt(snap: UserSnapshot): string {
    const calRem = snap.targets.calories - snap.today.caloriesLogged;
    const protRem = snap.targets.proteinG - snap.today.proteinG;

    const trendStr =
      snap.progress.weightTrendKg !== null
        ? `${snap.progress.weightTrendKg > 0 ? '+' : ''}${snap.progress.weightTrendKg}kg`
        : 'sin datos';

    const mealsStr =
      snap.today.recentMeals.length > 0
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
}
