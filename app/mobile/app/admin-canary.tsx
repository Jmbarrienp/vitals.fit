import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { FEATURES } from '../src/config/features';
import { rolloutApi } from '../src/api/rollout';

/**
 * Admin canary screen (V4.4) — PURE RENDERING of the backend-derived canary
 * progression plan. Operator-only (same EXPO_PUBLIC_ADMIN_DASHBOARD flag),
 * reachable only by route. It computes nothing and could not advance a rollout
 * if it tried: the API it reads is GET-only and the plan is a recommendation.
 * The position selector below is a QUERY input (which position to evaluate) —
 * it moves nothing; it only asks the backend "what would you advise here?".
 */

const REC_COLOR: Record<string, string> = {
  ADVANCE: '#22c55e', STAY: '#38bdf8', HOLD: '#f59e0b', PAUSE: '#f97316', ROLLBACK: '#ef4444', COMPLETE: '#22c55e',
};
const POSITION_COLOR: Record<string, string> = { PAST: '#64748b', CURRENT: '#6366f1', FUTURE: '#334155' };
const STATUS_COLOR: Record<string, string> = { PASS: '#22c55e', FAIL: '#ef4444', PENDING: '#f59e0b', NOT_APPLICABLE: '#64748b' };
const RISK_COLOR: Record<string, string> = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' };
const POSITIONS = [0, 5, 10, 25, 50, 100];

export default function AdminCanaryScreen() {
  const router = useRouter();
  const [atPercent, setAtPercent] = useState(0);
  const [plan, setPlan] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!FEATURES.adminDashboard) return;
    setState('loading');
    (async () => {
      try {
        const res = await rolloutApi.canaryPlan(atPercent);
        setPlan(res.data);
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, [atPercent]);

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
          <Text className="text-text-primary text-2xl font-bold">Canary Rollout</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        <Card className="mb-3">
          <Text className="text-text-muted text-xs mb-2">Posición actual del rollout (solo consulta — no mueve nada)</Text>
          <View className="flex-row flex-wrap gap-2">
            {POSITIONS.map((p) => (
              <TouchableOpacity key={p} onPress={() => setAtPercent(p)}
                className="px-3 py-1 rounded-full" style={{ backgroundColor: atPercent === p ? '#6366f122' : 'transparent', borderWidth: 1, borderColor: atPercent === p ? '#6366f1' : '#334155' }}>
                <Text className="text-xs font-semibold" style={{ color: atPercent === p ? '#6366f1' : '#94a3b8' }}>{p === 0 ? 'pre' : `${p}%`}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {state === 'loading' && <Card className="items-center py-10"><ActivityIndicator size="large" color="#6366f1" /></Card>}
        {state === 'error' && <Card><Text className="text-text-muted text-sm">No se pudo cargar el plan de canario.</Text></Card>}

        {state === 'ready' && plan && (
          <>
            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-text-primary text-base font-semibold">Recomendación</Text>
                <Badge label={plan.recommendation} color={REC_COLOR[plan.recommendation] ?? '#64748b'} />
              </View>
              <Text className="text-text-muted text-[11px] mb-2">{plan.recommendationReason}</Text>
              <View className="flex-row items-center justify-between pt-2 border-t border-border">
                <Text className="text-text-muted text-xs">Exposición</Text>
                <Text className="text-text-primary text-xs font-semibold">
                  {plan.estimatedExposure?.currentPercent}% {plan.estimatedExposure?.nextPercent != null ? `→ ${plan.estimatedExposure.nextPercent}%` : '(máx)'}
                </Text>
              </View>
              <View className="flex-row items-center justify-between mt-1">
                <Text className="text-text-muted text-xs">Riesgo</Text>
                <Badge label={plan.estimatedRisk?.overall ?? '—'} color={RISK_COLOR[plan.estimatedRisk?.overall] ?? '#64748b'} />
              </View>
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Señales</Text>
              <SignalRow label="Avanzar" sig={plan.advanceRecommendation} />
              <SignalRow label="Mantener" sig={plan.holdRecommendation} />
              <SignalRow label="Rollback" sig={plan.rollbackRecommendation} />
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Timeline</Text>
              {(plan.timeline ?? []).map((s: any) => (
                <View key={s.percent} className="flex-row items-center py-1.5 border-b border-border">
                  <Badge label={`${s.percent}%`} color={POSITION_COLOR[s.position] ?? '#334155'} />
                  <View className="flex-1 ml-2">
                    <Text className="text-text-muted text-[10px]">{s.position} · {s.suggestedDurationHours}h</Text>
                    {s.position === 'CURRENT' && (s.observedIndicators ?? []).map((ind: string, i: number) => (
                      <Text key={i} className="text-text-muted text-[9px]">· {ind}</Text>
                    ))}
                  </View>
                </View>
              ))}
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-1">Condiciones para avanzar</Text>
              {(plan.requiredConditions ?? []).map((c: string, i: number) => (
                <Text key={i} className="text-text-muted text-[10px] mb-0.5">✓ {c}</Text>
              ))}
              {(plan.blockingConditions ?? []).length > 0 && (
                <>
                  <Text className="text-text-primary text-xs font-semibold mt-2 mb-1">Bloqueadores</Text>
                  {(plan.blockingConditions ?? []).map((c: string, i: number) => (
                    <Text key={`b${i}`} className="text-[10px] mb-0.5" style={{ color: '#f59e0b' }}>⚠ {c}</Text>
                  ))}
                </>
              )}
            </Card>

            <ChecklistCard title="Monitoreo" items={plan.monitoringChecklist} />
            <ChecklistCard title="Verificación" items={plan.verificationChecklist} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function SignalRow({ label, sig }: { label: string; sig: any }) {
  const on = sig?.value === true;
  return (
    <View className="py-1.5 border-b border-border">
      <View className="flex-row items-center justify-between">
        <Text className="text-text-primary text-xs">{label}</Text>
        <Text className="text-[10px] font-semibold" style={{ color: on ? '#22c55e' : '#64748b' }}>{on ? 'SÍ' : 'no'}</Text>
      </View>
      <Text className="text-text-muted text-[10px]">{sig?.explanation}</Text>
    </View>
  );
}

function ChecklistCard({ title, items }: { title: string; items: any[] }) {
  return (
    <Card className="mb-3">
      <Text className="text-text-primary text-base font-semibold mb-2">Checklist · {title}</Text>
      {(items ?? []).map((it: any, i: number) => (
        <View key={i} className="py-1.5 border-b border-border">
          <View className="flex-row items-center justify-between">
            <Text className="text-text-primary text-xs flex-1 pr-2">{it.label}</Text>
            <Badge label={it.status} color={STATUS_COLOR[it.status] ?? '#64748b'} />
          </View>
          <View className="flex-row items-center mt-0.5">
            <Text className="text-text-muted text-[9px] mr-2">{it.category}</Text>
            <Text className="text-text-muted text-[9px]">{it.owner}</Text>
          </View>
          <Text className="text-text-muted text-[10px] mt-0.5">{it.explanation}</Text>
        </View>
      ))}
    </Card>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: color }}>
      <Text className="text-[10px] font-semibold" style={{ color }}>{label}</Text>
    </View>
  );
}
