import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useMe } from '../../src/hooks/useAuth';
import { useActiveGoal } from '../../src/hooks/useNutrition';
import { useProfile } from '../../src/hooks/useProfile';
import { useAuthStore } from '../../src/store/authStore';
import { Card } from '../../src/components/Card';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import type { GoalType, UserProfile } from '../../src/types';

const GOAL_LABELS: Record<GoalType, string> = {
  LOSE_FAT: 'Perder grasa',
  GAIN_MUSCLE: 'Ganar músculo',
  MAINTAIN: 'Mantenimiento',
  RECOMPOSITION: 'Recomposición',
  HEALTH_WELLNESS: 'Salud y bienestar',
};

const SEX_LABELS: Record<UserProfile['sex'], string> = {
  MALE: 'Hombre',
  FEMALE: 'Mujer',
  OTHER: 'Otro',
};

const ACTIVITY_LABELS: Record<UserProfile['activityLevel'], string> = {
  SEDENTARY: 'Sedentario',
  LIGHT: 'Ligero',
  MODERATE: 'Moderado',
  ACTIVE: 'Activo',
  EXTRA: 'Muy activo',
};

const FITNESS_LABELS: Record<UserProfile['fitnessLevel'], string> = {
  BEGINNER: 'Principiante',
  INTERMEDIATE: 'Intermedio',
  ADVANCED: 'Avanzado',
};

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 bg-background rounded-xl p-3 items-center">
      <Text className="text-text-primary font-bold text-sm">{value}</Text>
      <Text className="text-text-muted text-xs mt-0.5">{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { clearAuth } = useAuthStore();
  const { data: me, isLoading: loadingMe } = useMe();
  const { data: profileData, isLoading: loadingProfile } = useProfile();
  const { data: goal, isLoading: loadingGoal } = useActiveGoal();

  if (loadingMe || loadingProfile || loadingGoal) return <LoadingScreen message="Cargando perfil..." />;

  const profile = me?.profile ?? (profileData as { profile?: UserProfile })?.profile;
  const habits = (profileData as { habits?: { currentStreak?: number; longestStreak?: number } })
    ?.habits;
  const name = profile?.name ?? me?.email?.split('@')[0] ?? 'Usuario';
  const initial = name[0]?.toUpperCase() ?? 'U';
  const currentStreak = habits?.currentStreak ?? 0;
  const longestStreak = habits?.longestStreak ?? 0;

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: async () => {
          await clearAuth();
          router.replace('/login');
        },
      },
    ]);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      showsVerticalScrollIndicator={false}
    >
      <View className="px-5 pt-14 pb-12">

        {/* ── Avatar + identity ── */}
        <View className="items-center mb-8">
          <View className="w-20 h-20 rounded-full bg-primary/20 border-2 border-primary/40 items-center justify-center mb-3">
            <Text className="text-3xl font-bold text-primary">{initial}</Text>
          </View>
          <Text className="text-text-primary text-xl font-bold">{name}</Text>
          {me?.email && (
            <Text className="text-text-muted text-sm mt-1">{me.email}</Text>
          )}
        </View>

        {/* ── Physical stats ── */}
        {profile && (
          <Card className="mb-4">
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
              Perfil físico
            </Text>
            <View className="flex-row gap-2 mb-2">
              <StatBox label="Peso" value={`${profile.weightKg} kg`} />
              <StatBox label="Altura" value={`${profile.heightCm} cm`} />
              <StatBox label="Edad" value={`${profile.age} años`} />
            </View>
            <View className="flex-row gap-2">
              <StatBox label="Sexo" value={SEX_LABELS[profile.sex]} />
              <StatBox label="Actividad" value={ACTIVITY_LABELS[profile.activityLevel]} />
              <StatBox label="Nivel" value={FITNESS_LABELS[profile.fitnessLevel]} />
            </View>
          </Card>
        )}

        {/* ── Active goal ── */}
        {goal && (
          <Card className="mb-4">
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
              Objetivo actual
            </Text>
            <View className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 mb-4">
              <Text className="text-primary font-semibold text-base">
                {GOAL_LABELS[goal.type]}
              </Text>
            </View>
            <View className="flex-row justify-between">
              {[
                { label: 'Calorías', value: `${goal.targetCalories}`, color: '#6366f1' },
                { label: 'Proteína', value: `${goal.proteinG}g`, color: '#818cf8' },
                { label: 'Carbos', value: `${goal.carbsG}g`, color: '#f59e0b' },
                { label: 'Grasa', value: `${goal.fatG}g`, color: '#22c55e' },
              ].map((item) => (
                <View key={item.label} className="items-center flex-1">
                  <Text className="font-bold text-sm" style={{ color: item.color }}>
                    {item.value}
                  </Text>
                  <Text className="text-text-muted text-xs mt-0.5">{item.label}</Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* ── Adherence / streak ── */}
        <Card className="mb-6">
          <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-4">
            Adherencia
          </Text>
          <View className="flex-row gap-3">
            <View className="flex-1 bg-background rounded-xl p-4 items-center">
              <Text className="text-2xl mb-1">🔥</Text>
              <Text className="text-text-primary font-bold text-xl">{currentStreak}</Text>
              <Text className="text-text-muted text-xs mt-0.5">Racha actual</Text>
            </View>
            <View className="flex-1 bg-background rounded-xl p-4 items-center">
              <Text className="text-2xl mb-1">🏆</Text>
              <Text className="text-text-primary font-bold text-xl">{longestStreak}</Text>
              <Text className="text-text-muted text-xs mt-0.5">Mejor racha</Text>
            </View>
          </View>
        </Card>

        {/* ── Logout ── */}
        <TouchableOpacity
          className="bg-danger/10 border border-danger/30 rounded-2xl py-4 items-center mb-6"
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text className="text-danger font-semibold text-base">Cerrar sesión</Text>
        </TouchableOpacity>

        <Text className="text-text-muted text-xs text-center">Vitals Fit · v1.0.0</Text>
      </View>
    </ScrollView>
  );
}
