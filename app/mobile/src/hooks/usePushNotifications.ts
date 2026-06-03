import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { registerPushToken } from '../api/push';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();
  const foregroundSub = useRef<Notifications.EventSubscription | null>(null);
  const tapSub = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    void registerForPush();

    // Handle notification tap from cold start — delay lets expo-router finish initial navigation
    Notifications.getLastNotificationResponseAsync().then((res) => {
      if (res) {
        setTimeout(() => navigateFromNotification(res.notification.request.content.data, router), 300);
      }
    });

    foregroundSub.current = Notifications.addNotificationReceivedListener((_n) => {
      // foreground notification received — badge/alert handled by setNotificationHandler
    });

    tapSub.current = Notifications.addNotificationResponseReceivedListener((res) => {
      navigateFromNotification(res.notification.request.content.data, router);
    });

    return () => {
      foregroundSub.current?.remove();
      tapSub.current?.remove();
    };
  }, [isAuthenticated]);
}

function navigateFromNotification(
  data: Record<string, unknown>,
  router: ReturnType<typeof useRouter>,
) {
  const trigger = data?.trigger as string | undefined;
  if (trigger === 'meal.logged') {
    router.navigate('/(tabs)/recommendations');
  } else if (trigger === 'weight.updated' || trigger === 'progress') {
    router.navigate('/(tabs)/progress');
  } else {
    router.navigate('/(tabs)/dashboard');
  }
}

async function registerForPush(): Promise<void> {
  if (!Device.isDevice) {
    return; // simulators cannot receive push
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  const { status } =
    existing === 'granted'
      ? { status: existing }
      : await Notifications.requestPermissionsAsync();

  if (status !== 'granted') {
    return; // user denied push permissions
  }

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  if (!projectId) {
    return; // EAS not initialized — push unavailable
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch {
    // push registration failed silently — non-critical
  }
}
