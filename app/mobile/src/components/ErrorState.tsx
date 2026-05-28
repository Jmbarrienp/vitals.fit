import { View, Text } from 'react-native';
import { Button } from './Button';

interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ title, message, onRetry }: Props) {
  return (
    <View className="items-center py-10 px-6">
      <Text className="text-4xl mb-4">⚠️</Text>
      <Text className="text-text-primary font-semibold text-base mb-2 text-center">
        {title ?? 'Algo salió mal'}
      </Text>
      <Text className="text-text-secondary text-sm text-center leading-5 mb-6">
        {message ?? 'No pudimos cargar la información. Verifica tu conexión e intenta de nuevo.'}
      </Text>
      {onRetry && (
        <View className="w-48">
          <Button label="Intentar de nuevo" onPress={onRetry} />
        </View>
      )}
    </View>
  );
}
