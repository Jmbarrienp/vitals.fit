---
name: retention-messaging
description: Generates personalized retention messages, push notifications, milestone celebrations, and re-engagement content for fitness app users. Use this skill whenever you need to communicate with a user to maintain their engagement — "generate a notification for this user", "the user hasn't logged in 3 days, what do we send?", "celebrate this milestone", "create a weekly progress summary", "write a re-engagement message". The retention-agent always uses this skill. Never generate generic messages — every output must reference the user's actual data.
---

# Skill: retention-messaging

This skill generates the messages users see from the app. These communications are the human face of the system — and they determine whether users feel the app knows them or treats them like a number. A message that references a user's real data creates loyalty; a generic one creates churn.

The retention-agent is co-equal to the nutritionist-agent in business importance. Most fitness apps die not from bad calculations, but from abandonment in week 2. Every message this skill produces is a defense against that.

## Required Inputs

| Field | Source | Notes |
|---|---|---|
| `user_name` | User memory | Use first name only |
| `goal` | User memory | `lose` \| `maintain` \| `gain` |
| `days_inactive` | App event system | Days since last app open |
| `last_action` | App event system | What the user did last |
| `recent_progress` | `progress-analysis` output | Latest diagnosis |
| `milestones` | User memory | Completed and pending milestones |
| `adherence_log` | User memory | Recent days |
| `habit_data` | User memory | Typical app usage times |
| `message_type` | Calling agent | `push_notification` \| `in_app_feedback` \| `weekly_summary` \| `milestone_celebration` \| `reengagement` |

## Message Types and Limits

| Type | Max length | Tone | Emoji |
|---|---|---|---|
| Push notification | 60 characters | Friendly, specific | Max 1, optional |
| In-app feedback (daily) | 3–4 lines | Analytical + warm | Max 1 in celebrations |
| Weekly summary | 150–200 words | Celebratory or analytic, data-forward | Max 1 |
| Milestone celebration | 2–3 lines | Genuinely festive, specific achievement | Max 1 |
| Re-engagement | 2–3 lines | Close, no guilt, anchored to a recent win | None |

**Hard limits:**
- Maximum 2 notifications per day per user
- Minimum 4 hours between notifications
- No notifications between 22:00 and 07:00 (user's local time)

## Message Construction Rules

### 1. Always reference real data

Every message must contain at least one specific data point from the user's history.

```
BAD:  "¡No olvides registrar tus comidas hoy!"
GOOD: "Llevas 5 días seguidos cumpliendo tu meta. ¡Hoy es el día 6 — ya casi completas tu primera semana perfecta!"
```

### 2. No guilt, always reframe

The system never frames inaction as failure. Every message about a missed day reframes toward the next opportunity.

```
BAD:  "No cumpliste tu meta ayer"
GOOD: "Ayer fue un día diferente. Hoy tu meta sigue siendo 1,750 kcal — fresco inicio."
```

### 3. Concrete next action

Every message ends with something specific the user can do right now or today.

```
BAD:  "Esta semana fue irregular."
GOOD: "Esta semana fue irregular. Para empezar fresco: hoy a las 8pm tienes programado el pollo con arroz. ¿Lo anotas?"
```

### 4. Numbers with context

Numbers alone mean nothing to most users. Always pair them with their implication.

```
BAD:  "Consumiste 1,623 kcal"
GOOD: "Consumiste 1,623 kcal — 127 menos que tu meta. Vas bien encaminado."
```

### 5. Format numbers consistently
- Calories and grams: whole integers
- Weight: 1 decimal maximum (68.4 kg)
- Percentages: no decimals

## Milestone Triggers

Generate a milestone celebration when the user reaches any of these:

| Milestone | Trigger |
|---|---|
| Primera semana completada | 7 consecutive days logging |
| Primer kilo de progreso | 1 kg lost/gained toward goal |
| 7 días de racha | 7 consecutive days plan followed |
| 30 días en la app | App account is 30 days old |
| Cada 5 kg de progreso | Every 5 kg toward goal |
| Objetivo alcanzado | User reaches their declared goal weight |

Each celebration must name the specific achievement — not a generic "great job."

```
GOOD: "¡Primer kilo perdido! Eso son semanas de decisiones consistentes. 
       Ya tienes el ritmo — el siguiente viene más fácil."
```

## Re-engagement Triggers

Generate a re-engagement message when `days_inactive` meets the threshold:

| days_inactive | Urgency | Message focus |
|---|---|---|
| 2–3 | Low | Gentle reminder + recent win |
| 4–6 | Medium | Anchor to last good moment + easy next step |
| 7–13 | High | Empathetic, zero judgment, offer to simplify |
| 14+ | Critical | Offer plan reset or goal review |

For 7+ days inactive, also signal to the `recommendation-engine` that the plan may need simplification.

## Per Persona Adjustments

Apply these modifiers based on user persona stored in memory:

| Persona | Adjustment |
|---|---|
| Principiante motivado | Celebrate more frequently. Short sentences. Explain "why". |
| Atleta amateur | Technical language OK. Dense data. Respect their knowledge. |
| Ocupado consistente | Maximum 2 lines. Only what's needed to act. No introductions. |
| Reincidente | Relative progress ("better than last week"). Celebrate adherence, not just scale results. Never reference past failures. |
| Experto autodirigido | Raw data on request. Peer-to-peer tone. No hand-holding. |

## Prohibited Words and Phrases

| Never say | Say instead |
|---|---|
| "No cumpliste" | "Mañana es otra oportunidad" |
| "Fallaste" | "Fue una semana diferente" |
| "Estás lejos de tu meta" | "Ya llevas X% del camino" |
| "Dieta" | "Plan de alimentación" |
| "Prohibido" | "Fuera de tu plan actual" |
| "Trampa" (cheat meal) | "Comida libre" / "día flexible" |
| "Gordo/a" | Never — use objective data only |

## Output Format

```json
{
  "output_type": "retention_message",
  "message_type": "push_notification",
  "user_id": "uuid",
  "generated_at": "2026-05-03T09:00:00Z",
  "scheduled_for": "2026-05-03T19:00:00Z",
  "content": {
    "title": "Llevas 5 días seguidos 💪",
    "body": "Hoy completas tu primera semana perfecta. Abre y registra la cena."
  },
  "data_referenced": ["streak_days: 5", "meal_pending: dinner"],
  "persona_applied": "principiante_motivado",
  "milestone_triggered": null
}
```

For weekly summary:

```json
{
  "output_type": "retention_message",
  "message_type": "weekly_summary",
  "content": {
    "title": "Tu semana del 27 de abril al 3 de mayo",
    "body": "Esta semana perdiste 0.4 kg — exactamente lo esperado. Registraste 6 de 7 días y seguiste el plan el 71% del tiempo.\n\nLo más destacado: mantuviste tu proteína por encima de 130g todos los días. Eso protege tu músculo mientras pierdes grasa.\n\nPara la semana que viene: el lunes empieza tu nueva versión del plan — las comidas son casi iguales, solo ajustamos las porciones del almuerzo.",
    "cta": "Ver mi plan de la semana"
  },
  "data_referenced": ["weight_loss_weekly: 0.4kg", "days_logged: 6", "adherence_pct: 71", "avg_protein_g: 138"]
}
```

## What NOT to Do

- Never send a generic message that could apply to any user
- Never reference a data point that isn't actually in the user's record
- Never send more than 2 notifications in a 24-hour period
- Never send notifications outside 07:00–22:00 local time
- Never diagnose a health issue or comment on medical conditions
- Never use alarm-provoking language (weight gained = always explore the cause before commenting)
