import { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { recommendationsApi } from '../../src/api/recommendations';
import { Card } from '../../src/components/Card';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { WeeklySummaryCard } from '../../src/components/WeeklySummaryCard';
import { WeeklyReviewCard } from '../../src/components/WeeklyReviewCard';
import { WeeklyCoachCard } from '../../src/components/WeeklyCoachCard';
import { MealPlanCard } from '../../src/components/MealPlanCard';
import { useIntelligence } from '../../src/hooks/useIntelligence';
import { useWeeklyReview } from '../../src/hooks/useWeeklyReview';
import { useWeeklyCoach } from '../../src/hooks/useWeeklyCoach';
import { useMealPlan } from '../../src/hooks/useMealPlan';
import { useCommitRecommendation, useCompleteRecommendation } from '../../src/hooks/useCommitment';
import { reasonLabel } from '../../src/lib/intelligence';
import type { Recommendation } from '../../src/types';

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#6366f1',
};

const TRIGGER_LABEL: Record<string, string> = {
  'meal.logged': 'Al registrar comida',
  'weight.updated': 'Al registrar peso',
  'simple_rules_engine': 'Análisis automático',
};

const STATUS_CFG: Record<string, { text: string; color: string }> = {
  ACCEPTED:  { text: 'Aceptada', color: '#22c55e' },
  REJECTED:  { text: 'Ignorada', color: '#64748b' },
  EXPIRED:   { text: 'Expirada', color: '#64748b' },
  COMMITTED: { text: 'Comprometido', color: '#6366f1' },
  COMPLETED: { text: 'Completado ✓', color: '#22c55e' },
};

/**
 * Phase 2B.1 — turns a recommendation into an accountable commitment. Only
 * actionable nudges (not plan-change confirmations) can be committed; once
 * committed the user can mark it done. Reads status from the backend; the
 * lifecycle lives there.
 */
function CommitActions({ rec }: { rec: Recommendation }) {
  const commit = useCommitRecommendation();
  const complete = useCompleteRecommendation();

  if (rec.status === 'PENDING' && !rec.planChange) {
    return (
      <TouchableOpacity
        className="mt-3 bg-primary/10 border border-primary/30 rounded-xl py-2.5 items-center flex-row justify-center gap-2"
        activeOpacity={0.8}
        disabled={commit.isPending}
        onPress={() => commit.mutate(rec.id)}
      >
        {commit.isPending ? (
          <ActivityIndicator size="small" color="#6366f1" />
        ) : (
          <Text className="text-primary font-semibold text-sm">✋ Me comprometo</Text>
        )}
      </TouchableOpacity>
    );
  }

  if (rec.status === 'COMMITTED') {
    return (
      <TouchableOpacity
        className="mt-3 bg-success/10 border border-success/30 rounded-xl py-2.5 items-center flex-row justify-center gap-2"
        activeOpacity={0.8}
        disabled={complete.isPending}
        onPress={() => complete.mutate(rec.id)}
      >
        {complete.isPending ? (
          <ActivityIndicator size="small" color="#22c55e" />
        ) : (
          <Text className="text-success font-semibold text-sm">✓ Marcar como hecho</Text>
        )}
      </TouchableOpacity>
    );
  }

  return null;
}

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor(diffMs / 60000);
  if (days >= 1) return `hace ${days}d`;
  if (hours >= 1) return `hace ${hours}h`;
  if (mins >= 1) return `hace ${mins}m`;
  return 'Ahora';
}

export default function RecommendationsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data: recs, isLoading, isError, refetch } = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => recommendationsApi.getHistory().then((r) => r.data),
    retry: 1,
  });
  const { data: intel, refetch: refetchIntel } = useIntelligence();
  const { data: reviewSnap, refetch: refetchReview } = useWeeklyReview();
  const { data: coach, refetch: refetchCoach } = useWeeklyCoach();
  const { data: mealPlan, refetch: refetchMealPlan } = useMealPlan();

  const showWeekly =
    !!intel && (intel.weekly.daysLogged7d > 0 || intel.topRecommendation !== null);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch(), refetchIntel(), refetchReview(), refetchCoach(), refetchMealPlan()]);
    setRefreshing(false);
  };

  if (isLoading) return <LoadingScreen message="Cargando consejos..." />;

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
      }
    >
      <View className="px-5 pt-14 pb-10">
        <Text className="text-text-primary text-2xl font-bold mb-1">Consejos</Text>
        <Text className="text-text-muted text-sm mb-6">
          Lo que el sistema aprendió de tus datos.
        </Text>

        {/* ── Weekly Coach (AI over the model-agnostic contract) ── */}
        {coach?.hasCoaching && <WeeklyCoachCard result={coach} />}

        {/* ── Adaptive Meal Plan (execution layer: strategy -> meals) ── */}
        {mealPlan && <MealPlanCard plan={mealPlan} />}

        {/* ── Weekly Review (closed-loop coaching over the ledger) ── */}
        {reviewSnap?.hasReview && <WeeklyReviewCard snapshot={reviewSnap} />}

        {/* ── This week so far (live backend-derived intelligence) ── */}
        {showWeekly && intel && <WeeklySummaryCard snapshot={intel} />}

        {isError && (
          <Card>
            <ErrorState
              message="No pudimos cargar los consejos."
              onRetry={() => void refetch()}
            />
          </Card>
        )}

        {!isError && (!recs || recs.length === 0) && (
          <Card>
            <EmptyState
              icon="💡"
              title="Sin consejos aún"
              message="Registra tus comidas y el sistema irá generando consejos personalizados para ti."
            />
          </Card>
        )}

        {!isError && recs && recs.length > 0 && (
          <View className="gap-3">
            {recs.map((rec: Recommendation) => {
              const statusCfg = STATUS_CFG[rec.status];
              const priorityColor = PRIORITY_COLOR[rec.priority] ?? '#6366f1';
              return (
                <Card key={rec.id}>
                  <View className="flex-row items-start gap-3">
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: priorityColor,
                        marginTop: 5,
                        flexShrink: 0,
                      }}
                    />
                    <View className="flex-1">
                      {reasonLabel(rec.reason) && (
                        <Text className="text-text-muted text-xs uppercase tracking-wider mb-1">
                          {reasonLabel(rec.reason)}
                        </Text>
                      )}
                      <Text className="text-text-primary text-sm leading-5">
                        {rec.messageForUser}
                      </Text>
                      <View className="flex-row items-center justify-between mt-3">
                        <Text className="text-text-muted text-xs">
                          {TRIGGER_LABEL[rec.trigger] ?? 'Sistema'}
                        </Text>
                        <View className="flex-row items-center gap-2">
                          {statusCfg && (
                            <Text style={{ color: statusCfg.color }} className="text-xs font-medium">
                              {statusCfg.text}
                            </Text>
                          )}
                          <Text className="text-text-muted text-xs">
                            {relativeTime(rec.createdAt)}
                          </Text>
                        </View>
                      </View>
                      <CommitActions rec={rec} />
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
