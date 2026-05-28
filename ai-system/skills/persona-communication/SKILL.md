---
name: persona-communication
description: Adapts any user-facing message to the correct tone, vocabulary, length, and communication style based on the user's persona archetype. Use this skill whenever an agent generates text that the user will read — "adapt this message for this user type", "what tone should I use with this user?", "rewrite this for an athlete", "this user is a beginner, adjust the language". All agents that produce user-facing text should invoke this skill. Also use when you need to identify what persona a user fits based on their onboarding data or behavior patterns.
---

# Skill: persona-communication

Every word the system shows a user either builds trust or erodes it. The content might be correct — the macros, the diagnosis, the recommendation — but if the communication style doesn't match who the user is, they'll disengage. This skill ensures the system speaks each user's language, not a generic fitness-app language.

## The Five Personas

### 1. Principiante Motivado
**Who:** 25–40 years old. No prior structure around nutrition. Motivated by the idea of change but easily overwhelmed by complexity. Needs early wins to sustain momentum.

**Communication style:**
- Short sentences, small paragraphs
- No technical terms without a brief explanation the first time
- Celebrate frequently, even small things
- Always explain *why* something works — not just *what* to do
- Warm, encouraging, never condescending

**Example adaptation:**
```
Technical: "Tu adherencia resultó en un déficit calórico de 287 kcal."
Adapted:   "Esta semana comiste un poco menos de lo planeado — eso es exactamente 
            lo que necesitamos para bajar de peso. Vas por buen camino."
```

---

### 2. Atleta Amateur
**Who:** 20–35 years old. Trains 3–5 times per week. Has existing knowledge of fitness concepts (macros, TDEE, RPE). Wants precision, not hand-holding.

**Communication style:**
- Technical vocabulary is welcome (macros, TDEE, periodización, déficit calórico)
- Skip explaining basics
- Lead with data — numbers first, then context
- Respect prior knowledge: don't explain what protein does
- Tone: peer-to-peer, not teacher-to-student

**Example adaptation:**
```
Generic: "Estás comiendo bien y progresando."
Adapted: "Semana sólida: déficit real de ~320 kcal/día, pérdida de 0.4 kg, 
          proteína promedio de 152g. El próximo ajuste es en 6 días si el ritmo se mantiene."
```

---

### 3. Ocupado Consistente
**Who:** 30–50 years old. Professional with limited time. Wants the system to handle complexity for them. Does not want to read paragraphs — they want the one thing they need to know right now.

**Communication style:**
- Maximum 2–3 lines per message
- Lead with the single most important point
- No introductions, no context unless critical
- Action-first format: what they do, not why
- Ruthlessly concise

**Example adaptation:**
```
Detailed: "Esta semana tu adherencia fue del 71%, lo que resultó en una pérdida de 0.3 kg.
           Tu proteína se mantuvo alta, lo cual es positivo. Para la siguiente semana, 
           recomendamos mantener el plan sin cambios."
Adapted:  "Semana: −0.3 kg. Plan sigue igual. Mañana: pollo con arroz a las 13:00."
```

---

### 4. Reincidente
**Who:** Any age. Has tried diets or fitness plans before and failed. Comes in with skepticism and, often, shame about past attempts. Quick to interpret data as confirmation of failure.

**Communication style:**
- Lead with relative progress ("mejor que la semana pasada"), never absolute goals
- Never mention past diet history or failures
- Celebrate adherence, not just the scale — showing up matters even when results are slow
- Gentle with plateaus — frame as normal, not as their fault
- Avoid language that implies judgment

**Example adaptation:**
```
Standard: "No alcanzaste tu meta de pérdida esta semana."
Adapted:  "Esta semana el progreso fue más lento de lo habitual — eso pasa. 
           Lo que importa: registraste 5 días, que es más que la semana pasada. 
           Esa consistencia es lo que genera resultados con el tiempo."
```

---

### 5. Experto Autodirigido
**Who:** 25–45 years old. Works in fitness, nutrition, or has deep self-taught knowledge. Wants control, raw data, and to be treated as an equal. May push back if the system oversimplifies.

**Communication style:**
- Raw data available on request, no filtering
- No explanations of concepts they clearly know
- Respect their manual overrides without questioning them
- Offer options rather than prescriptions
- Peer tone: "here's what the data shows" not "here's what you should do"

**Example adaptation:**
```
Guided: "Ajustamos tus calorías a 1,600 kcal. Este cambio debería ayudarte a 
         perder peso más rápido."
Adapted: "Ajuste propuesto: −150 kcal (1,750 → 1,600). Reducción en carbos (175g → 140g), 
          proteína sin cambio. ¿Aprobás o preferís ajustar otra variable?"
```

---

## Identifying Persona from Data

When the persona is not explicitly set in memory, infer it from available signals:

| Signal | Likely persona |
|---|---|
| First week in app, no prior plan history | Principiante motivado |
| Logs macros with precision, uses fitness terminology in questions | Atleta amateur / Experto autodirigido |
| Short log entries, irregular but consistent, opens app in < 2 min | Ocupado consistente |
| Mentions "I've tried this before" or expresses doubt | Reincidente |
| Requests raw data, overrides plan recommendations | Experto autodirigido |
| Asks "why" frequently | Principiante motivado |

When uncertain, default to **Principiante motivado** — it's better to over-explain to someone who knows than to under-explain to someone who doesn't.

## Applying the Skill

Given a message draft and a user persona, transform the message by:

1. Adjusting vocabulary to match the persona's level
2. Trimming or expanding length per persona rules
3. Reordering information (data-first vs context-first vs action-first)
4. Replacing prohibidos phrases if any appear
5. Adding or removing technical terms appropriately

Always preserve the core information — never change the meaning, only the presentation.

## Output Format

Return the adapted message ready to use, followed by a brief note on what was changed:

```json
{
  "output_type": "persona_communication",
  "persona": "ocupado_consistente",
  "original_message": "Esta semana tu adherencia fue del 71%, lo que resultó en...",
  "adapted_message": "Semana: −0.3 kg. Plan sigue igual. Mañana: pollo con arroz a las 13:00.",
  "adaptations_applied": [
    "Reduced to 2 lines",
    "Led with the single key metric",
    "Added specific next action"
  ]
}
```

## What NOT to Do

- Do not change the factual content — only the presentation
- Do not use the same tone for all users regardless of their persona
- Do not assume a persona without checking memory first
- Do not over-explain to the Atleta or Experto — it reads as condescending
- Do not under-explain to the Principiante — they'll feel lost and disengage
