import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useMe } from '../../src/hooks/useAuth';
import { useActiveGoal, useTodayLog } from '../../src/hooks/useNutrition';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../src/api/client';
import { ProgressRing } from '../../src/components/ProgressRing';
import { MacroBar } from '../../src/components/MacroBar';
import { Card } from '../../src/components/Card';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { EmptyState } from '../../src/components/EmptyState';
import type { DailyLog, LoggedMeal } from '../../src/types';

const MEAL_EMOJI: Record<string, string> = {
  BREAKFAST: '🌅',
  LUNCH: '☀️',
  DINNER: '🌙',
  SNACK: '🍎',
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data: me, isLoading: loadingMe, refetch: refetchMe } = useMe();
  const { data: goal, isLoading: loadingGoal, refetch: refetchGoal } = useActiveGoal();
  const { data: todayRaw, refetch: refetchToday } = useTodayLog();
  const { data: habitsData } = useQuery({
    queryKey: ['habits'],
    queryFn: () => apiClient.get('/users/me').then((r) => r.data),
    retry: false,
  });
  const router = useRouter();

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchMe(), refetchGoal(), refetchToday()]);
    setRefreshing(false);
  };

  if (loadingMe || loadingGoal) return <LoadingScreen message="Cargando tu plan..." />;

  const profile = me?.profile;
  const name = profile?.name?.split(' ')[0] ?? 'Usuario';
  const today = todayRaw as DailyLog | undefined;

  const calories = today?.totals?.calories ?? 0;
  const proteinG = today?.totals?.proteinG ?? 0;
  const carbsG = today?.totals?.carbsG ?? 0;
  const fatG = today?.totals?.fatG ?? 0;
  const meals: LoggedMeal[] = today?.meals ?? [];

  const targetCalories = goal?.targetCalories ?? 0;
  const caloriePct = targetCalories > 0 ? Math.round((calories / targetCalories) * 100) : 0;
  const remaining = Math.max(0, targetCalories - calories);
  const streak =
    (habitsData as { habits?: { currentStreak?: number } })?.habits?.currentStreak ?? 0;

  const todayLabel = new Date().toLocaleDateString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <ScrollView
      className="flex-1 bg-background"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
      }
      showsVerticalScrollIndicator={false}
    >
      <View className="px-5 pt-14 pb-8">

        {/* ── Header ── */}
        <View className="flex-row justify-between items-start mb-6">
          <View className="flex-1 mr-3">
            <Text className="text-text-muted text-sm capitalize">{todayLabel}</Text>
            <Text className="text-text-primary text-2xl font-bold mt-0.5">
              {getGreeting()}, {name} 👋
            </Text>
          </View>
          {streak > 0 && (
            <View className="bg-warning/10 border border-warning/30 px-3 py-2 rounded-xl flex-row items-center gap-1 mt-1">
              <Text className="text-base">🔥</Text>
              <Text className="text-warning font-bold text-sm">{streak}</Text>
            </View>
          )}
        </View>

        {/* ── Calorie ring ── */}
        {targetCalories > 0 ? (
          <Card className="items-center py-6 mb-4">
            <ProgressRing
              progress={caloriePct}
              size={180}
              strokeWidth={16}
              color={caloriePct >= 100 ? '#22c55e' : '#6366f1'}
              label={`${calories}`}
              sublabel="kcal de hoy"
            />
            <View className="flex-row gap-6 mt-5">
              <View className="items-center">
                <Text className="text-text-primary font-bold text-base">{targetCalories}</Text>
                <Text className="text-text-muted text-xs mt-0.5">Meta</Text>
              </View>
              <View className="w-px bg-border" />
              <View className="items-center">
                <Text className={`font-bold text-base ${remaining === 0 ? 'text-success' : 'text-text-primary'}`}>
                  {remaining}
                </Text>
                <Text className="text-text-muted text-xs mt-0.5">
                  {remaining === 0 ? '¡Meta!' : 'Restantes'}
                </Text>
              </View>
              <View className="w-px bg-border" />
              <View className="items-center">
                <Text className="text-text-primary font-bold text-base">{caloriePct}%</Text>
                <Text className="text-text-muted text-xs mt-0.5">Completado</Text>
              </View>
            </View>
          </Card>
        ) : (
          <Card className="mb-4">
            <EmptyState
              icon="⚡"
              title="Calcula tu plan"
              message="Termina el onboarding para ver tus calorías y macros personalizados."
              actionLabel="Configurar plan"
              onAction={() => router.push('/onboarding')}
            />
          </Card>
        )}

        {/* ── Macros ── */}
        {goal && goal.targetCalories > 0 && (
          <Card className="mb-4">
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
              Macros de hoy
            </Text>
            <View className="gap-3">
              <MacroBar label="Proteína" current={proteinG} target={goal.proteinG} color="#818cf8" />
              <MacroBar label="Carbohidratos" current={carbsG} target={goal.carbsG} color="#f59e0b" />
              <MacroBar label="Grasas" current={fatG} target={goal.fatG} color="#22c55e" />
            </View>
          </Card>
        )}

        {/* ── Metabolism ── */}
        {goal && goal.bmr > 0 && (
          <Card className="mb-4">
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
              Tu metabolismo
            </Text>
            <View className="flex-row justify-between">
              {[
                { label: 'BMR', value: String(Math.round(goal.bmr)), color: '#94a3b8' },
                { label: 'TDEE', value: String(Math.round(goal.tdee)), color: '#94a3b8' },
                { label: 'Meta', value: String(goal.targetCalories), color: '#6366f1' },
                { label: 'Agua', value: `${(goal.waterMl / 1000).toFixed(1)}L`, color: '#38bdf8' },
              ].map((item) => (
                <View key={item.label} className="items-center flex-1">
                  <Text className="font-bold text-sm" style={{ color: item.color }}>
                    {item.value}
                  </Text>
                  <Text className="text-text-muted text-xs mt-0.5">{item.label}</Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* ── Today's meals ── */}
        <View className="mb-4">
          <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">
            Comidas de hoy
          </Text>
          {meals.length === 0 ? (
            <Card>
              <EmptyState
                icon="🍽️"
                title="Sin comidas registradas"
                message="Registra tu primera comida del día para empezar a trackear."
                actionLabel="+ Agregar comida"
                onAction={() => router.push('/(tabs)/log')}
              />
            </Card>
          ) : (
            <View className="gap-2">
              {meals.map((meal) => (
                <Card key={meal.id} className="flex-row items-center">
                  <Text className="text-xl mr-3">{MEAL_EMOJI[meal.mealType] ?? '🍽️'}</Text>
                  <View className="flex-1">
                    <Text className="text-text-primary font-medium text-sm">{meal.name}</Text>
                    <Text className="text-text-muted text-xs mt-0.5">
                      P: {Math.round(meal.totalProteinG)}g · C: {Math.round(meal.totalCarbsG)}g · G:{' '}
                      {Math.round(meal.totalFatG)}g
                    </Text>
                  </View>
                  <Text className="text-primary font-bold text-sm">
                    {meal.totalCalories} kcal
                  </Text>
                </Card>
              ))}
            </View>
          )}
        </View>

        {/* ── CTA ── */}
        <TouchableOpacity
          className="bg-primary rounded-2xl py-4 items-center flex-row justify-center gap-2"
          onPress={() => router.push('/(tabs)/log')}
          activeOpacity={0.85}
        >
          <Text className="text-white text-xl">+</Text>
          <Text className="text-white font-semibold text-base">Registrar comida</Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}
