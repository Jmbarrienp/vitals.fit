import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { FEATURES } from '../src/config/features';
import { rolloutApi } from '../src/api/rollout';

/**
 * Admin rollout dashboard (V4.0) — PURE RENDERING of backend-derived reports.
 * Operator-only (EXPO_PUBLIC_ADMIN_DASHBOARD flag, off by default), reachable
 * only by route — no user-facing navigation links to it. This screen computes
 * nothing: every number, stage, gate verdict and risk level was derived
 * server-side from append-only data, and this screen could not change any of
 * it if it tried — the API it consumes is read-only.
 */

const STAGE_COLOR: Record<string, string> = {
  DISABLED: '#64748b',
  SHADOW: '#818cf8',
  READY: '#22c55e',
  LIMITED: '#f59e0b',
  ROLLOUT: '#38bdf8',
  FULL: '#22c55e',
};
const LEVEL_COLOR: Record<string, string> = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' };
const GATE_COLOR: Record<string, string> = { PASS: '#22c55e', FAIL: '#ef4444', NOT_APPLICABLE: '#64748b' };
/** V4.1 — governance verdicts. PROMOTE/DEMOTE are actions a human still has to take. */
const ACTION_COLOR: Record<string, string> = {
  PROMOTE: '#22c55e', MAINTAIN: '#38bdf8', DEMOTE: '#ef4444', HOLD: '#f59e0b', REQUIRE_MORE_DATA: '#64748b',
};
const DRIFT_COLOR: Record<string, string> = { STABLE: '#22c55e', DRIFTING: '#ef4444', INSUFFICIENT_DATA: '#64748b' };

export default function AdminRolloutScreen() {
  const router = useRouter();
  const [data, setData] = useState<{ status?: any; health?: any; risk?: any; trust?: any; timeline?: any; governance?: any; drift?: any; shadow?: any }>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!FEATURES.adminDashboard) return;
    (async () => {
      try {
        const [status, health, risk, trust, timeline, governance, drift, shadow] = await Promise.all([
          rolloutApi.status(), rolloutApi.health(), rolloutApi.risk(), rolloutApi.trust(), rolloutApi.timeline(),
          rolloutApi.governanceRecommendation(), rolloutApi.governanceDrift(), rolloutApi.governanceShadow(),
        ]);
        setData({
          status: status.data, health: health.data, risk: risk.data, trust: trust.data, timeline: timeline.data,
          governance: governance.data, drift: drift.data, shadow: shadow.data,
        });
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  if (!FEATURES.adminDashboard) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-text-muted text-sm text-center">Panel de operador deshabilitado en esta build.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-5 pt-14 pb-10">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-text-primary text-2xl font-bold">Rollout · Vision</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        {state === 'loading' && (
          <Card className="items-center py-10"><ActivityIndicator size="large" color="#6366f1" /></Card>
        )}
        {state === 'error' && (
          <Card><Text className="text-text-muted text-sm">No se pudieron cargar los reportes de rollout.</Text></Card>
        )}

        {state === 'ready' && (
          <>
            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-text-primary text-base font-semibold">Estado global</Text>
                <Badge label={data.status?.global?.stage ?? '—'} color={STAGE_COLOR[data.status?.global?.stage] ?? '#64748b'} />
              </View>
              <Text className="text-text-muted text-[11px] mb-2">{data.status?.global?.reasons?.[0]}</Text>
              <Text className="text-text-muted text-[11px]">
                proveedor activo: {data.status?.generatedFor?.activeProviderId} · auto-accept: {data.status?.generatedFor?.autoAcceptEnabled ? 'ON' : 'sombra'}
              </Text>
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Modalidades</Text>
              {(data.status?.perModality ?? []).map((m: any) => (
                <View key={m.modality} className="py-2 border-b border-border">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-text-primary text-sm">{m.modality}</Text>
                    <Badge label={m.stage} color={STAGE_COLOR[m.stage] ?? '#64748b'} />
                  </View>
                  <Text className="text-text-muted text-[10px]">{m.reasons?.[0]}</Text>
                </View>
              ))}
            </Card>

            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-text-primary text-base font-semibold">Gobernanza de proveedor</Text>
                <Badge label={data.governance?.action ?? '—'} color={ACTION_COLOR[data.governance?.action] ?? '#64748b'} />
              </View>
              <Text className="text-text-muted text-[11px] mb-2">
                {data.governance?.incumbentId} vs {data.governance?.challengerId ?? 'sin challenger'} · {data.governance?.evidence?.pairedScans ?? 0} scans pareados
              </Text>
              {(data.governance?.reasons ?? []).slice(0, 3).map((r: string, i: number) => (
                <Text key={i} className="text-text-muted text-[10px] mb-0.5">• {r}</Text>
              ))}
              <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-border">
                <Text className="text-text-muted text-xs">Deriva del incumbente</Text>
                <Badge label={data.drift?.verdict ?? '—'} color={DRIFT_COLOR[data.drift?.verdict] ?? '#64748b'} />
              </View>
              <Text className="text-text-muted text-[10px] mt-1">
                sombra: {data.shadow?.totalRuns ?? 0} corridas · muestreo {Math.round((data.shadow?.sampleRate ?? 0) * 100)}%
              </Text>
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Salud</Text>
              <HealthRow label="Aceptación" value={pct(data.health?.health?.acceptanceRate)} />
              <HealthRow label="Undo" value={pct(data.health?.health?.undoRate)} />
              <HealthRow label="Fallback manual" value={pct(data.health?.health?.manualFallbackRate)} />
              <HealthRow label="Fallos de proveedor" value={pct(data.health?.health?.providerFailureRate)} />
              <HealthRow label="Latencia media" value={num(data.health?.health?.meanLatencyMs, 'ms')} />
              <HealthRow label="ECE" value={String(data.health?.health?.calibration?.currentEce ?? 'n/d')} />
              <HealthRow label="Falsos positivos" value={String(data.health?.health?.falsePositives ?? 0)} warn={(data.health?.health?.falsePositives ?? 0) > 0} />
              <HealthRow label="Falsos negativos" value={String(data.health?.health?.falseNegatives ?? 0)} />
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Puertas</Text>
              {(data.health?.gates?.gates ?? []).map((g: any) => (
                <View key={g.id} className="py-2 border-b border-border">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-text-primary text-sm">{g.id}</Text>
                    <Badge label={g.status} color={GATE_COLOR[g.status] ?? '#64748b'} />
                  </View>
                  <Text className="text-text-muted text-[10px]">{g.reasons?.[0]}</Text>
                </View>
              ))}
            </Card>

            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-text-primary text-base font-semibold">Riesgo</Text>
                <Badge label={data.risk?.overall ?? '—'} color={LEVEL_COLOR[data.risk?.overall] ?? '#64748b'} />
              </View>
              {(data.risk?.dimensions ?? []).map((d: any) => (
                <View key={d.dimension} className="py-2 border-b border-border">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-text-primary text-sm">{d.dimension}</Text>
                    <Badge label={d.level} color={LEVEL_COLOR[d.level] ?? '#64748b'} />
                  </View>
                  <Text className="text-text-muted text-[10px]">{d.evidence?.[0]}</Text>
                </View>
              ))}
            </Card>

            <Card>
              <Text className="text-text-primary text-base font-semibold mb-2">Confianza por semana</Text>
              {(data.timeline?.global ?? []).map((p: any) => (
                <View key={p.weekStart} className="flex-row items-center py-1.5 border-b border-border">
                  <Text className="text-text-muted text-[10px] w-20">{p.weekStart}</Text>
                  <View className="flex-1 h-2 bg-border rounded-full overflow-hidden mr-2">
                    <View className="h-2 rounded-full" style={{ width: `${Math.round((p.avgTrustScore ?? 0) * 100)}%`, backgroundColor: '#6366f1' }} />
                  </View>
                  <Text className="text-text-muted text-[10px] w-24 text-right">
                    {p.decisions} dec · {p.undone > 0 ? `${p.undone} undo` : `${p.executed} exec`}
                  </Text>
                </View>
              ))}
              {(data.timeline?.global ?? []).length === 0 && (
                <Text className="text-text-muted text-sm">Sin historial en la ventana.</Text>
              )}
            </Card>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: color }}>
      <Text className="text-[10px] font-semibold" style={{ color }}>{label}</Text>
    </View>
  );
}

function HealthRow({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-text-muted text-xs">{label}</Text>
      <Text className="text-xs font-semibold" style={{ color: warn ? '#ef4444' : '#e2e8f0' }}>{value}</Text>
    </View>
  );
}

function pct(x: number | null | undefined): string {
  return x == null ? 'n/d' : `${Math.round(x * 100)}%`;
}
function num(x: number | null | undefined, unit: string): string {
  return x == null ? 'n/d' : `${Math.round(x)}${unit}`;
}
