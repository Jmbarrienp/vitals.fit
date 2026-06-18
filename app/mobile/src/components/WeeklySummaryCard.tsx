import { View, Text } from 'react-native';
import { Card } from './Card';
import type { IntelligenceSnapshot } from '../types';
import { BEHAVIOR_FLAG_COPY, PLATEAU_COPY, reasonLabel, trendCopy } from '../lib/intelligence';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row py-2.5 border-b border-border">
      <Text className="text-text-muted text-xs w-24 pt-0.5">{label}</Text>
      <View className="flex-1">{children}</View>
    </View>
  );
}

/**
 * Weekly nutrition summary, composed only from the backend snapshot. Every
 * judgment (on-track, plateau, main issue) comes from the rollup; the client
 * just selects which backend-decided value to show. No raw-log reconstruction.
 */
export function WeeklySummaryCard({ snapshot }: { snapshot: IntelligenceSnapshot }) {
  const trend = trendCopy(snapshot.trendStatus);
  const plateau = PLATEAU_COPY[snapshot.plateauStatus];
  const { daysLogged7d, avgCalories7d, avgCalories30d, calorieTarget } = snapshot.weekly;

  // Main issue = plateau if flagged, else the first detected habit, else none.
  const firstFlag = snapshot.behaviorFlags[0];
  const mainIssue = plateau
    ? plateau.detail
    : firstFlag
      ? BEHAVIOR_FLAG_COPY[firstFlag]?.detail
      : null;

  const top = snapshot.topRecommendation;
  const topReason = reasonLabel(top?.reason);

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
          Tu semana
        </Text>
        <Text className="text-base">📊</Text>
      </View>

      <Row label="Estado">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-semibold" style={{ color: trend.color }}>
            {trend.icon} {trend.label}
          </Text>
        </View>
        <Text className="text-text-muted text-xs mt-0.5">{trend.detail}</Text>
      </Row>

      <Row label="Registro">
        <Text className="text-text-primary text-sm">{daysLogged7d} de 7 días</Text>
        {avgCalories7d !== null && (
          <Text className="text-text-muted text-xs mt-0.5">
            ~{Math.round(avgCalories7d)} kcal/día
            {avgCalories30d !== null ? ` · promedio 30d: ~${Math.round(avgCalories30d)}` : ''}
            {calorieTarget ? ` · meta: ${calorieTarget}` : ''}
          </Text>
        )}
      </Row>

      <Row label="Principal">
        <Text className="text-text-primary text-sm leading-5">
          {mainIssue ?? 'Sin alertas esta semana. Buen trabajo.'}
        </Text>
      </Row>

      {top && (
        <View className="pt-3">
          <Text className="text-text-muted text-xs uppercase tracking-wider mb-1">
            Qué hacer ahora{topReason ? ` · ${topReason}` : ''}
          </Text>
          <Text className="text-text-primary text-sm leading-5">{top.message}</Text>
        </View>
      )}
    </Card>
  );
}
