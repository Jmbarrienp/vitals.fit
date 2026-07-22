import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { FEATURES } from '../src/config/features';
import { rolloutApi } from '../src/api/rollout';

/**
 * Admin safe-rollback screen (V4.3) — PURE RENDERING of the backend-derived
 * rollback plan. Operator-only (same EXPO_PUBLIC_ADMIN_DASHBOARD flag),
 * reachable only by route. It computes nothing, decides nothing, and could not
 * roll anything back if it tried: the API it reads is GET-only and the plan is
 * a document. Every badge, step and checklist item was derived server-side from
 * the ROLLBACK_REQUIRED gate, governance drift and the health/risk owners.
 */

const READINESS_COLOR: Record<string, string> = { REQUIRED: '#ef4444', BLOCKED: '#f59e0b', NOT_REQUIRED: '#22c55e' };
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#38bdf8', NONE: '#22c55e' };
const PRIORITY_COLOR: Record<string, string> = { IMMEDIATE: '#ef4444', SCHEDULED: '#f59e0b', MONITOR: '#38bdf8', NONE: '#64748b' };
const STATUS_COLOR: Record<string, string> = { PASS: '#22c55e', FAIL: '#ef4444', PENDING: '#f59e0b', NOT_APPLICABLE: '#64748b' };
const RISK_COLOR: Record<string, string> = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' };

export default function AdminRollbackScreen() {
  const router = useRouter();
  const [plan, setPlan] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!FEATURES.adminDashboard) return;
    (async () => {
      try {
        const res = await rolloutApi.rollbackPlan();
        setPlan(res.data);
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
          <Text className="text-text-primary text-2xl font-bold">Rollback Seguro</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        {state === 'loading' && <Card className="items-center py-10"><ActivityIndicator size="large" color="#6366f1" /></Card>}
        {state === 'error' && <Card><Text className="text-text-muted text-sm">No se pudo cargar el plan de rollback.</Text></Card>}

        {state === 'ready' && plan && (
          <>
            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-text-primary text-base font-semibold">Estado</Text>
                <Badge label={plan.readiness} color={READINESS_COLOR[plan.readiness] ?? '#64748b'} />
              </View>
              <Text className="text-text-muted text-[11px] mb-2">{plan.rollbackReason}</Text>
              <View className="flex-row gap-2 mb-1">
                <Badge label={`Sev: ${plan.rollbackSeverity}`} color={SEVERITY_COLOR[plan.rollbackSeverity] ?? '#64748b'} />
                <Badge label={`Prio: ${plan.rollbackPriority}`} color={PRIORITY_COLOR[plan.rollbackPriority] ?? '#64748b'} />
                <Badge label={`Conf: ${plan.rollbackConfidence}`} color="#818cf8" />
              </View>
              {(plan.blockingReasons ?? []).map((r: string, i: number) => (
                <Text key={i} className="text-[10px] mb-0.5" style={{ color: '#f59e0b' }}>⚠ {r}</Text>
              ))}
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-1">Objetivo</Text>
              <Text className="text-text-muted text-[11px]">
                {plan.currentProvider} → {plan.rollbackTarget?.kind}{plan.rollbackTarget?.provider ? ` (${plan.rollbackTarget.provider})` : ''}
              </Text>
              <Text className="text-text-muted text-[10px] mt-1">{plan.rollbackTarget?.detail}</Text>
            </Card>

            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-text-primary text-base font-semibold">Evidencia y riesgo</Text>
                <Badge label={plan.riskSummary?.overall ?? '—'} color={RISK_COLOR[plan.riskSummary?.overall] ?? '#64748b'} />
              </View>
              {(plan.triggeringEvidence ?? []).slice(0, 4).map((e: string, i: number) => (
                <Text key={i} className="text-text-muted text-[10px] mb-0.5">• {e}</Text>
              ))}
              {(plan.degradedHealth ?? []).map((d: string, i: number) => (
                <Text key={`h${i}`} className="text-[10px] mb-0.5" style={{ color: '#ef4444' }}>↓ {d}</Text>
              ))}
            </Card>

            {plan.rollbackTarget?.kind !== 'NONE' && (
              <>
                <Card className="mb-3">
                  <Text className="text-text-primary text-base font-semibold mb-2">Pasos de rollback</Text>
                  {(plan.rollbackSteps ?? []).map((s: any) => (
                    <View key={s.order} className="flex-row py-1.5 border-b border-border">
                      <Text className="text-text-muted text-[10px] w-5">{s.order}.</Text>
                      <View className="flex-1">
                        <Text className="text-text-primary text-xs">{s.action} <Text className="text-text-muted">· {s.owner}</Text></Text>
                        <Text className="text-text-muted text-[10px]">{s.detail}</Text>
                      </View>
                    </View>
                  ))}
                </Card>

                <ChecklistCard title="Verificación" items={plan.verificationChecklist} />
                <ChecklistCard title="Post-rollback" items={plan.postRollbackChecklist} />

                <Card className="mb-3">
                  <Text className="text-text-primary text-base font-semibold mb-2">Monitoreo de recuperación</Text>
                  {(plan.monitoringPlan ?? []).map((m: string, i: number) => (
                    <Text key={i} className="text-text-muted text-[10px] mb-0.5">• {m}</Text>
                  ))}
                  <Text className="text-text-primary text-xs font-semibold mt-2 mb-1">Condiciones para reintentar promoción</Text>
                  {(plan.retryConditions ?? []).map((r: string, i: number) => (
                    <Text key={`r${i}`} className="text-text-muted text-[10px] mb-0.5">• {r}</Text>
                  ))}
                </Card>

                <Card>
                  <Text className="text-text-primary text-base font-semibold mb-2">Impacto estimado</Text>
                  {(plan.estimatedImpact ?? []).map((im: string, i: number) => (
                    <Text key={i} className="text-text-muted text-[10px] mb-0.5">• {im}</Text>
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </View>
    </ScrollView>
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
            <Text className="text-[9px] font-semibold mr-2" style={{ color: SEVERITY_COLOR[it.severity] ?? '#64748b' }}>{it.severity}</Text>
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
