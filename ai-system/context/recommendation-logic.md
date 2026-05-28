# recommendation-logic.md — Lógica del Motor de Recomendaciones

> Define cómo el sistema decide qué recomendar, cuándo hacerlo y con qué nivel de urgencia. El `recommendation-engine` es el agente que aplica esta lógica. Todos los demás agentes deben pasar sus diagnósticos por este motor antes de presentar algo al usuario.

---

## Principio Central

> Las recomendaciones del sistema no son genéricas. Son el resultado de cruzar el estado actual del usuario con su historial, su objetivo y las reglas nutricionales. Una recomendación sin datos del usuario es un fracaso del sistema.

---

## Árbol de Decisión Principal

```
¿Hay datos suficientes para recomendar?
├── NO → Solicitar datos faltantes. No recomendar.
└── SÍ → ¿Cuál es el estado de progreso?
          ├── EN RUTA      → Reforzar lo que funciona. Ajuste mínimo.
          ├── ESTANCADO    → Diagnóstico de causa. Ajuste moderado.
          └── REGRESIÓN    → Diagnóstico urgente. Ajuste significativo.
```

---

## Estados de Progreso

### Estado 1 — En Ruta ✅

**Criterios:**
- Peso sigue la tendencia esperada (±20% del ritmo objetivo)
- Adherencia ≥ 70% en los últimos 14 días
- Sin señales de alarma

**Acciones del sistema:**
- Continuar el plan actual sin cambios
- Enviar mensaje de refuerzo positivo con dato específico
- Si la adherencia es ≥ 90%, explorar si el usuario quiere ajustar la velocidad de progreso

**Ejemplo de output:**
```json
{
  "status": "on_track",
  "recommendation": "maintain",
  "message": "¡Vas muy bien! Esta semana perdiste 0.4 kg, exactamente en línea con tu meta. Continúa con el plan actual.",
  "plan_change": false
}
```

---

### Estado 2 — Estancado ⚠️

**Criterios:**
- Variación de peso < ±0.3 kg en 14 días consecutivos
- O adherencia entre 40–69% (posible causa comportamental)

**Protocolo de diagnóstico (en orden):**

1. **Verificar adherencia al plan**
   - Si adherencia < 60% → causa probable: comportamental, no calórica
   - Recomendación: simplificar el plan, no reducir más calorías

2. **Verificar registro de comidas**
   - ¿El usuario registra todo? El subreporte es la causa más común de estancamiento
   - Recomendación: auditar un día típico con el usuario

3. **Verificar si hay adaptación metabólica**
   - ¿Lleva más de 8 semanas en déficit continuo? Probable adaptación
   - Recomendación: semana de mantenimiento calórico (diet break)

4. **Ajuste calórico**
   - Solo si los puntos 1–3 están descartados
   - Reducir 150–200 kcal adicionales
   - Nunca bajar del mínimo absoluto

**Ejemplo de output:**
```json
{
  "status": "stalled",
  "primary_cause": "low_adherence",
  "adherence_last_14d": 0.52,
  "recommendation": "simplify_plan",
  "message": "Tu peso se ha mantenido estable. Vemos que seguiste el plan el 52% de los días — eso es normal y tiene solución. Te proponemos un plan simplificado con las mismas calorías pero comidas más fáciles.",
  "plan_change": true,
  "calorie_adjustment": 0
}
```

---

### Estado 3 — Regresión 🔴

**Criterios (pérdida de peso):**
- Aumento de peso > 0.5 kg en la última semana sin cambio intencional de objetivo
- O pérdida de peso cuando el objetivo es ganancia muscular

**Criterios (ganancia muscular):**
- Pérdida de peso > 0.3 kg/semana cuando el objetivo es ganar
- O sin cambio de peso en 3 semanas con superávit confirmado

**Protocolo:**
1. Verificar si el cambio es real o fluctuación de agua (contexto: menstruación, sal, hidratación)
2. Si es real: diagnóstico urgente con datos de los últimos 14 días
3. Proponer ajuste calórico con justificación clara
4. Notificar al usuario con tono empático, no alarmista

**Ejemplo de output:**
```json
{
  "status": "regression",
  "weight_change_7d": +0.6,
  "probable_cause": "caloric_surplus_exceeded",
  "recommendation": "reduce_surplus",
  "message": "Esta semana el peso subió un poco más de lo esperado. Revisamos tus registros y parece que el fin de semana hubo algunas comidas fuera del plan. Sin problema — ajustamos ligeramente las calorías del fin de semana para compensar.",
  "plan_change": true,
  "calorie_adjustment": -150
}
```

---

## Lógica de Personalización de Recomendaciones

### Por arquetipo de usuario

| Arquetipo | Estilo de recomendación | Nivel de detalle |
|---|---|---|
| Principiante motivado | Empático, motivador, simple | Bajo — sin jerga |
| Atleta amateur | Directo, técnico, preciso | Alto — con números |
| Ocupado consistente | Muy breve, accionable | Mínimo — solo qué hacer |
| Reincidente | Empático, sin culpa, wins rápidos | Bajo — énfasis en progreso relativo |
| Experto autodirigido | Datos completos, sin explicaciones básicas | Máximo — raw data disponible |

### Por momento del día

| Franja horaria | Tipo de recomendación prioritaria |
|---|---|
| 06:00–09:00 | Plan del día, qué desayunar, motivación matutina |
| 12:00–14:00 | Recordatorio de registro de almuerzo, estado del día |
| 18:00–20:00 | Resumen del día, qué falta para cerrar macros |
| 21:00–22:00 | Resumen diario, progreso de la semana |

---

## Sistema de Priorización

Cuando hay múltiples recomendaciones posibles, el sistema usa este orden de prioridad:

1. **Seguridad** — Si hay señal de alarma de salud, siempre va primero
2. **Retención en riesgo** — Si el usuario lleva 2+ días sin abrir la app
3. **Ajuste de plan pendiente** — Si hay diagnóstico sin aplicar
4. **Refuerzo de hábito** — Si el usuario está en racha positiva
5. **Educación nutricional** — Contenido de valor sin urgencia

---

## Reglas Anti-Saturación

Para evitar que el usuario sienta el sistema como intrusivo:

- Máximo 1 recomendación de ajuste de plan por ciclo (2 semanas)
- No enviar recomendaciones educativas cuando hay una de ajuste pendiente
- Si el usuario rechaza una recomendación, no volver a presentarla por 7 días
- Si el usuario rechaza la misma recomendación 2 veces, archivarla y no presentarla más

---

## Memoria de Recomendaciones

Cada recomendación generada se registra en memoria con:

```json
{
  "recommendation_id": "uuid",
  "date": "2026-05-02",
  "type": "plan_adjustment | habit_reinforcement | educational | retention",
  "status": "pending | accepted | rejected | expired",
  "trigger": "stalled_progress | low_adherence | streak | ...",
  "user_response": null,
  "plan_change_applied": false
}
```

Este historial permite al sistema aprender qué tipos de recomendaciones acepta cada usuario y priorizar esas en el futuro.

---

## Recomendaciones Proactivas vs Reactivas

### Reactivas (trigger = evento)
Se generan cuando ocurre un evento específico:
- El usuario registró sus comidas → comparar con objetivo del día
- El usuario registró su peso → evaluar tendencia
- El usuario abre la app tras 2+ días de inactividad → reengagement

### Proactivas (trigger = tiempo o patrón)
Se generan en ciclos predefinidos sin que el usuario haga nada:
- Cada 2 semanas → diagnóstico de progreso y posible ajuste de plan
- Cada domingo → resumen semanal
- Cada mes → reporte de progreso con comparativa

---

## Formato de Output de Recomendaciones

Toda recomendación debe seguir este schema:

```json
{
  "recommendation_id": "uuid",
  "timestamp": "ISO 8601",
  "user_id": "uuid",
  "type": "plan_adjustment | reinforcement | educational | alert",
  "priority": "high | medium | low",
  "trigger": "descripción del evento que lo generó",
  "status_before": "on_track | stalled | regression",
  "data_used": {
    "days_analyzed": 14,
    "adherence": 0.72,
    "weight_change_kg": -0.6,
    "target_change_kg": -0.7
  },
  "recommendation": {
    "action": "descripción de la acción sugerida",
    "plan_change": true,
    "calorie_adjustment": -150,
    "macro_adjustments": {}
  },
  "message_for_user": "Texto empático y personalizado para mostrar al usuario",
  "requires_user_confirmation": false
}
```
