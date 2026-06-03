// Auth
export interface AuthResponse {
  access_token: string;
  user: { id: string; email: string };
}

export interface User {
  id: string;
  email: string;
  provider: 'EMAIL' | 'GOOGLE' | 'APPLE';
  isActive: boolean;
  createdAt: string;
  profile: UserProfile | null;
}

// Profile
export interface UserProfile {
  id: string;
  userId: string;
  name: string;
  age: number;
  weightKg: number;
  heightCm: number;
  sex: 'MALE' | 'FEMALE' | 'OTHER';
  activityLevel: 'SEDENTARY' | 'LIGHT' | 'MODERATE' | 'ACTIVE' | 'EXTRA';
  fitnessLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  persona: string;
  dietaryRestrictions: string[];
  allergies: string[];
  onboardingCompleted: boolean;
  equipment: 'GYM' | 'HOME' | 'NONE';
}

// Goals
export type GoalType = 'LOSE_FAT' | 'GAIN_MUSCLE' | 'MAINTAIN' | 'RECOMPOSITION' | 'HEALTH_WELLNESS';

export interface Goal {
  id: string;
  userId: string;
  type: GoalType;
  targetWeightKg: number | null;
  targetCalories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberTargetG: number;
  waterMl: number;
  bmr: number;
  tdee: number;
  isActive: boolean;
  createdAt: string;
}

// Nutrition
export interface NutritionResult {
  formula: string;
  calculations: {
    bmr: number;
    tdee: number;
    targetCalories: number;
    bmi: number;
    bmiCategory: string;
  };
  macros: {
    protein: { g: number; kcal: number; pct: number };
    fat:     { g: number; kcal: number; pct: number };
    carbs:   { g: number; kcal: number; pct: number };
    fiber:   { g: number };
    water:   { ml: number };
  };
  goal: Goal;
}

// Logs
export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

export interface LoggedMeal {
  id: string;
  mealType: MealType;
  name: string;
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  loggedAt: string;
}

export interface DailyLog {
  date: string;
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
  target: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  remaining: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  meals: LoggedMeal[];
}

// Progress
export interface WeightLog {
  id: string;
  weightKg: number;
  date: string;
  notes: string | null;
}

export interface ProgressSummary {
  recordings: number;
  startWeight: number;
  currentWeight: number;
  totalChange: number;
  weeklyRate: number;
  trend: 'losing' | 'gaining' | 'stable' | 'insufficient_data';
  goal: GoalType | null;
  history: WeightLog[];
}

// Recommendations
export interface Recommendation {
  id: string;
  type: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  trigger: string;
  messageForUser: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  planChange: boolean;
  calorieAdjustment: number | null;
  createdAt: string;
}
