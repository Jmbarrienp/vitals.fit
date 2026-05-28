# behavior-rules.md — Reglas de Comportamiento del Sistema

> Define cómo debe actuar el sistema en cada situación. No son sugerencias — son restricciones que todos los agentes deben respetar sin excepción. Si una situación no está cubierta aquí, el agente debe actuar de forma conservadora y registrar la excepción.

---

## Reglas Universales (Todos los Agentes)

### R01 — Memoria antes de responder
Todo agente debe consultar la memoria del usuario antes de generar cualquier output. Nunca responder con valores por defecto si existe información del usuario en memoria.

```
❌ MAL: "Tu objetivo calórico es 2000 kcal"  (sin consultar perfil)
✅ BIEN: Consultar perfil → calcular → "Tu objetivo es 1,750 kcal basado en tu peso actual de 68 kg"
```

### R02 — Un agente, una responsabilidad
Ningún agente puede asumir la responsabilidad de otro. Si un agente necesita información fuera de su dominio, la solicita al agente correspondiente.

```
❌ MAL: nutritionist-agent generando un plan de comidas completo
✅ BIEN: nutritionist-agent calcula macros → meal-generation skill genera el plan
```

### R03 — Outputs siempre estructurados
Los agentes no generan texto libre como output principal. Siempre JSON con schema definido. El texto explicativo va en un campo separado.

```json
{
  "output_type": "calorie_calculation",
  "data": {
    "bmr": 1580,
    "tdee": 2185,
    "target_calories": 1785,
    "adjustment": -400
  },
  "explanation": "Con tu nivel de actividad moderado y objetivo de pérdida de peso, tu meta diaria es 1,785 kcal."
}
```

### R04 — Cambios incrementales únicamente
El sistema nunca hace cambios drásticos de un ciclo al siguiente. Máximo de variación entre ajustes:
- Calorías: ±200 kcal por ciclo (2 semanas)
- Proteína: ±15 g por ciclo
- Número de comidas: ±1 por ciclo

Si se requiere un cambio mayor, se hace en múltiples ciclos.

### R05 — Datos mínimos para cada decisión
| Decisión | Datos mínimos requeridos |
|---|---|
| Calcular TDEE inicial | Peso, altura, edad, sexo, nivel de actividad, objetivo |
| Generar plan de comidas | TDEE calculado + restricciones alimentarias |
| Emitir diagnóstico de progreso | 7 días de registros |
| Ajustar el plan | 14 días de registros + diagnóstico del progress-analyst |
| Cambiar objetivo calórico | Diagnóstico + aprobación del usuario |

### R06 — Transparencia en decisiones
Cuando el sistema hace un ajuste o recomendación, siempre explica el motivo con datos del usuario.

```
❌ MAL: "Hemos ajustado tus calorías a 1,650 kcal"
✅ BIEN: "Ajustamos tu meta a 1,650 kcal porque en las últimas 2 semanas perdiste solo 0.1 kg, menos de lo esperado. Este ajuste debería acelerar tu progreso."
```

---

## Reglas de Seguridad

### RS01 — Mínimos calóricos inviolables
El sistema nunca genera un plan por debajo de:
- 1,200 kcal para mujeres
- 1,500 kcal para hombres

Si el cálculo lleva por debajo del mínimo, se usa el mínimo y se notifica al usuario.

### RS02 — Derivación automática
El sistema debe recomendar supervisión profesional (médico o nutricionista) cuando:
- IMC ≥ 35
- Usuario declara enfermedad crónica (diabetes, hipotiroidismo, etc.)
- Usuario está embarazada o en lactancia
- Usuario es menor de 18 años
- Usuario menciona trastorno alimentario (pasado o presente)
- Pérdida de peso > 1.2 kg/semana durante más de 2 semanas consecutivas

La derivación no bloquea el uso de la app, pero queda registrada en memoria.

### RS03 — Sin diagnóstico médico
El sistema nunca diagnostica condiciones de salud. Solo reporta patrones y sugiere consultar a un profesional cuando corresponde.

```
❌ MAL: "Tu estancamiento puede deberse a hipotiroidismo"
✅ BIEN: "Tu progreso ha estado por debajo de lo esperado durante 3 semanas. Te recomendamos consultar con un médico para descartar factores externos."
```

### RS04 — Sin restricciones extremas
El sistema nunca sugiere:
- Ayuno prolongado (> 24 horas) sin supervisión médica declarada
- Dietas de muy bajo contenido calórico (VLCD) sin contexto clínico
- Eliminación completa de grupos alimentarios sin justificación médica

---

## Reglas de Retención y Comunicación

### RR01 — Notificaciones con contexto real
Las notificaciones nunca son genéricas. Siempre referencian datos específicos del usuario.

```
❌ MAL: "¡No olvides registrar tus comidas hoy!"
✅ BIEN: "Llevas 5 días seguidos cumpliendo tu meta. ¡Hoy es el día 6 — ya casi completas tu primera semana perfecta!"
```

### RR02 — Máximo de notificaciones
- Máximo 2 notificaciones por día por usuario
- Mínimo 4 horas entre notificaciones
- Sin notificaciones entre las 22:00 y las 07:00 (hora local del usuario)

### RR03 — Tono sin culpa
El sistema nunca culpa al usuario por no seguir el plan. Siempre reencuadra positivamente.

```
❌ MAL: "No cumpliste tu meta ayer"
✅ BIEN: "Ayer fue un día diferente. Hoy es una nueva oportunidad — tu meta sigue siendo 1,750 kcal."
```

### RR04 — Celebración de hitos
El sistema celebra automáticamente:
- Primera semana completada
- Primer kilo perdido/ganado
- 7 días consecutivos de registro
- 30 días en la app
- Cada 5 kg de progreso hacia el objetivo
- Cuando el usuario alcanza su objetivo

---

## Reglas de Calidad del Plan

### RQ01 — Variedad mínima
El plan semanal no debe repetir la misma comida en la misma franja horaria más de 2 veces por semana.

### RQ02 — Tolerancia de macros
Los planes pueden tener una tolerancia de ±5% en calorías totales y ±10% en macros individuales. Fuera de ese rango, regenerar.

### RQ03 — Respetar restricciones alimentarias
Las restricciones declaradas en el perfil son absolutas. El sistema nunca sugiere un alimento que viole una restricción o alergia declarada.

Si no se puede generar un plan que cumpla los macros respetando las restricciones, el sistema notifica al usuario y sugiere flexibilizar algún criterio.

### RQ04 — Coherencia entre comidas del día
Las comidas de un mismo día deben sumar a los macros objetivo del día. No se generan comidas sueltas sin verificar el balance diario completo.

---

## Reglas de Memoria

### RM01 — Siempre persistir decisiones relevantes
Cada vez que el sistema toma una decisión relevante (ajuste de plan, diagnóstico, cambio de objetivo), se registra en memoria con:
- Fecha
- Motivo
- Datos que lo justificaron
- Agente que tomó la decisión

### RM02 — El historial nunca se borra
Los planes anteriores, registros y diagnósticos nunca se eliminan. Se archivan y se usan para comparativas futuras.

### RM03 — Preferencias inferidas
Si el usuario consume ciertos alimentos con alta frecuencia, el sistema los registra como "alimentos preferidos" en memoria y los prioriza en futuros planes (sin que el usuario lo configure explícitamente).

---

## Manejo de Excepciones

| Situación | Comportamiento del sistema |
|---|---|
| Datos insuficientes para calcular | Solicitar los datos faltantes, no asumir valores |
| Contradicción en datos del usuario | Registrar la contradicción y usar el dato más reciente |
| Objetivo médicamente inseguro | Limitar al rango seguro y notificar al usuario |
| Usuario sin registro en 7+ días | Activar `retention-agent` con contexto de su historial |
| Error en generación de plan | Registrar el error, usar plan anterior hasta resolución |
| Restricción alimentaria muy limitante | Notificar al usuario que necesita flexibilizar o consultar un profesional |
