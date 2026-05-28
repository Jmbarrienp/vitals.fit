import { useState } from 'react';
import { View, Text, ScrollView, Alert, RefreshControl, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { progressApi } from '../../src/api/progress';
import type { ProgressSummary, WeightLog } from '../../src/types';

const TREND_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  losing:            { label: 'Bajando', color: '#22c55e', emoji: '📉' },
  gaining:           { label: 'Subiendo', color: '#f59e0b', emoji: '📈' },
  stable:            { label: 'Estable', color: '#6366f1', emoji: '➡️' },
  insufficient_data: { label: 'Pocos datos', color: '#64748b', emoji: '⏳' },
};

// Formats a backend date as local date + time.
// Handles both pure "YYYY-MM-DD" strings (legacy) and full ISO timestamps.
function formatLocalDate(raw: string): string {
  const hasTime = raw.includes('T') && !raw.endsWith('T00:00:00.000Z');
  const d = hasTime ? new Date(raw) : (() => {
    const [y, mo, da] = raw.split('T')[0].split('-').map(Number);
    return new Date(y, mo - 1, da);
  })();

  const datePart = d.toLocaleDateString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  if (!hasTime) return datePart;
  const timePart = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  return (
    <Text className={`text-xs font-semibold ml-2 ${positive ? 'text-warning' : 'text-success'}`}>
      {positive ? '+' : ''}{delta.toFixed(1)} kg
    </Text>
  );
}

export default function ProgressScreen() {
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const { data: summary, isLoading, isError, refetch } = useQuery({
    queryKey: ['progress'],
    queryFn: () => progressApi.getSummary().then((r) => r.data as ProgressSummary),
    retry: 1,
  });

  const { mutate: logWeight, isPending } = useMutation({
    mutationFn: ({ w, n }: { w: number; n?: string }) => progressApi.logWeight(w, n),
    onSuccess: () => {
      setWeight('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['progress'] });
      Alert.alert('✅ Guardado', 'Peso registrado correctamente.');
    },
    onError: () => Alert.alert('Error', 'No se pudo guardar el peso.'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleLog = () => {
    const w = parseFloat(weight);
    if (!w || w < 20 || w > 400) {
      Alert.alert('Valor inválido', 'Ingresa un peso válido entre 20 y 400 kg.');
      return;
    }
    logWeight({ w, n: notes.trim() || undefined });
  };

  if (isLoading) return <LoadingScreen message="Cargando progreso..." />;

  const hasSummary = summary && 'currentWeight' in summary;
  const trend = hasSummary ? (TREND_CONFIG[summary.trend] ?? TREND_CONFIG.insufficient_data) : null;

  // Newest-first for display; keep oldest-first for delta calculation
  const historyDesc: WeightLog[] = hasSummary
    ? [...(summary.history ?? [])].reverse().slice(0, 10)
    : [];

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
      }
    >
      <View className="px-5 pt-14 pb-10">
        <Text className="text-text-primary text-2xl font-bold mb-1">Progreso</Text>
        <Text className="text-text-muted text-sm mb-6">
          Registra tu peso cada mañana en ayunas para resultados precisos.
        </Text>

        {/* ── Log weight ── */}
        <Card className="mb-5">
          <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
            Registrar peso hoy
          </Text>
          <View className="flex-row gap-3 items-end mb-3">
            <View className="flex-1">
              <Input
                label="Peso (kg)"
                value={weight}
                onChangeText={setWeight}
                placeholder="74.5"
                keyboardType="decimal-pad"
              />
            </View>
            <View className="mb-4 w-28">
              <Button label="Guardar" loading={isPending} onPress={handleLog} />
            </View>
          </View>
          <Input
            label="Nota (opcional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Ej: Después del entreno"
          />
        </Card>

        {/* ── Error state ── */}
        {isError && (
          <Card className="mb-4">
            <ErrorState
              message="No pudimos cargar tu historial de progreso."
              onRetry={() => void refetch()}
            />
          </Card>
        )}

        {/* ── Empty state ── */}
        {!isError && !hasSummary && (
          <Card>
            <EmptyState
              icon="⚖️"
              title="Sin registros de peso"
              message="Registra tu peso por primera vez para ver tu tendencia y progreso."
            />
          </Card>
        )}

        {/* ── Summary ── */}
        {hasSummary && (
          <>
            <Card className="mb-4">
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
                Resumen
              </Text>
              <View className="flex-row flex-wrap gap-3">
                {[
                  { label: 'Peso inicial', value: `${summary.startWeight} kg`, color: '#94a3b8' },
                  { label: 'Peso actual', value: `${summary.currentWeight} kg`, color: '#6366f1' },
                  {
                    label: 'Cambio total',
                    value: `${summary.totalChange > 0 ? '+' : ''}${summary.totalChange} kg`,
                    color:
                      summary.totalChange < 0
                        ? '#22c55e'
                        : summary.totalChange > 0
                        ? '#f59e0b'
                        : '#94a3b8',
                  },
                  {
                    label: 'Ritmo semanal',
                    value: `${summary.weeklyRate} kg/sem`,
                    color: '#94a3b8',
                  },
                  { label: 'Días trackeando', value: String(summary.daysTracked ?? historyDesc.length), color: '#94a3b8' },
                  {
                    label: 'Tendencia',
                    value: `${trend?.emoji} ${trend?.label}`,
                    color: trend?.color ?? '#94a3b8',
                  },
                ].map((item) => (
                  <View
                    key={item.label}
                    className="bg-background rounded-xl p-3"
                    style={{ width: '47%' }}
                  >
                    <Text className="text-text-muted text-xs mb-1">{item.label}</Text>
                    <Text className="font-bold text-sm" style={{ color: item.color }}>
                      {item.value}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>

            {/* ── History with delta ── */}
            {historyDesc.length > 0 && (
              <Card>
                <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
                  Últimos registros
                </Text>
                {historyDesc.map((log, i) => {
                  const prev = historyDesc[i + 1];
                  const delta = prev ? log.weightKg - prev.weightKg : null;
                  const isLast = i === historyDesc.length - 1;

                  return (
                    <View
                      key={log.id}
                      className={`flex-row items-center justify-between py-3 ${
                        !isLast ? 'border-b border-border' : ''
                      }`}
                    >
                      <View>
                        <Text className="text-text-primary text-sm font-medium">
                          {formatLocalDate(log.date as unknown as string)}
                        </Text>
                        {log.notes && (
                          <Text className="text-text-muted text-xs mt-0.5">{log.notes}</Text>
                        )}
                      </View>
                      <View className="flex-row items-center">
                        <Text className="text-primary font-bold">{log.weightKg} kg</Text>
                        {delta !== null && <DeltaBadge delta={delta} />}
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}
