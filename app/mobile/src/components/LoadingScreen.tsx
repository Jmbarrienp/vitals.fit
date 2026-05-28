import { View, ActivityIndicator, Text } from 'react-native';

export function LoadingScreen({ message }: { message?: string }) {
  return (
    <View className="flex-1 bg-background items-center justify-center gap-3">
      <ActivityIndicator size="large" color="#6366f1" />
      {message && <Text className="text-text-secondary text-sm">{message}</Text>}
    </View>
  );
}
