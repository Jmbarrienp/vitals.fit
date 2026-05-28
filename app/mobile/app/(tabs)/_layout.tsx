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
  const { data: me, isLoading: meLoading, isError } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (!storeLoading && !isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!meLoading && isError) {
      router.replace('/login');
    }
  }, [isAuthenticated, storeLoading, meLoading, isError]);

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
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
