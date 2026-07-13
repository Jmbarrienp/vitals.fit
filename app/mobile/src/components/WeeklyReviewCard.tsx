import { View, Text } from 'react-native';
import { Card } from './Card';
import type { ReviewSnapshot } from '../types';
import { basisCopy, improvementLabel, metricLabel, reasonLabel, scoreBand } from '../lib/intelligence';

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View
      className="px-2.5 py-1 rounded-lg"
      style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}
    >
      <Text className="text-xs font-semibold" style={{ color }}>{label}</Text>
    </View>
  );
}

function Score({ label, value }: { label: string; value: number | null }) {
  const band = scoreBand(value);
  return (
    <View className="flex-1">
      <Text className="text-text-muted text-xs mb-0.5">{label}</Text>
      <Text className="font-bold text-lg" style={{ color: band.color }}>
        {value === null ? '—' : value}
        {value !== null && <Text className="text-text-muted text-xs font-normal">/100</Text>}
      </Text>
    </View>
  );
}

function weekLabel(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00.000Z`);
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Weekly Review — the closed-loop coaching surface. 100% backend-derived: it
 * renders the review projection (what improved, commitment outcomes, follow-up,
 * next priority) and computes nothing. Gated when there is no completed week yet.
 */
export function WeeklyReviewCard({ snapshot }: { snapshot: ReviewSnapshot }) {
  const review = snapshot.current;
  if (!snapshot.hasReview || !review) return null;

  const { followUp } = snapshot;
  const next = review.nextPriority;
  const nextBasis = next ? basisCopy(next.basis) : null;
  const nextReason = reasonLabel(next?.reason);
  const improvement = improvementLabel(review.biggestImprovement);
  const resolved = followUp.resolved[0];

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
          Tu semana pasada · {weekLabel(review.weekStart)}
        </Text>
        <Text className="text-base">🗓️</Text>
      </View>

      {/* Scores */}
      <View className="flex-row gap-4 mb-3">
        <Score label="Adherencia" value={review.adherenceScore} />
        <Score label="Nutrición" value={review.nutritionScore} />
        <View className="flex-1">
          <Text className="text-text-muted text-xs mb-0.5">Registro</Text>
          <Text className="font-bold text-lg text-text-primary">
            {review.daysLogged}<Text className="text-text-muted text-xs font-normal">/7 días</Text>
          </Text>
        </View>
      </View>

      {/* What moved */}
      {(review.improved.length > 0 || review.worsened.length > 0) && (
        <View className="flex-row flex-wrap gap-2 mb-3">
          {review.improved.map((m) => (
            <Pill key={`up-${m.metric}`} label={`▲ ${metricLabel(m.metric)}`} color="#22c55e" />
          ))}
          {review.worsened.map((m) => (
            <Pill key={`down-${m.metric}`} label={`▼ ${metricLabel(m.metric)}`} color="#ef4444" />
          ))}
        </View>
      )}

      {/* Improvement acknowledgement */}
      {improvement && (
        <Text className="text-success text-sm mb-2">🎉 {improvement}</Text>
      )}

      {/* Commitments */}
      <View className="flex-row items-center gap-3 py-2 border-t border-border">
        <Text className="text-text-muted text-xs">Compromisos</Text>
        <Text className="text-success text-sm font-semibold">{review.commitments.completed} cumplidos</Text>
        {review.commitments.expired > 0 && (
          <Text className="text-text-muted text-sm">{review.commitments.expired} vencidos</Text>
        )}
      </View>

      {/* Follow-up: resolved issue acknowledgement */}
      {resolved && (
        <Text className="text-text-secondary text-sm mt-1">
          ✅ Resolviste: {reasonLabel(resolved.issue) ?? resolved.issue}
          {resolved.intervention === 'INTERVENED' ? ' (cumpliste tu compromiso)' : ''}
        </Text>
      )}

      {/* Next priority */}
      {next && nextBasis && (
        <View className="mt-3 pt-3 border-t border-border">
          <Text className="text-text-muted text-xs uppercase tracking-wider mb-1">Enfócate ahora</Text>
          <Text className="text-sm font-semibold" style={{ color: nextBasis.color }}>
            {nextBasis.label}
          </Text>
          {nextReason && <Text className="text-text-primary text-sm mt-0.5">{nextReason}</Text>}
        </View>
      )}
    </Card>
  );
}
