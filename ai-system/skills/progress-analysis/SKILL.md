---
name: progress-analysis
description: Analyzes a user's real fitness progress data to diagnose whether their current plan is working, identify the likely cause of any deviation, and determine if an adjustment is needed. Use this skill whenever you need to evaluate progress — "analyze this user's progress", "is the plan working?", "why isn't the user losing weight?", "generate a progress diagnosis", "check if weight has stalled". The progress-analyst agent always uses this skill before the recommendation-engine acts.
---

# Skill: progress-analysis

This skill turns raw user data (weight logs, adherence records, calorie logs) into a clear diagnosis: is the plan working, and if not, why? The diagnosis must be evidence-based — rooted in the user's actual numbers, not assumptions. A good diagnosis explains what's happening, why it's probably happening, and what the likely fix is. The recommendation-engine then acts on this.

## Required Inputs

| Field | Source | Minimum required |
|---|---|---|
| `weight_log` | User memory | **7 recordings** with dates |
| `adherence_log` | User memory | Daily records (calories logged, plan followed) |
| `target_calories` | User memory | From last calorie-calculation |
| `goal` | User memory | `lose` \| `maintain` \| `gain` |
| `plan_start_date` | User memory | When current plan began |
| `menstrual_cycle_data` | User memory (optional) | If user tracks it |

If `weight_log` has fewer than 7 entries, do not produce a diagnosis. Return a data-insufficient response and explain when you'll have enough data.

## Step 1: Trend Calculation (Linear Regression)

Apply simple linear regression to the weight log to extract the underlying trend, filtering out daily noise (water retention, meal timing, etc.).

```
Given: [(date_1, weight_1), (date_2, weight_2), ..., (date_n, weight_n)]

Convert dates to day numbers: x_i = days since plan_start_date
Compute:
  slope = (n·Σ(x·y) − Σx·Σy) / (n·Σx² − (Σx)²)
  intercept = (Σy − slope·Σx) / n

weekly_rate_kg = slope × 7
projected_weight_4w = intercept + slope × (current_day + 28)
```

The slope gives the actual rate of change per day. Multiply by 7 for the weekly rate.

## Step 2: Diagnose Progress Status

Compare actual `weekly_rate_kg` against expected rate for the user's goal:

| Goal | Expected weekly rate | On track | Stalled | Regressing |
|---|---|---|---|---|
| `lose` | −0.3 to −0.7 kg/week | rate ≤ −0.3 | −0.1 to 0.1 | > +0.2 |
| `maintain` | ±0.2 kg/week | within ±0.2 | — | > ±0.5 |
| `gain` | +0.2 to +0.4 kg/week | rate ≥ +0.2 | +0.0 to +0.1 | — |

**Stagnation rule:** If weight hasn't moved more than ±0.3 kg over 2 consecutive weeks, classify as `stalled` regardless of trend.

**Status values:** `on_track` | `stalled` | `regressing` | `insufficient_data`

## Step 3: Identify Probable Cause

For each non-`on_track` status, investigate the most likely cause using adherence data:

### A. Adherence-related causes

```
avg_calories_logged = mean(adherence_log.calories_logged)
caloric_deviation_pct = (avg_calories_logged − target_calories) / target_calories × 100
days_plan_followed_pct = count(adherence_log.plan_followed == true) / total_days × 100
```

| Finding | Probable cause |
|---|---|
| `caloric_deviation_pct > 15%` | User consistently eating more than target |
| `days_plan_followed_pct < 50%` | Low adherence — plan may be too complex or not suitable |
| Calories logged but goal not met | Logging errors or unlogged meals |

### B. Physiological causes (check when adherence > 80%)

| Situation | Probable cause |
|---|---|
| Stalled despite good adherence | Metabolic adaptation — TDEE calculation may need recalibration |
| Rapid regain after restriction | Previous deficit was too aggressive |
| Menstrual cycle data shows recent cycle | Hormonal water retention — not a true stall |
| User recently started training | Muscle gain masking fat loss — use measurements, not just scale |

### C. Data quality issues

| Situation | Probable cause |
|---|---|
| Weight highly variable (std_dev > 1.5 kg) | Inconsistent weighing conditions (time of day, hydration) |
| Gaps > 3 days in weight log | Insufficient data density for reliable trend |

## Step 4: Adjustment Signal

Based on the diagnosis, determine if the `recommendation-engine` should act:

| Status | Time since last adjustment | Signal |
|---|---|---|
| `on_track` | Any | `no_adjustment_needed` |
| `stalled` | ≥ 14 days | `adjustment_recommended` |
| `regressing` | ≥ 7 days | `urgent_adjustment_recommended` |
| `stalled` | < 14 days | `monitor_more_data` |

Never recommend an adjustment if fewer than 14 days have passed since the last plan change — the body needs time to respond.

## Step 5: Menstrual Cycle Awareness

If the user logs menstrual cycle data:
- The 3–5 days before menstruation typically show +0.5 to +2 kg water retention
- Do not classify a stall during this window as a true stall
- Note this in the output and recommend re-evaluation after the cycle ends

## Output Format

```json
{
  "output_type": "progress_analysis",
  "analysis_date": "2026-05-03",
  "data_summary": {
    "weight_recordings": 14,
    "days_analyzed": 14,
    "adherence_days_logged": 12,
    "avg_calories_logged": 1680,
    "target_calories": 1700,
    "days_plan_followed_pct": 71
  },
  "trend": {
    "weekly_rate_kg": -0.38,
    "projected_weight_4w_kg": 66.2,
    "regression_r_squared": 0.82
  },
  "diagnosis": {
    "status": "on_track",
    "expected_weekly_rate_kg": -0.35,
    "deviation_from_expected_pct": -8.5,
    "probable_cause": null,
    "menstrual_cycle_flag": false
  },
  "adjustment_signal": "no_adjustment_needed",
  "explanation": "En las últimas 2 semanas perdiste 0.75 kg — un ritmo de 0.38 kg/semana, que está dentro del rango esperado para tu objetivo. Tu adherencia del 71% es suficiente para mantener el progreso. El plan no requiere ajustes por ahora.",
  "data_quality_flags": []
}
```

## Data Insufficient Response

```json
{
  "output_type": "progress_analysis",
  "analysis_date": "2026-05-03",
  "diagnosis": {
    "status": "insufficient_data",
    "recordings_available": 4,
    "recordings_required": 7,
    "available_from": "2026-04-30"
  },
  "explanation": "Necesitamos al menos 7 registros de peso para calcular tu tendencia real. Tienes 4 hasta ahora — en 3 días más podremos generar tu primer análisis."
}
```

## What NOT to Do

- Do not make medical diagnoses — report patterns and suggest consulting a professional
- Do not apply adjustments — this skill only produces a diagnosis; the `recommendation-engine` decides what changes to make
- Do not diagnose with fewer than 7 weight recordings
- Do not attribute stalls to a single cause — acknowledge uncertainty and present the most probable explanation with supporting data
- Do not alarm the user about normal fluctuation — distinguish between noise and signal
