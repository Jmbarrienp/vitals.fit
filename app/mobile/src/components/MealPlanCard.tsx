import { View, Text } from 'react-native';
import { Card } from './Card';
import type { MealPlan, MealItem, FoodSource } from '../types';

const SLOT_EMOJI: Record<string, string> = { BREAKFAST: '🌅', LUNCH: '☀️', DINNER: '🌙', SNACK: '🍎' };
const SOURCE_LABEL: Record<FoodSource, string> = {
  favorite: '★ favorito',
  frequent: 'frecuente',
  recent: 'reciente',
  custom: 'tuyo',
  catalog: 'catálogo',
};

function Item({ item }: { item: MealItem }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-1 pr-2">
        <Text className="text-text-primary text-sm">{item.name}</Text>
        <Text className="text-text-muted text-[10px]">
          {item.grams}g · {SOURCE_LABEL[item.source]}
        </Text>
      </View>
      <Text className="text-text-muted text-xs">
        {item.calories} kcal · {Math.round(item.proteinG)}g P
      </Text>
    </View>
  );
}

/**
 * Adaptive meal plan (2D.1). Renders the backend's deterministic plan verbatim —
 * meals, portions, source tags, totals and rationale. The client computes nothing.
 */
export function MealPlanCard({ plan }: { plan: MealPlan }) {
  if (plan.meals.length === 0) return null;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
          Tu plan de comidas
        </Text>
        <Text className="text-base">🍽️</Text>
      </View>

      <Text className="text-text-muted text-xs mb-3">
        {plan.targets.calories} kcal · {plan.targets.proteinG}g proteína
        {plan.targets.source === 'planner-adjusted' ? ' · ajustado por tu progreso' : ''}
      </Text>

      {plan.meals.map((meal) => (
        <View key={meal.slot} className="mb-3 pb-2 border-b border-border">
          <View className="flex-row items-center justify-between mb-0.5">
            <Text className="text-text-primary text-sm font-semibold">
              {SLOT_EMOJI[meal.slot] ?? '🍽️'} {meal.name}
            </Text>
            <Text className="text-text-muted text-xs">
              {meal.totalCalories} kcal · {meal.totalProteinG}g P
            </Text>
          </View>
          {meal.items.map((it) => (
            <Item key={`${meal.slot}-${it.foodId}`} item={it} />
          ))}
        </View>
      ))}

      <View className="flex-row items-center justify-between">
        <Text className="text-text-secondary text-xs">
          Total: {plan.totals.calories} kcal · {plan.totals.proteinG}g P
        </Text>
        <Text className="text-text-muted text-[10px]">
          {plan.coverage.fromUserFoods}/{plan.coverage.totalItems} de tus alimentos
        </Text>
      </View>

      <Text className="text-text-muted text-xs leading-5 mt-2">{plan.rationale.summary}</Text>
    </Card>
  );
}
