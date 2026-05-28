---
name: calorie-calculation
description: Calculates BMR, TDEE, and adjusted caloric targets for fitness app users. Use this skill whenever you need to calculate calories for a user profile — whether setting up a new plan, validating existing targets, or responding to questions like "how many calories should this user eat?", "calculate TDEE for this profile", or "what's the caloric target for weight loss?". Always invoke this skill when the nutritionist-agent needs to produce caloric outputs.
---

# Skill: calorie-calculation

This skill produces the foundational caloric targets that all other nutrition decisions depend on. Accurate calculation here determines everything downstream — wrong calories here means wrong meal plans, wrong progress expectations, and a user who won't reach their goal.

## Required Inputs

Before calculating, confirm you have all of these from the user's memory profile:

| Field | Type | Notes |
|---|---|---|
| `weight_kg` | number | Current weight, not goal weight |
| `height_cm` | number | — |
| `age` | number | Years |
| `sex` | `male` \| `female` | Biological sex for formula accuracy |
| `activity_level` | `sedentary` \| `light` \| `moderate` \| `active` \| `extra` | Habitual level, NOT including today's workout |
| `goal` | `lose` \| `maintain` \| `gain` | User's declared objective |

If any field is missing, stop and request the missing data. Never assume default values.

## Step 1: Calculate BMR

### Default formula: Mifflin-St Jeor (1990)

Use this for all users unless they explicitly qualify for Harris-Benedict (see below).

```
Male:   BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) + 5
Female: BMR = (10 × weight_kg) + (6.25 × height_cm) − (5 × age) − 161
```

### Alternative: Harris-Benedict Revised (Roza & Shizgal, 1984)

Use ONLY when the user declares they are an athlete with 3+ years of consistent training (significantly higher muscle mass shifts the formula).

```
Male:   BMR = 88.362 + (13.397 × weight_kg) + (4.799 × height_cm) − (5.677 × age)
Female: BMR = 447.593 + (9.247 × weight_kg) + (3.098 × height_cm) − (4.330 × age)
```

Record which formula was used and why in the output — this affects future recalculations.

## Step 2: Apply Activity Multiplier (TDEE)

```
TDEE = BMR × activity_factor
```

| activity_level | Description | Factor |
|---|---|---|
| `sedentary` | No exercise, desk job | × 1.2 |
| `light` | Light exercise 1–3 days/week | × 1.375 |
| `moderate` | Moderate exercise 3–5 days/week | × 1.55 |
| `active` | Intense exercise 6–7 days/week | × 1.725 |
| `extra` | Physical job + daily exercise | × 1.9 |

**Important:** The activity factor only reflects habitual activity. Logged workouts are added on top of TDEE for that specific day — they are NOT baked into this calculation.

## Step 3: Apply Goal Adjustment

```
target_calories = TDEE + goal_adjustment
```

| Goal | Adjustment | Expected Rate |
|---|---|---|
| `lose` (moderate) | −300 to −400 kcal | ~0.3–0.4 kg/week |
| `lose` (aggressive, IMC > 30 only) | −500 kcal | ~0.5 kg/week |
| `lose` (last 3–5 kg) | −200 kcal | ~0.2 kg/week |
| `maintain` | 0 kcal | Stable weight |
| `gain` (lean) | +200 to +300 kcal | ~0.2–0.3 kg/week |
| `gain` (standard) | +300 to +500 kcal | ~0.3–0.5 kg/week |

For weight loss, default to moderate (−350 kcal) unless there is specific justification to use aggressive or gentle.

## Step 4: Enforce Absolute Minimums

These limits are non-negotiable regardless of user goal or calculation result:

| Group | Minimum |
|---|---|
| Adult women | 1,200 kcal |
| Adult men | 1,500 kcal |
| Pregnant/breastfeeding | Do not generate — defer to clinical professional |
| Under 18 years old | Do not generate — defer to pediatric professional |

If `target_calories < minimum`:
- Set `target_calories = minimum`
- Set `minimum_applied = true`
- Explain to the user that the deficit was capped for safety

## Step 5: IMC Safety Check

```
BMI = weight_kg / (height_m)²
```

| BMI | Action |
|---|---|
| < 18.5 | Alert: underweight. Do not generate weight loss plan. Flag for professional referral. |
| 18.5–24.9 | Standard plan |
| 25.0–29.9 | Standard weight loss plan |
| 30.0–34.9 | Conservative plan. Include professional referral recommendation. |
| ≥ 35.0 | Include mandatory professional referral. Aggressive deficit not permitted. |

BMI is a population-level reference, not a diagnosis. Athletes with high muscle mass will show elevated BMI — use context from the user profile.

## Output Format

Always return structured JSON:

```json
{
  "output_type": "calorie_calculation",
  "formula_used": "mifflin_st_jeor | harris_benedict",
  "data": {
    "bmr": 1580,
    "activity_level": "moderate",
    "activity_factor": 1.55,
    "tdee": 2449,
    "goal": "lose",
    "goal_adjustment": -350,
    "target_calories": 2099,
    "minimum_applied": false,
    "bmi": 24.2,
    "bmi_flag": null
  },
  "explanation": "Con tu nivel de actividad moderado y objetivo de pérdida de peso, tu meta diaria es 2,099 kcal — un déficit de 350 kcal que debería llevarte a perder unos 0.35 kg por semana.",
  "warnings": []
}
```

If a warning applies (minimum calories capped, professional referral needed), add it to the `warnings` array as a string.

## What NOT to Do

- Do not generate macro distributions — that is the `macro-distribution` skill's job
- Do not generate meal plans — that is the `meal-generation` skill's job
- Do not invent or estimate missing profile data
- Do not lower target calories below the absolute minimums under any circumstances
