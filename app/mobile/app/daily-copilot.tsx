import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { FEATURES } from '../src/config/features';
import { copilotApi } from '../src/api/copilot';

/**
 * Daily Copilot (V5.1) — the unified daily experience. PURE RENDERING: every
 * string on this screen, including the headings and the progress wording, was
 * written by the backend projection. This file contains no nutrition logic, no
 * arithmetic, no priority decision, and no copy table — if it did, the screen
 * would be a second place that decides what the data means.
 *
 * The user sees ONE assistant: a single focus, why, what to do, what to eat,
 * their pledge, and how the week is going. The ten engines behind it are
 * invisible by design.
 */

const ACTION_ICON: Record<string, string> = { PRIORITY: '⭐', COMMITMENT: '🤝', LOG: '📷' };

export default function DailyCopilotScreen() {
  const router = useRouter();
  const [daily, setDaily] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!FEATURES.copilot) return;
    (async () => {
      try {
        const res = await copilotApi.daily();
        setDaily(res.data);
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

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-5 pt-14 pb-10">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-text-primary text-2xl font-bold">Hoy</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        {state === 'loading' && <Card className="items-center py-10"><ActivityIndicator size="large" color="#6366f1" /></Card>}
        {state === 'error' && <Card><Text className="text-text-muted text-sm">No pudimos preparar tu día. Intenta de nuevo.</Text></Card>}

        {state === 'ready' && daily && (
          <>
            {/* 1 + 2 — the single focus and why */}
            <Card className="mb-3">
              <Text className="text-text-primary text-lg font-bold mb-1">{daily.focus?.title}</Text>
              <Text className="text-text-muted text-[11px]">{daily.focus?.why}</Text>
            </Card>

            {/* 3 — concrete actions, priority first */}
            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Tu plan de hoy</Text>
              {(daily.todaysPlan?.actions ?? []).map((a: any, i: number) => (
                <View key={i} className="flex-row py-2 border-b border-border">
                  <Text className="text-base mr-2">{ACTION_ICON[a.kind] ?? '•'}</Text>
                  <Text className="text-text-primary text-sm flex-1">{a.text}</Text>
                </View>
              ))}
              {daily.visionCta && (
                <View className="mt-3">
                  <Button label="Registrar con la cámara" onPress={() => router.push('/(tabs)/log')} />
                </View>
              )}
            </Card>

            {/* 4 — meals */}
            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Qué comer</Text>
              {(daily.meals?.items ?? []).map((m: any, i: number) => (
                <Text key={i} className="text-text-muted text-sm mb-1">• {m.name}</Text>
              ))}
              {(daily.meals?.items ?? []).length === 0 && (
                <Text className="text-text-muted text-xs">{daily.meals?.note}</Text>
              )}
            </Card>

            {/* 5 — commitments */}
            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Tu compromiso</Text>
              {(daily.commitments?.active ?? []).map((c: any, i: number) => (
                <View key={i} className="py-1">
                  <Text className="text-text-primary text-sm">{c.message}</Text>
                  <Text className="text-text-muted text-[10px]">vence {c.expiresAt}</Text>
                </View>
              ))}
              {(daily.commitments?.active ?? []).length === 0 && (
                <Text className="text-text-muted text-xs">{daily.commitments?.note}</Text>
              )}
            </Card>

            {/* 6 — progress */}
            <Card>
              <Text className="text-text-primary text-base font-semibold mb-1">{daily.progress?.headline}</Text>
              {(daily.progress?.metrics ?? []).map((m: any, i: number) => (
                <View key={i} className="flex-row items-center justify-between py-1">
                  <Text className="text-text-muted text-xs">{m.label}</Text>
                  <Text className="text-text-primary text-xs font-semibold">{m.value}</Text>
                </View>
              ))}
            </Card>
          </>
        )}
      </View>
    </ScrollView>
  );
}
