---
name: adaptive-planning
description: Proposes conservative, evidence-based adjustments to a user's nutritional plan based on progress analysis. Use this skill whenever you need to recalibrate a plan — "adjust the plan based on progress", "recalibrate after 2 weeks", "the user is stalled, what should change?", "update the caloric target". Always runs after progress-analysis produces a diagnosis and before recommendation-engine sends changes to the user.
---

# Skill: adaptive-planning

This skill proposes specific, conservative changes to a user's nutritional plan when progress data shows a need. The guiding principle is *incremental adjustment* — the body needs time to respond to changes, and aggressive course-corrections create unpredictable outcomes and erode user trust. Small, justified changes that the user understands are more effective than large ones they don't believe in.

## Required Inputs

| Field | Source | Notes |
|---|---|---|
| `progress_analysis` | `progress-analysis` output | Must have `adjustment_signal: "adjustment_recommended"` or `"urgent_adjustment_recommended"` |
| `current_plan` | User memory | Version, calories, macros, start date |
| `plan_history` | User memory | All previous plan versions with their outcomes |
| `days_since_last_adjustment` | Calculated from memory | Must be ≥ 14 before adjusting |
| `user_goal` | User memory | `lose` \| `maintain` \| `gain` |
| `weight_kg` | User memory (current) | For recalculating protein targets |

## Gate: When to Adjust

Only proceed if ALL conditions are met:

1. `progress_analysis.adjustment_signal` is `adjustment_recommended` or `urgent_adjustment_recommended`
2. At least **14 days** have elapsed since the last plan adjustment
3. At least **7 days of adherence data** exist since the last adjustment

If any condition is not met, return a `no_adjustment` response explaining the reason and when adjustment will be eligible.

## Adjustment Logic by Scenario

### Scenario A: Weight loss stalled (goal = lose, status = stalled)

**Cause investigation first:**

| If adherence_pct | Recommended action |
|---|---|
| < 60% | Do not change calories — improve adherence first. Simplify the meal plan. |
| 60–80% | Mild caloric reduction (−100 to −150 kcal) |
| > 80% | Caloric reduction (−150 to −200 kcal) |

Never recommend a caloric reduction as the first response when adherence is the real problem.

### Scenario B: Weight loss too fast (> 0.8 kg/week sustained)

Increase calories (+100 to +200 kcal) to protect muscle mass and prevent metabolic adaptation.

### Scenario C: Muscle gain stalled (goal = gain, status = stalled)

Increase calories (+100 to +200 kcal). Verify protein is adequate (≥ 1.8 g/kg) before adding carbs.

### Scenario D: Weight regaining unexpectedly (goal = lose, status = regressing)

Investigate adherence before adjusting. If adherence is > 80%, reduce calories by −150 to −200 kcal. Flag for `progress-analyst` follow-up in 1 week.

### Scenario E: Goal change requested by user

Recalculate from scratch using `calorie-calculation` and `macro-distribution` with the new goal. This is not an incremental adjustment — it's a full recalculation. The old plan is archived in `plan_history`.

## Hard Limits Per Adjustment Cycle

These limits exist because large changes cause the system to lose calibration. If more change is needed, it happens over multiple 2-week cycles.

| Parameter | Maximum change per cycle |
|---|---|
| Calories | ±200 kcal |
| Protein | ±15 g |
| Meal count | ±1 |

Changes larger than these limits **require explicit user approval** with a clear explanation before applying.

## Absolute Minimum Enforcement

Even after adjustment, the plan must not go below:
- 1,200 kcal/day for women
- 1,500 kcal/day for men

If the recommended adjustment would breach these limits, set the target to the minimum and explain the constraint to the user.

## Generating the Proposed Adjustment

Produce a concrete diff — not vague suggestions. The user and the `recommendation-engine` need to know exactly what changes:

```
Old target: 1,750 kcal | 140g protein | 175g carbs | 50g fat
Proposed:   1,600 kcal | 140g protein | 140g carbs | 47g fat
Change:        −150 kcal                    −35g carbs   −3g fat
```

When reducing calories, reduce carbs first, then fat. Protein stays the same or increases.

## User Approval Requirement

Changes greater than 15% of any macro require explicit user confirmation before the plan is updated. Present the change and ask the user to approve:

```
"Proponemos reducir tus carbohidratos de 175g a 120g (−31%). Este es un cambio mayor al 15%.
¿Confirmas que quieres aplicar este ajuste?"
```

Changes under 15% can be applied and communicated after the fact, but must always be explained.

## Output Format

```json
{
  "output_type": "adaptive_plan_adjustment",
  "adjustment_date": "2026-05-03",
  "trigger": {
    "progress_status": "stalled",
    "days_since_last_adjustment": 14,
    "adherence_pct": 78
  },
  "current_plan": {
    "version": 2,
    "calories": 1750,
    "protein_g": 140,
    "carbs_g": 175,
    "fat_g": 50
  },
  "proposed_plan": {
    "version": 3,
    "calories": 1600,
    "protein_g": 140,
    "carbs_g": 140,
    "fat_g": 47,
    "changes": {
      "calories": -150,
      "protein_g": 0,
      "carbs_g": -35,
      "fat_g": -3
    }
  },
  "requires_user_approval": false,
  "reasoning": "Tu peso se mantuvo estable las últimas 2 semanas con buena adherencia. Reducimos 150 kcal (principalmente carbohidratos) para retomar el progreso. Tu proteína no cambia para proteger tu masa muscular.",
  "next_review_date": "2026-05-17",
  "warnings": []
}
```

## No Adjustment Response

When adjustment conditions are not met:

```json
{
  "output_type": "adaptive_plan_adjustment",
  "adjustment_date": "2026-05-03",
  "adjustment_applied": false,
  "reason": "insufficient_time_since_last_adjustment",
  "days_since_last_adjustment": 9,
  "eligible_after": "2026-05-07",
  "explanation": "El último ajuste fue hace 9 días. Necesitamos al menos 14 días de datos para evaluar si los cambios están funcionando. La próxima revisión puede hacerse el 7 de mayo."
}
```

## Memory Update

After an adjustment is applied, record in memory:

```json
{
  "version": 3,
  "active_from": "2026-05-04",
  "active_to": null,
  "reason_for_change": "Weight stalled for 2 weeks with 78% adherence — reduced calories by 150 kcal",
  "agent": "adaptive-planning",
  "previous_version": 2
}
```

## What NOT to Do

- Do not adjust the plan without a diagnosis from `progress-analysis`
- Do not apply changes larger than the hard limits without user approval
- Do not generate a new meal plan — trigger `meal-generation` after the adjustment is confirmed
- Do not adjust within 14 days of the previous adjustment
- Do not change protein targets downward unless the user is over-consuming (≥ 120% of target consistently)
