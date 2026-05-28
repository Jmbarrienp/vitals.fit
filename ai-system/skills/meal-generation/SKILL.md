---
name: meal-generation
description: Generates personalized 7-day meal plans that meet macro targets while respecting dietary restrictions, food preferences, and variety rules. Use this skill whenever you need to build a meal plan — "generate a meal plan for this user", "create week 1 plan", "suggest what they should eat", "update the meal plan after adjustment". Triggered by onboarding-agent (first plan), recommendation-engine (plan updates), and adaptive-planning (after biweekly adjustments).
---

# Skill: meal-generation

This skill turns a set of macro targets into a realistic, personalized weekly eating plan. The plan must feel achievable — not like a clinical prescription. If the food feels foreign, repetitive, or unsatisfying, the user will abandon it within days. Variety, palatability, and cultural relevance matter as much as hitting the numbers.

## Required Inputs

| Field | Source | Notes |
|---|---|---|
| `target_calories` | `calorie-calculation` output | Daily caloric target |
| `protein_g` | `macro-distribution` output | Daily protein target |
| `carbs_g` | `macro-distribution` output | Daily carb target |
| `fat_g` | `macro-distribution` output | Daily fat target |
| `fiber_target_g` | `macro-distribution` output | Daily fiber goal |
| `meal_count` | User preference | Default: 3 main meals + 1–2 snacks |
| `dietary_restrictions` | User memory | `vegetarian`, `vegan`, `gluten_free`, etc. |
| `allergies` | User memory | Zero tolerance — never include allergenic foods |
| `preferred_foods` | User memory | Prioritize these when possible |
| `disliked_foods` | User memory | Never include these |
| `region` | User memory | For culturally relevant food choices |

## Core Rules

### Variety
- No meal can appear in the same time slot more than **2 times in a 7-day plan**
- Across the whole plan, protein sources must rotate (e.g., chicken, eggs, fish, legumes — not 7 days of chicken)
- Breakfast options must vary at least every 2 days

### Macro Tolerance
- Each day must hit within **±5% of total daily calories**
- Each individual macro must hit within **±10% of the daily target**
- If a combination can't meet these tolerances, adjust portions before declaring failure

### Restrictions Are Absolute
- Dietary restrictions and allergies are non-negotiable constraints, not preferences
- If a plan cannot meet macro targets within the user's restrictions, flag it and suggest which constraint to reconsider — never silently violate a restriction

### Daily Coherence
- All meals in a day must sum to the daily macro targets
- Never design meals in isolation — always verify the full day's totals before finalizing

## Meal Structure

### Default structure (adjust to user preference)
```
Breakfast       ~25% of daily calories
Lunch           ~35% of daily calories
Dinner          ~30% of daily calories
Snack(s)        ~10% of daily calories
```

Each meal entry must include:
- Food name(s)
- Portion in grams or standard units
- Macros for that portion (protein, carbs, fat, calories)
- Brief preparation note if non-obvious

## Food Selection Guidelines

1. **Start with protein anchor** — choose the protein source first, then build the rest of the meal around it
2. **Match cultural context** — for Latin American users, prioritize: rice, beans, plantain, potato, chicken, fish, eggs, avocado, corn tortillas. These feel like real food, not diet food.
3. **Prioritize whole foods** — processed foods should be < 20% of any day's plan
4. **Use preferred foods first** — if the user has stated preferences in memory, use them when macro-compatible
5. **Substitute generously** — always note 1 easy swap for each main ingredient in case availability is an issue

## Generating the Plan

### For each of 7 days:

1. Select protein sources (ensuring variety across the week)
2. Build meals around those proteins
3. Calculate macros for each meal
4. Verify daily totals hit within tolerance
5. If out of tolerance, adjust portions (never skip the verification)
6. Tag any meals that repeat from previous days

### Substitution Logic

When a food is unavailable or restricted:
- Substitute with a food of similar macronutrient profile
- Note the substitution clearly
- Prioritize substitutes from the same food family (e.g., fish → fish, legume → legume)

## Output Format

```json
{
  "output_type": "meal_plan",
  "plan_version": 1,
  "created_at": "2026-05-03",
  "target_macros": {
    "calories": 1700,
    "protein_g": 154,
    "carbs_g": 156,
    "fat_g": 51
  },
  "days": [
    {
      "day": 1,
      "date": "2026-05-04",
      "meals": [
        {
          "type": "breakfast",
          "name": "Avena con huevos revueltos",
          "items": [
            { "food": "Avena en hojuelas", "amount_g": 60, "protein_g": 8, "carbs_g": 40, "fat_g": 3, "kcal": 220 },
            { "food": "Huevos enteros", "amount_g": 150, "units": "3 huevos", "protein_g": 19, "carbs_g": 1, "fat_g": 14, "kcal": 210 }
          ],
          "total": { "protein_g": 27, "carbs_g": 41, "fat_g": 17, "kcal": 430 },
          "substitutes": { "Avena en hojuelas": "Arroz integral cocido (misma cantidad)" }
        }
      ],
      "day_totals": { "protein_g": 152, "carbs_g": 158, "fat_g": 50, "kcal": 1698 },
      "tolerance_check": { "calories_ok": true, "protein_ok": true, "carbs_ok": true, "fat_ok": true }
    }
  ],
  "warnings": [],
  "explanation": "Tu plan de esta semana está calibrado para pérdida de peso con alta proteína. Puedes ajustar cualquier comida — los sustitutos están listados en cada una."
}
```

## Quality Checks Before Delivering

Run these checks before finalizing the plan:

- [ ] Each day's calorie total is within ±5% of target
- [ ] Each day's macro totals are within ±10% of targets
- [ ] No meal repeats in the same time slot more than twice
- [ ] No allergenic or restricted foods appear anywhere
- [ ] Protein sources vary throughout the week
- [ ] Each meal has at least one listed substitute
- [ ] Fiber target is approximately met (≥ 80% of daily goal)

## What NOT to Do

- Do not calculate TDEE or macro targets — get these from `calorie-calculation` and `macro-distribution`
- Do not generate medical meal plans for pregnancy, eating disorders, or minors — defer those cases
- Do not generate meals that rely entirely on supplements or protein shakes as primary food sources
- Do not generate the same plan twice — always introduce some variation between plan versions
