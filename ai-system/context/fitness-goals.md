# fitness-goals.md — Objetivos Fitness y Estrategias

> Define los objetivos fitness soportados por el sistema, cómo se configuran, qué estrategia nutricional aplica a cada uno y cómo se mide el éxito. Todos los agentes deben mapear cada usuario a exactamente un objetivo primario.

---

## Objetivos Soportados

El sistema soporta **5 objetivos primarios**. Durante el onboarding, el usuario elige uno. Los agentes adaptan toda su lógica a este objetivo.

---

## Objetivo 1 — Pérdida de Peso

**Definición:** Reducir el peso corporal total, con prioridad en reducir masa grasa y preservar masa muscular.

**Perfil de usuario típico:** Exceso de peso, quiere mejorar salud y/o apariencia.

### Estrategia nutricional
```
Déficit calórico: −300 a −500 kcal del TDEE
Proteína alta:    2.0–2.4 g/kg (preserva músculo en déficit)
Carbos moderados: ajustados al presupuesto calórico restante
Grasas saludables: 25–30% del total calórico
```

### Estrategia de ejercicio (trainer-agent)
- Combinación de cardio + entrenamiento de fuerza
- El cardio quema calorías adicionales; la fuerza preserva masa muscular
- No solo cardio — perder músculo enlentece el metabolismo

### Métricas de progreso
- Peso corporal (báscula) — tendencia semanal, no diaria
- Medidas corporales (cintura, cadera) — cada 2 semanas
- Fotos de progreso — cada 4 semanas
- Adherencia al plan — diaria

### Criterios de éxito
- Pérdida de 0.3–0.8 kg/semana en promedio
- Mantenimiento o aumento de fuerza
- Adherencia ≥ 70% en la semana

### Señales de alarma
- Pérdida > 1 kg/semana → revisar si el déficit es demasiado agresivo
- Pérdida de fuerza sostenida → aumentar proteína
- Sin cambio de peso en 14 días → `progress-analyst` activa diagnóstico

---

## Objetivo 2 — Ganancia Muscular

**Definición:** Aumentar masa muscular con mínima ganancia de grasa corporal.

**Perfil de usuario típico:** Persona delgada que quiere volumen, o atleta que busca hipertrofia.

### Estrategia nutricional
```
Superávit calórico: +200 a +300 kcal del TDEE (ganancia limpia)
Proteína alta:      1.8–2.2 g/kg
Carbos elevados:    fuente principal de energía para entrenamientos
Grasas:            20–30%
```

### Estrategia de ejercicio (trainer-agent)
- Entrenamiento de fuerza como prioridad (3–5 días/semana)
- Cardio mínimo y de baja intensidad (preservar calorías para músculo)
- Progresión de carga como indicador de éxito

### Métricas de progreso
- Peso corporal — tendencia semanal (debe subir gradualmente)
- Marcas en ejercicios clave (sentadilla, press, peso muerto)
- Medidas de perímetro muscular (bíceps, pecho, muslo)

### Criterios de éxito
- Ganancia de 0.2–0.4 kg/semana
- Mejora progresiva en fuerza
- Sin aumento desproporcionado de grasa corporal (< 40% del peso ganado)

### Señales de alarma
- Sin ganancia de peso en 3 semanas → aumentar calorías en +100 kcal
- Ganancia > 0.6 kg/semana → probable exceso de grasa, reducir superávit
- Sin mejora de fuerza en 4 semanas → revisar plan de entrenamiento

---

## Objetivo 3 — Mantenimiento

**Definición:** Mantener el peso y la composición corporal actuales, con hábitos saludables.

**Perfil de usuario típico:** Ha alcanzado su peso objetivo y quiere sostenerlo, o simplemente quiere comer bien sin cambiar su peso.

### Estrategia nutricional
```
Calorías: TDEE (sin ajuste)
Proteína: 1.6–2.0 g/kg (mantiene masa muscular)
Balance flexible de carbos y grasas
```

### Estrategia de ejercicio (trainer-agent)
- Actividad física regular, mix de fuerza y cardio
- Objetivo: salud general, no cambio de composición

### Métricas de progreso
- Peso estable (±1 kg fluctuación normal)
- Bienestar general y energía
- Adherencia a hábitos saludables

### Criterios de éxito
- Peso dentro de ±2 kg del objetivo durante el mes
- Adherencia ≥ 60% al plan
- Sin aumento sostenido de peso

### Señales de alarma
- Aumento > 2 kg en un mes → revisar calorías
- Pérdida > 2 kg en un mes → revisar ingesta

---

## Objetivo 4 — Recomposición Corporal

**Definición:** Perder grasa y ganar músculo simultáneamente. El más exigente y lento.

**Perfil de usuario típico:** Principiantes o personas que retoman el entrenamiento tras un parón, con buena adherencia.

> **Nota del sistema:** La recomposición real es más eficiente en principiantes o personas con sobrepeso. Para usuarios avanzados, es más efectivo alternar fases de volumen y definición.

### Estrategia nutricional
```
Calorías: TDEE o ligero déficit (−100 a −200 kcal)
Proteína muy alta: 2.2–2.6 g/kg (prioridad máxima)
Carbos: timing importante — más antes/después del entrenamiento
Grasas: 25–30%
```

### Estrategia de ejercicio (trainer-agent)
- Entrenamiento de fuerza progresivo, 3–5 días/semana
- Cardio moderado (no excesivo — interfiere con ganancia muscular)

### Métricas de progreso
- Peso puede quedarse igual o cambiar poco → no es indicador principal
- Medidas corporales: perder en cintura, ganar en bíceps/pecho
- Fotos de progreso cada 4 semanas
- Fuerza en entrenamiento

### Criterios de éxito
- Cambio favorable en medidas (aunque el peso no cambie)
- Mejora de fuerza
- Cambio visible en composición a los 2–3 meses

---

## Objetivo 5 — Salud General y Bienestar

**Definición:** Sin objetivo de cambio de peso concreto. Foco en hábitos saludables, energía y bienestar.

**Perfil de usuario típico:** Arquetipo "El Ocupado Consistente". No obsesionado con la báscula.

### Estrategia nutricional
```
Calorías: TDEE (estimado)
Macros: distribución balanceada sin restricción excesiva
Énfasis en: variedad, frutas, verduras, proteína suficiente
```

### Estrategia de ejercicio (trainer-agent)
- Actividad física agradable y sostenible
- Mínimo 150 min/semana de actividad moderada (recomendación OMS)

### Métricas de progreso
- Energía diaria (auto-reporte)
- Calidad del sueño (auto-reporte)
- Adherencia general a hábitos

---

## Cambio de Objetivo

El usuario puede cambiar de objetivo. El sistema debe:

1. Registrar el cambio en memoria con la fecha
2. Recalcular TDEE y macros para el nuevo objetivo
3. Generar un nuevo plan a partir del siguiente día
4. No borrar el historial anterior — compararlo en reportes de progreso
5. Notificar al usuario el nuevo objetivo calórico y sus implicaciones

### Restricciones en cambio de objetivo
- No permitir cambio de objetivo más de 1 vez por semana (evitar confusión)
- Si el usuario lleva < 7 días en el objetivo actual, sugerir mantenerlo más tiempo antes de cambiar
- Si hay pérdida de peso rápida (> 1 kg/semana), antes de aceptar el cambio verificar que no sea señal de problema

---

## Matriz de Configuración por Objetivo

| Objetivo | Déficit/Superávit | Proteína (g/kg) | Cardio | Fuerza |
|---|---|---|---|---|
| Pérdida de peso | −300 a −500 kcal | 2.0–2.4 | Alto | Moderado |
| Ganancia muscular | +200 a +300 kcal | 1.8–2.2 | Bajo | Alto |
| Mantenimiento | 0 kcal | 1.6–2.0 | Moderado | Moderado |
| Recomposición | −100 a −200 kcal | 2.2–2.6 | Moderado | Alto |
| Salud general | 0 kcal | 1.4–1.8 | Moderado | Moderado |
