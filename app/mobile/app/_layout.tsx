import '../global.css';
import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/store/authStore';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { OfflineBanner } from '../src/components/OfflineBanner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      networkMode: 'offlineFirst',
    },
  },
});

export default function RootLayout() {
  const { loadFromStorage } = useAuthStore();
  usePushNotifications();

  useEffect(() => {
    loadFromStorage();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
        </Stack>
        <OfflineBanner />
      </View>
    </QueryClientProvider>
  );
}
