import { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { recommendationsApi } from '../../src/api/recommendations';
import { Card } from '../../src/components/Card';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
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
  ACCEPTED: { text: 'Aceptada', color: '#22c55e' },
  REJECTED: { text: 'Ignorada', color: '#64748b' },
  EXPIRED:  { text: 'Expirada', color: '#64748b' },
};

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

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
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
