import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { useAuthStore } from '../../src/store/authStore';
import { useMe } from '../../src/hooks/useAuth';
import { LoadingScreen } from '../../src/components/LoadingScreen';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

export default function TabLayout() {
  const { isAuthenticated, isLoading: storeLoading } = useAuthStore();
  const { data: me, isLoading: meLoading, error } = useMe();
  const router = useRouter();

  // Only logout on 401 — network errors (offline, timeout) are transient and must NOT clear the session
  const isAuthError = !!(error && (error as { response?: { status?: number } })?.response?.status === 401);

  useEffect(() => {
    if (!storeLoading && !isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!meLoading && isAuthError) {
      router.replace('/login');
    }
  }, [isAuthenticated, storeLoading, meLoading, isAuthError]);

  if (storeLoading || (isAuthenticated && meLoading && !me)) {
    return <LoadingScreen message="Cargando tu cuenta..." />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#141420',
          borderTopColor: '#1e2035',
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 20,
          paddingTop: 10,
        },
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Registrar',
          tabBarIcon: ({ focused }) => <TabIcon emoji="➕" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progreso',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📈" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="recommendations"
        options={{
          title: 'Consejos',
          tabBarIcon: ({ focused }) => <TabIcon emoji="💡" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
