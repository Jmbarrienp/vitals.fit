import { View, Text } from 'react-native';
import { Card } from './Card';
import type { IntelligenceSnapshot } from '../types';
import { PLATEAU_COPY, reasonLabel, scoreBand, trendCopy } from '../lib/intelligence';

function ScoreMeter({ label, score }: { label: string; score: number | null }) {
  const band = scoreBand(score);
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <View className="flex-1">
      <View className="flex-row items-baseline justify-between mb-1">
        <Text className="text-text-muted text-xs">{label}</Text>
        <Text className="font-bold text-sm" style={{ color: band.color }}>
          {score === null ? '—' : score}
          <Text className="text-text-muted text-xs font-normal">{score === null ? '' : '/100'}</Text>
        </Text>
      </View>
      <View className="h-2 rounded-full bg-background overflow-hidden">
        <View style={{ width: `${pct}%`, backgroundColor: band.color }} className="h-full rounded-full" />
      </View>
    </View>
  );
}

function Chip({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <View
      className="flex-row items-center gap-1 px-2.5 py-1 rounded-lg"
      style={{ backgroundColor: `${color}1a`, borderWidth: 1, borderColor: `${color}40` }}
    >
      <Text className="text-xs">{icon}</Text>
      <Text className="text-xs font-semibold" style={{ color }}>{label}</Text>
    </View>
  );
}

/**
 * Compact dashboard card summarizing the user's longitudinal nutrition state.
 * 100% backend-derived — renders the snapshot, computes nothing.
 */
export function IntelligenceCard({ snapshot }: { snapshot: IntelligenceSnapshot }) {
  const trend = trendCopy(snapshot.trendStatus);
  const plateau = PLATEAU_COPY[snapshot.plateauStatus];
  const top = snapshot.topRecommendation;
  const topReason = reasonLabel(top?.reason);

  return (
    <Card className="mb-4">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
          Tu inteligencia nutricional
        </Text>
        <Text className="text-base">🧠</Text>
      </View>

      {/* Scores */}
      <View className="flex-row gap-4 mb-4">
        <ScoreMeter label="Adherencia" score={snapshot.scores.adherence} />
        <ScoreMeter label="Nutrición" score={snapshot.scores.nutrition} />
      </View>

      {/* Status chips */}
      <View className="flex-row flex-wrap gap-2">
        <Chip icon={trend.icon} label={trend.label} color={trend.color} />
        {plateau && <Chip icon={plateau.icon} label={plateau.label} color={plateau.color} />}
      </View>

      {/* Highest-impact issue / next action (from the rec engine, single source) */}
      {top && (
        <View className="mt-4 pt-4 border-t border-border">
          {topReason && (
            <Text className="text-text-muted text-xs uppercase tracking-wider mb-1">
              Lo más importante · {topReason}
            </Text>
          )}
          <Text className="text-text-primary text-sm leading-5">{top.message}</Text>
        </View>
      )}
    </Card>
  );
}
