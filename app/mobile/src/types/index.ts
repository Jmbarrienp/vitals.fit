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

export interface LoggedMealItem {
  id: string;
  foodItemId: string | null;
  servingSizeId: string | null;
  nameSnapshot: string;
  quantity: number;
  unit: string;
  amountG: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface LoggedMeal {
  id: string;
  mealType: MealType;
  name: string;
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  loggedAt: string;
  items?: LoggedMealItem[];
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
  daysTracked: number; // returned by backend (progress.service.ts)
}

// Recommendations
export type RecommendationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'COMMITTED' // 2B.1 — user pledged to act on it
  | 'COMPLETED'; // 2B.1 — user marked the commitment done

export interface Recommendation {
  id: string;
  type: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  trigger: string;
  reason: string | null; // structured RecommendationReason code (2A.3)
  messageForUser: string;
  status: RecommendationStatus;
  planChange: boolean;
  calorieAdjustment: number | null;
  committedAt?: string | null; // 2B.1
  commitExpiresAt?: string | null; // 2B.1
  completedAt?: string | null; // 2B.1
  createdAt: string;
}

// ── Longitudinal nutrition intelligence (2A.4) ──
// These mirror backend enums. The client renders them; it never recomputes them.
export type PlateauStatus = 'INSUFFICIENT_DATA' | 'NONE' | 'PLATEAU_SUSPECTED';

export type BehaviorFlag =
  | 'PROTEIN_CHRONIC_LOW'
  | 'LOW_LOGGING_CONSISTENCY'
  | 'WEEKEND_OVEREATING'
  | 'BREAKFAST_SKIPPED';

export interface IntelligenceSnapshot {
  computedAt: string;
  scores: {
    adherence: number | null;
    nutrition: number | null;
  };
  trendStatus: string | null;
  plateauStatus: PlateauStatus;
  behaviorFlags: BehaviorFlag[];
  weekly: {
    daysLogged7d: number;
    avgCalories7d: number | null;
    avgCalories30d: number | null;
    calorieTarget: number | null;
    weightTrendKgWk: number | null;
    loggingStreak: number;
    proteinStreakDays: number; // 2B.1
    calorieStreakDays: number; // 2B.1
  };
  topRecommendation: {
    id: string; // 2B.1
    reason: string | null;
    message: string;
    type: string;
    priority: string;
    status: RecommendationStatus; // 2B.1
  } | null;
}

// ── Weekly Review + Behavior Follow-Up (2B.3) ──
// Read-only projection over the immutable weekly ledger + recommendation lifecycle.
// The client renders these structured codes via the copy map; it computes nothing.
export type ReviewMetric =
  | 'adherenceScore'
  | 'nutritionScore'
  | 'loggingStreak'
  | 'proteinStreakDays'
  | 'calorieStreakDays'
  | 'daysLogged';

export interface MetricDelta {
  metric: ReviewMetric;
  from: number | null;
  to: number | null;
  delta: number;
}

export type FollowUpBasis =
  | 'PERSISTENT_INTERVENED'
  | 'PERSISTENT_IGNORED'
  | 'NEW_ISSUE'
  | 'RESOLVED_NEXT'
  | 'MAINTAIN';

export interface NextPriority {
  reason: string;
  basis: FollowUpBasis;
}

export interface CommitmentOutcome {
  reason: string | null;
  status: 'COMPLETED' | 'EXPIRED';
  message: string;
}

export interface WeeklyReview {
  weekStart: string;
  isoYear: number;
  isoWeek: number;
  adherenceScore: number | null;
  nutritionScore: number | null;
  daysLogged: number;
  loggingStreak: number;
  improved: MetricDelta[];
  worsened: MetricDelta[];
  stable: ReviewMetric[];
  biggestOpportunity: string | null;
  biggestImprovement: string | null;
  commitments: {
    completed: number;
    expired: number;
    completionRate: number | null;
    outcomes: CommitmentOutcome[];
  };
  nextPriority: NextPriority | null;
}

export interface IssueFollowUp {
  issue: string;
  weeksActive: number;
  status: 'RESOLVED' | 'PERSISTING' | 'NEW';
  intervention: 'INTERVENED' | 'IGNORED' | 'NONE';
}

export interface FollowUp {
  resolved: IssueFollowUp[];
  persisting: IssueFollowUp[];
  emerged: IssueFollowUp[];
  successfulInterventions: number;
  repeatedFailures: number;
}

export interface RetentionMetrics {
  weeksTracked: number;
  recommendationCompletionRate: number | null;
  commitmentAcceptanceRate: number | null;
  commitmentCompletionRate: number | null;
  weeklyConsistency: number | null;
  improvementVelocity: number | null;
  interventionSuccessRate: number | null;
}

export interface ReviewSnapshot {
  hasReview: boolean;
  current: WeeklyReview | null;
  previous: WeeklyReview | null;
  followUp: FollowUp;
  retention: RetentionMetrics;
  nextPriorities: NextPriority[];
}

// ── Weekly Coach (2C.1) ──
// AI coaching over the model-agnostic contract. The structure is deterministic
// and backend-owned; a model only rephrases. Rendered as-is; the client computes nothing.
export interface WeeklyCoachOutput {
  summary: string;
  diagnosis: string;
  nextAction: string;
  optionalFollowUp: string | null;
  meta: {
    source: 'deterministic' | 'claude';
    outputVersion: number;
    promptVersion: number | null;
    grounding: {
      weekStart: string | null;
      primaryReason: string | null;
      nextPriorityBasis: string | null;
      biggestImprovement: string | null;
      contractVersion: number;
    };
  };
}

export interface WeeklyCoachResult {
  hasCoaching: boolean;
  output: WeeklyCoachOutput | null;
}

// ── Adaptive Meal Plan (2D.1) ──
// The execution layer: the planner's strategy turned into concrete meals from the
// user's own foods. Rendered as-is; the client computes nothing.
export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';
export type FoodSource = 'favorite' | 'frequent' | 'recent' | 'custom' | 'catalog';

export interface MealItem {
  foodId: string;
  name: string;
  source: FoodSource;
  grams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface PlannedMeal {
  slot: MealSlot;
  name: string;
  targetCalories: number;
  targetProteinG: number;
  items: MealItem[];
  totalCalories: number;
  totalProteinG: number;
}

export interface MealPlan {
  meta: { planner: string; version: number; contractVersion: number; plannerVersion: number; generatedAt: string };
  targets: { source: 'planner-adjusted' | 'current-goal'; calories: number; proteinG: number; carbsG: number; fatG: number };
  meals: PlannedMeal[];
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
  adaptations: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  rationale: { drivers: string[]; summary: string };
  coverage: { fromUserFoods: number; totalItems: number };
  reviewWindowDays: number;
  reviewDate: string;
}
