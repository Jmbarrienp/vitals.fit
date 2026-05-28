import { View, Text } from 'react-native';

interface Props {
  label: string;
  current: number;
  target: number;
  color: string;
  unit?: string;
}

export function MacroBar({ label, current, target, color, unit = 'g' }: Props) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const rounded = Math.round(current);

  return (
    <View className="flex-1">
      <View className="flex-row justify-between mb-1.5">
        <Text className="text-text-secondary text-xs font-medium">{label}</Text>
        <Text className="text-xs font-semibold" style={{ color }}>
          {rounded}<Text className="text-text-muted font-normal">/{target}{unit}</Text>
        </Text>
      </View>
      <View className="h-1.5 rounded-full bg-surface">
        <View
          className="h-1.5 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </View>
    </View>
  );
}
