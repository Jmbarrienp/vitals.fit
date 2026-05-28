import { View, Text } from 'react-native';
import { Button } from './Button';

interface Props {
  icon?: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = '📭', title, message, actionLabel, onAction }: Props) {
  return (
    <View className="items-center py-10 px-6">
      <Text className="text-4xl mb-4">{icon}</Text>
      <Text className="text-text-primary font-semibold text-base mb-2 text-center">{title}</Text>
      <Text className="text-text-secondary text-sm text-center leading-5 mb-6">{message}</Text>
      {actionLabel && onAction && (
        <View className="w-48">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      )}
    </View>
  );
}
