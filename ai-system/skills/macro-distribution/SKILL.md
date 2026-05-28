---
name: macro-distribution
description: Distributes total daily calories into protein, carbohydrates, and fat targets in grams, calibrated by fitness goal. Use this skill whenever you need to calculate macronutrient splits — for example "calculate macros for this user", "how much protein should they eat?", "distribute these calories by goal", or after calorie-calculation produces a target. The nutritionist-agent always invokes this skill after calorie-calculation to complete the nutritional target.
---

# Skill: macro-distribution

This skill converts a total calorie target into actionable gram targets for protein, carbohydrates, and fat. These numbers directly determine what goes into a meal plan — precision here is what makes the difference between a generic diet and a plan that actually works for this user's specific body and goal.

## Required Inputs

| Field | Source | Notes |
|---|---|---|
| `target_calories` | Output of `calorie-calculation` | Always run calorie-calculation first |
| `weight_kg` | User memory | Current weight for protein calculation |
| `goal` | User memory | `lose` \| `maintain` \| `gain` |
| `dietary_restrictions` | User memory | `vegetarian`, `vegan`, `gluten_free`, etc. |

## Macro Ranges by Goal

### Weight Loss (`lose`)
```
Protein:  2.0–2.4 g per kg body weight
Fat:      25–30% of total calories
Carbs:    Remaining calories
```

High protein preserves muscle mass during a caloric deficit. This is non-negotiable — low protein during weight loss causes muscle loss, which lowers BMR and creates a cycle that's hard to break.

### Maintenance (`maintain`)
```
Protein:  1.6–2.0 g per kg body weight
Fat:      25–35% of total calories
Carbs:    Remaining calories
```

### Muscle Gain (`gain`)
```
Protein:  1.8–2.2 g per kg body weight
Fat:      20–30% of total calories
Carbs:    Remaining calories (energy priority for training performance)
```

## Caloric Equivalences

```
1 g protein       = 4 kcal
1 g carbohydrate  = 4 kcal
1 g fat           = 9 kcal
```

## Calculation Steps

### Step 1: Set protein target

Pick a value within the range based on context:
- Use the higher end of the range if the user trains resistance 4+ days/week
- Use the lower end if the user is mostly sedentary or does cardio only
- For `lose`: default to 2.2 g/kg
- For `maintain`: default to 1.8 g/kg
- For `gain`: default to 2.0 g/kg

```
protein_g = protein_ratio × weight_kg
protein_kcal = protein_g × 4
```

### Step 2: Set fat target

Pick a percentage within the range:
- Default to the middle of the range (e.g., 27.5% for weight loss)
- Lean toward lower fat for `gain` to leave more room for carbs
- Lean toward higher fat if user is lower-carb adapted or has low carb tolerance

```
fat_kcal = fat_percentage × target_calories
fat_g = fat_kcal / 9
```

### Step 3: Calculate remaining calories for carbs

```
carb_kcal = target_calories − protein_kcal − fat_kcal
carb_g = carb_kcal / 4
```

### Step 4: Verify minimum carbohydrates

Carbs below 50g/day are only appropriate in clinically supervised ketogenic contexts. If `carb_g < 50`, reduce protein or increase calories before delivering this output.

### Step 5: Fiber target

| Group | Minimum daily fiber |
|---|---|
| Women | 25 g |
| Men | 38 g |

The plan must achieve at least 80% of this target. Flag it in the output so meal-generation can account for it.

### Step 6: Hydration recommendation

```
water_ml = weight_kg × 35
```

Adjustments:
- Intense exercise (> 60 min): add 500–750 ml
- Hot climate: add 250–500 ml
- High protein diet: add 250 ml

## Worked Example

```
User: Female, 70 kg, goal: lose, 1,700 kcal/day

Protein: 2.2 g × 70 kg = 154 g → 154 × 4 = 616 kcal (36%)
Fat: 27% of 1,700 = 459 kcal → 459 / 9 = 51 g
Carbs: 1,700 − 616 − 459 = 625 kcal → 625 / 4 = 156 g

Check: 154×4 + 156×4 + 51×9 = 616 + 624 + 459 = 1,699 kcal ✓
```

## Output Format

```json
{
  "output_type": "macro_distribution",
  "data": {
    "total_calories": 1700,
    "goal": "lose",
    "weight_kg": 70,
    "protein": {
      "g": 154,
      "kcal": 616,
      "pct": 36,
      "ratio_per_kg": 2.2
    },
    "fat": {
      "g": 51,
      "kcal": 459,
      "pct": 27
    },
    "carbs": {
      "g": 156,
      "kcal": 625,
      "pct": 37
    },
    "fiber_target_g": 25,
    "water_ml": 2450
  },
  "explanation": "Con 70 kg y objetivo de pérdida de peso, tu meta diaria es 154g proteína, 156g carbohidratos y 51g grasa. La proteína alta protege tu masa muscular mientras pierdes grasa.",
  "warnings": []
}
```

## Dietary Restriction Adjustments

If `dietary_restrictions` contains relevant items, note adjustments in the output:

- **Vegetarian / Vegan:** Flag that protein sources will be plant-based. Watch for complete proteins (combine legumes + grains). Consider B12, iron, zinc in meal generation.
- **Gluten-free:** No wheat, barley, rye — carb sources shift to rice, potato, oats (certified GF), corn.

These flags are passed to `meal-generation` — do not try to solve them here.

## What NOT to Do

- Do not generate food combinations or meal plans — that is `meal-generation`'s job
- Do not modify the total calorie target — that came from `calorie-calculation`
- Do not round aggressively (use integers for grams, but don't round calories until the final total)
- Do not invent a macro split without justifying it against the ranges above
