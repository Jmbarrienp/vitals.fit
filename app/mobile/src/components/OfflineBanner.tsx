import { View, Text } from 'react-native';
import Constants from 'expo-constants';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

const STATUS_BAR_HEIGHT = (Constants.statusBarHeight ?? 44) + 4;

export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999,
        elevation: 10,
        paddingTop: STATUS_BAR_HEIGHT,
      }}
      className="bg-warning/20 border-b border-warning/40 px-4 pb-3 flex-row items-center gap-2"
    >
      <Text className="text-base">📡</Text>
      <Text className="text-warning text-xs font-medium flex-1">
        Sin conexión. Mostrando los últimos datos disponibles.
      </Text>
    </View>
  );
}
