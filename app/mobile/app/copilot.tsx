import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { FEATURES } from '../src/config/features';
import { copilotApi } from '../src/api/copilot';

/**
 * The Copilot screen (V5.0) — PURE RENDERING of the coordinated session
 * contract. It computes nothing: focus, priority, next action, suggestions and
 * even which modules stayed silent were all decided server-side by the
 * runtime's deterministic composer. Tapping a suggestion navigates to the
 * module that owns it — the Copilot itself can act on nothing.
 */

const FOCUS_COPY: Record<string, { title: string; color: string }> = {
  LOGGING: { title: 'Retomar el registro', color: '#f59e0b' },
  COMMITMENT: { title: 'Tu compromiso', color: '#6366f1' },
  ISSUE: { title: 'Un pendiente que persiste', color: '#f97316' },
  ADJUSTMENT: { title: 'Ajuste del plan', color: '#38bdf8' },
  MAINTAIN: { title: 'Vas bien — protege la racha', color: '#22c55e' },
};
const CONFIDENCE_COLOR: Record<string, string> = { ALTA: '#22c55e', MEDIA: '#f59e0b', BAJA: '#64748b' };

export default function CopilotScreen() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!FEATURES.copilot) return;
    (async () => {
      try {
        const res = await copilotApi.session();
        setSession(res.data);
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  if (!FEATURES.copilot) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-text-muted text-sm text-center">El Copilot no está habilitado en esta build.</Text>
      </View>
    );
  }

  const focus = FOCUS_COPY[session?.currentFocus?.area] ?? { title: 'Tu sesión', color: '#64748b' };

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-5 pt-14 pb-10">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-text-primary text-2xl font-bold">Copilot</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        {state === 'loading' && <Card className="items-center py-10"><ActivityIndicator size="large" color="#6366f1" /></Card>}
        {state === 'error' && <Card><Text className="text-text-muted text-sm">No se pudo cargar tu sesión.</Text></Card>}

        {state === 'ready' && session && (
          <>
            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-base font-semibold" style={{ color: focus.color }}>{focus.title}</Text>
                <View className="px-2 py-0.5 rounded-full" style={{ borderWidth: 1, borderColor: CONFIDENCE_COLOR[session.confidence] ?? '#64748b' }}>
                  <Text className="text-[10px] font-semibold" style={{ color: CONFIDENCE_COLOR[session.confidence] ?? '#64748b' }}>{session.confidence}</Text>
                </View>
              </View>
              <Text className="text-text-muted text-[11px] mb-3">{session.currentFocus?.reason}</Text>
              <Text className="text-text-primary text-sm font-semibold mb-1">Siguiente paso</Text>
              <Text className="text-text-primary text-sm mb-1">{session.nextAction?.action}</Text>
              <Text className="text-text-muted text-[10px]">{session.nextAction?.reason}</Text>
              {session.currentFocus?.area === 'LOGGING' && (
                <View className="mt-3"><Button label="Registrar comida" onPress={() => router.push('/(tabs)/log')} /></View>
              )}
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Hoy</Text>
              <Row label="Calorías" value={`${session.currentGoals?.todayCalories} / ${session.currentGoals?.calories}`} />
              <Row label="Proteína" value={`${session.currentGoals?.todayProteinG} / ${session.currentGoals?.proteinG} g`} />
              <Row label="Comidas registradas" value={String(session.currentGoals?.mealsLoggedToday ?? 0)} />
              <Row label="Racha de registro" value={`${session.recentProgress?.loggingStreakDays ?? 0} días`} />
            </Card>

            {(session.activeCommitments ?? []).length > 0 && (
              <Card className="mb-3">
                <Text className="text-text-primary text-base font-semibold mb-2">Compromisos vivos</Text>
                {session.activeCommitments.map((c: any, i: number) => (
                  <Text key={i} className="text-text-muted text-xs mb-1">• {c.message}</Text>
                ))}
              </Card>
            )}

            {session.coachSummary && (
              <Card className="mb-3">
                <Text className="text-text-primary text-base font-semibold mb-1">Tu semana</Text>
                <Text className="text-text-primary text-xs mb-1">{session.coachSummary.summary}</Text>
                <Text className="text-text-muted text-[11px]">{session.coachSummary.diagnosis}</Text>
              </Card>
            )}

            {(session.mealSuggestions ?? []).length > 0 && (
              <Card className="mb-3">
                <Text className="text-text-primary text-base font-semibold mb-2">Ideas de comida</Text>
                {session.mealSuggestions.map((s: any, i: number) => (
                  <Text key={i} className="text-text-muted text-xs mb-1">• {s.text}</Text>
                ))}
              </Card>
            )}

            {(session.visionSuggestions ?? []).length > 0 && (
              <Card className="mb-3">
                {session.visionSuggestions.map((s: any, i: number) => (
                  <TouchableOpacity key={i} onPress={() => router.push('/(tabs)/log')}>
                    <Text className="text-text-primary text-xs">📷 {s.text}</Text>
                  </TouchableOpacity>
                ))}
              </Card>
            )}

            {(session.plannerRecommendations ?? []).length > 0 && (
              <Card className="mb-3">
                <Text className="text-text-primary text-base font-semibold mb-2">Tu plan</Text>
                <Text className="text-text-muted text-[11px] mb-1">{session.currentPlan?.headlineExplanation}</Text>
                {session.plannerRecommendations.slice(1).map((s: any, i: number) => (
                  <Text key={i} className="text-text-muted text-[10px] mb-0.5">• {s.text}</Text>
                ))}
              </Card>
            )}

            {(session.pendingQuestions ?? []).length > 0 && (
              <Card>
                <Text className="text-text-primary text-base font-semibold mb-2">Para poder ayudarte mejor</Text>
                {session.pendingQuestions.map((q: string, i: number) => (
                  <Text key={i} className="text-text-muted text-xs mb-1">• {q}</Text>
                ))}
              </Card>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-text-muted text-xs">{label}</Text>
      <Text className="text-text-primary text-xs font-semibold">{value}</Text>
    </View>
  );
}
