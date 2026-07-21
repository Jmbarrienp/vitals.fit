import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { FEATURES } from '../src/config/features';
import { rolloutApi } from '../src/api/rollout';

/**
 * Admin promotion-plan screen (V4.2) — PURE RENDERING of the backend-derived
 * plan. Operator-only (same EXPO_PUBLIC_ADMIN_DASHBOARD flag), reachable only
 * by route. It computes nothing, decides nothing, and could not execute a
 * promotion if it tried: the API it reads is GET-only and the plan is a
 * document. Every badge, step and checklist item was derived server-side from
 * the governance and rollout owners' verdicts.
 */

const READINESS_COLOR: Record<string, string> = { READY: '#22c55e', BLOCKED: '#ef4444', NOT_APPLICABLE: '#64748b' };
const STATUS_COLOR: Record<string, string> = { PASS: '#22c55e', FAIL: '#ef4444', PENDING: '#f59e0b', NOT_APPLICABLE: '#64748b' };
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f59e0b', MEDIUM: '#38bdf8', LOW: '#64748b' };
const RISK_COLOR: Record<string, string> = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' };

export default function AdminPromotionScreen() {
  const router = useRouter();
  const [plan, setPlan] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!FEATURES.adminDashboard) return;
    (async () => {
      try {
        const res = await rolloutApi.promotionPlan();
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
          <Text className="text-text-primary text-2xl font-bold">Plan de Promoción</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        {state === 'loading' && <Card className="items-center py-10"><ActivityIndicator size="large" color="#6366f1" /></Card>}
        {state === 'error' && <Card><Text className="text-text-muted text-sm">No se pudo cargar el plan de promoción.</Text></Card>}

        {state === 'ready' && plan && (
          <>
            <Card className="mb-3">
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-text-primary text-base font-semibold">{plan.currentProvider} → {plan.candidateProvider ?? 'sin candidato'}</Text>
                <Badge label={plan.readiness} color={READINESS_COLOR[plan.readiness] ?? '#64748b'} />
              </View>
              <Text className="text-text-muted text-[11px] mb-1">Decisión: {plan.decision} · Confianza: {plan.confidence}</Text>
              {(plan.blockingReasons ?? []).map((r: string, i: number) => (
                <Text key={i} className="text-[10px] mb-0.5" style={{ color: '#ef4444' }}>⛔ {r}</Text>
              ))}
              <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-border">
                <Text className="text-text-muted text-xs">Riesgo estimado</Text>
                <Badge label={plan.estimatedRisk?.overall ?? '—'} color={RISK_COLOR[plan.estimatedRisk?.overall] ?? '#64748b'} />
              </View>
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Evidencia estadística</Text>
              <Row label="Scans pareados" value={String(plan.statisticalEvidence?.pairedScans ?? 0)} />
              <Row label="Δ top-1" value={ppDelta(plan.statisticalEvidence?.top1Delta)} />
              <Row label="McNemar z" value={String(plan.statisticalEvidence?.mcNemarZ ?? 'n/d')} />
              <Row label="Generaliza (modalidad)" value={boolTxt(plan.statisticalEvidence?.generalizesAcrossModalities)} />
              <Row label="Generaliza (usuarios)" value={boolTxt(plan.statisticalEvidence?.generalizesAcrossUsers)} />
              <Row label="Deriva del incumbente" value={plan.statisticalEvidence?.incumbentDrift ?? '—'} />
            </Card>

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Escalera de rollout ({plan.rolloutPercent}% inicio)</Text>
              {(plan.rolloutStrategy ?? []).map((s: any) => (
                <View key={s.percent} className="py-1.5 border-b border-border">
                  <Text className="text-text-primary text-sm">{s.percent}% · {s.suggestedDurationHours}h</Text>
                  <Text className="text-text-muted text-[10px]">avanzar si: {s.advanceConditions?.[0]}</Text>
                </View>
              ))}
              <Text className="text-text-muted text-[10px] mt-2">Duración total estimada: {plan.estimatedDurationHours}h</Text>
            </Card>

            <ChecklistCard title="Validación" items={plan.validationChecklist} />
            <ChecklistCard title="Monitoreo" items={plan.monitoringChecklist} />
            <ChecklistCard title="Aprobación" items={plan.approvalChecklist} />

            <Card className="mb-3">
              <Text className="text-text-primary text-base font-semibold mb-2">Pasos de ejecución</Text>
              {(plan.executionSteps ?? []).map((s: any) => (
                <View key={s.order} className="flex-row py-1.5 border-b border-border">
                  <Text className="text-text-muted text-[10px] w-5">{s.order}.</Text>
                  <View className="flex-1">
                    <Text className="text-text-primary text-xs">{s.action} <Text className="text-text-muted">· {s.owner}</Text></Text>
                    <Text className="text-text-muted text-[10px]">{s.detail}</Text>
                  </View>
                </View>
              ))}
            </Card>

            <Card>
              <Text className="text-text-primary text-base font-semibold mb-2">Reversión</Text>
              {(plan.rollbackCriteria ?? []).map((c: string, i: number) => (
                <Text key={i} className="text-text-muted text-[10px] mb-0.5">• {c}</Text>
              ))}
              <View className="mt-2 pt-2 border-t border-border">
                {(plan.rollbackSteps ?? []).map((s: any) => (
                  <Text key={s.order} className="text-text-muted text-[10px] mb-0.5">{s.order}. {s.action} — {s.owner}</Text>
                ))}
              </View>
            </Card>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-text-muted text-xs">{label}</Text>
      <Text className="text-text-primary text-xs font-semibold">{value}</Text>
    </View>
  );
}

function ppDelta(x: number | null | undefined): string {
  return x == null ? 'n/d' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
}
function boolTxt(x: boolean | null | undefined): string {
  return x == null ? 'n/d' : x ? 'sí' : 'no';
}
