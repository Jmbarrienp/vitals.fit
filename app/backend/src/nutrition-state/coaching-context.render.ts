import { CoachingContext, CtxWeek } from './types/coaching-context';

/**
 * Canonical text rendering of the CoachingContext (Phase 2C.0). This is the
 * model-agnostic "user prompt body" any chat LLM receives — Claude today, GPT/
 * Gemini/local tomorrow — so swapping models never rewrites data selection.
 *
 * PURE + DETERMINISTIC: a function of the contract ONLY. No clock, no relative
 * dates, and meta.generatedAt is deliberately not rendered — the same contract
 * always produces the same string. Codes are rendered verbatim (the model gets
 * the structured vocabulary, not prose interpretations).
 */
export function renderCoachingContext(ctx: CoachingContext): string {
  const lines: string[] = [];
  const { user, targets, today, currentState: s } = ctx;

  lines.push(`PERFIL: meta=${user.goal} | persona=${user.persona} | sexo=${user.sex}`);
  lines.push(
    `OBJETIVOS: ${targets.calories} kcal/dia | proteina ${targets.proteinG}g | carbos ${targets.carbsG}g | grasa ${targets.fatG}g | TDEE ${targets.tdee}`,
  );

  const calRem = targets.calories - today.caloriesLogged;
  const protRem = Math.round(targets.proteinG - today.proteinG);
  lines.push(
    `HOY: ${today.caloriesLogged}/${targets.calories} kcal (quedan ${calRem}) | proteina ${today.proteinG}/${targets.proteinG}g (quedan ${protRem}) | comidas: ${today.mealsLogged}`,
  );
  for (const m of today.recentMeals) lines.push(`  - ${m.mealType}: ${m.name} (${m.calories} kcal)`);

  lines.push(
    `ESTADO: adherencia=${fmt(s.adherenceScore)}/100 | nutricion=${fmt(s.nutritionScore)}/100 | tendencia=${s.trendStatus ?? 'sin_datos'} | plateau=${s.plateauStatus}`,
  );
  lines.push(
    `  rachas: registro ${s.streaks.loggingDays}d, proteina ${s.streaks.proteinDays}d, calorias ${s.streaks.calorieDays}d | dias registrados 7d: ${s.daysLogged7d}`,
  );
  lines.push(
    `  peso: ${fmt(s.weight.currentKg)} kg | tendencia ${fmt(s.weight.trendKgPerWeek)} kg/sem (${s.weight.dataPoints} puntos)`,
  );
  if (s.behaviorFlags.length > 0) lines.push(`  habitos detectados: ${s.behaviorFlags.join(', ')}`);

  if (ctx.history.weeks.length > 0) {
    lines.push('HISTORIA SEMANAL (reciente -> antigua):');
    for (const w of ctx.history.weeks) lines.push(`  ${renderWeek(w)}`);
  }

  const r = ctx.review;
  if (r) {
    lines.push(`REVIEW SEMANA ${r.weekStart}:`);
    if (r.improvedMetrics.length > 0) lines.push(`  mejoro: ${r.improvedMetrics.join(', ')}`);
    if (r.worsenedMetrics.length > 0) lines.push(`  empeoro: ${r.worsenedMetrics.join(', ')}`);
    if (r.biggestImprovement) lines.push(`  mayor mejora: ${r.biggestImprovement}`);
    if (r.biggestOpportunity) lines.push(`  mayor oportunidad: ${r.biggestOpportunity}`);
    for (const o of r.commitmentOutcomes) {
      lines.push(`  compromiso ${o.status === 'COMPLETED' ? 'CUMPLIDO' : 'VENCIDO'}: ${o.reason ?? 'general'}`);
    }
    for (const i of r.followUp.resolved) {
      lines.push(`  issue RESUELTO: ${i.issue} (${i.weeksActive} sem activas, intervencion=${i.intervention})`);
    }
    for (const i of r.followUp.persisting) {
      lines.push(`  issue PERSISTE: ${i.issue} (${i.weeksActive} sem, intervencion=${i.intervention})`);
    }
    for (const i of r.followUp.emerged) lines.push(`  issue NUEVO: ${i.issue}`);
    if (r.nextPriority) lines.push(`  proximo foco: ${r.nextPriority.reason} (${r.nextPriority.basis})`);
  }

  if (ctx.commitments.active.length > 0) {
    lines.push('COMPROMISOS ACTIVOS:');
    for (const c of ctx.commitments.active) {
      lines.push(`  - ${c.reason ?? 'general'}: "${c.message}" (vence ${c.expiresAt})`);
    }
  }

  return lines.join('\n');
}

function renderWeek(w: CtxWeek): string {
  const parts = [
    `${w.weekStart}: adh ${fmt(w.adherenceScore)} | nut ${fmt(w.nutritionScore)} | ${w.trendStatus ?? 'sin_datos'} | ${w.daysLogged}/7 dias`,
  ];
  if (w.plateauStatus === 'PLATEAU_SUSPECTED') parts.push('PLATEAU');
  if (w.primaryIssue) parts.push(`issue=${w.primaryIssue}`);
  if (w.primaryImprovement) parts.push(`mejora=${w.primaryImprovement}`);
  if (w.commitmentsCompleted + w.commitmentsExpired > 0) {
    parts.push(`compromisos ${w.commitmentsCompleted}ok/${w.commitmentsExpired}x`);
  }
  return parts.join(' | ');
}

function fmt(x: number | null): string {
  return x === null ? '-' : String(x);
}
