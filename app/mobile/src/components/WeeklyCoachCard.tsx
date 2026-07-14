import { View, Text } from 'react-native';
import { Card } from './Card';
import type { WeeklyCoachResult } from '../types';

/**
 * Weekly Coach card (2C.1). Renders the backend's structured coaching verbatim —
 * summary, diagnosis, the one concrete action, and an optional acknowledgement.
 * The client assigns no meaning and computes nothing. Gated until a week completes.
 */
export function WeeklyCoachCard({ result }: { result: WeeklyCoachResult }) {
  if (!result.hasCoaching || !result.output) return null;
  const c = result.output;

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
          Tu coach semanal
        </Text>
        <Text className="text-base">🎯</Text>
      </View>

      <Text className="text-text-primary text-sm leading-5 mb-3">{c.summary}</Text>

      <View className="mb-3">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-1">Diagnóstico</Text>
        <Text className="text-text-primary text-sm leading-5">{c.diagnosis}</Text>
      </View>

      <View className="bg-primary/10 border border-primary/30 rounded-xl p-3">
        <Text className="text-primary text-xs uppercase tracking-wider mb-1 font-semibold">Qué hacer</Text>
        <Text className="text-text-primary text-sm leading-5">{c.nextAction}</Text>
      </View>

      {c.optionalFollowUp && (
        <Text className="text-success text-sm leading-5 mt-3">✅ {c.optionalFollowUp}</Text>
      )}
    </Card>
  );
}
