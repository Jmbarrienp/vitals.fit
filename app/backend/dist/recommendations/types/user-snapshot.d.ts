export interface RecentMeal {
    name: string;
    calories: number;
    mealType: string;
}
export interface UserSnapshot {
    userId: string;
    goal: 'lose' | 'maintain' | 'gain';
    persona: 'beginner' | 'athlete' | 'busy' | 'returning' | 'expert';
    sex: 'male' | 'female' | 'other';
    targets: {
        tdee: number;
        calories: number;
        proteinG: number;
        carbsG: number;
        fatG: number;
    };
    today: {
        caloriesLogged: number;
        proteinG: number;
        carbsG: number;
        fatG: number;
        mealsLogged: number;
        recentMeals: RecentMeal[];
    };
    progress: {
        weightTrendKg: number | null;
        adherencePct7d: number;
    };
    streak: {
        currentDays: number;
    };
}
