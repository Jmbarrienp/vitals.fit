import { View, Text } from 'react-native';
import { Card } from './Card';
import type { BehaviorFlag } from '../types';
import { BEHAVIOR_FLAG_COPY } from '../lib/intelligence';

/**
 * Renders the typed habits the backend detected (behaviorFlags). The client does
 * not invent or reinterpret flags — it only labels what the rollup decided.
 * Renders nothing when there are no flags (no fluff).
 */
export function HabitFlags({ flags }: { flags: BehaviorFlag[] }) {
  if (!flags || flags.length === 0) return null;

  return (
    <View className="mb-4">
      <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">
        Hábitos detectados
      </Text>
      <View className="gap-2">
        {flags.map((flag) => {
          const c = BEHAVIOR_FLAG_COPY[flag];
          if (!c) return null;
          return (
            <Card key={flag} className="flex-row items-start gap-3">
              <View
                className="w-9 h-9 rounded-xl items-center justify-center"
                style={{ backgroundColor: `${c.color}1a` }}
              >
                <Text className="text-base">{c.icon}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-text-primary font-medium text-sm">{c.label}</Text>
                <Text className="text-text-muted text-xs mt-0.5 leading-4">{c.detail}</Text>
              </View>
            </Card>
          );
        })}
      </View>
    </View>
  );
}
