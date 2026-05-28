# constraints.md — Restricciones del Sistema

> Define los límites absolutos del sistema. Estas restricciones no son configurables ni negociables. Aplican a todos los agentes, skills y flujos. Si una acción viola alguna de estas restricciones, el sistema debe rechazarla, registrarla y notificar al usuario cuando corresponda.

---

## Restricciones de Seguridad del Usuario

### CS01 — Mínimos calóricos absolutos
```
Mujeres adultas:        ≥ 1,200 kcal/día
Hombres adultos:        ≥ 1,500 kcal/día
Embarazadas/lactantes:  ≥ 1,800 kcal/día (y derivar a profesional)
```
**Violación:** El sistema detecta un objetivo calculado por debajo del mínimo → usa el mínimo y notifica al usuario.

### CS02 — Velocidad máxima de pérdida de peso
```
Máximo permitido por el sistema: 0.9 kg/semana (equivale a ~475 kcal/día de déficit)
```
Si el usuario solicita más velocidad, el sistema explica el riesgo y aplica el máximo permitido.

### CS03 — Máximo de déficit calórico en plan
```
Déficit máximo: −500 kcal del TDEE
```
Nunca superar este valor, independientemente del objetivo del usuario.

### CS04 — Máximo de superávit calórico en plan
```
Superávit máximo: +500 kcal del TDEE
```
Más allá de este rango, la ganancia de grasa supera la de músculo.

### CS05 — Usuarios excluidos de planes automáticos
El sistema no genera planes calóricos automáticos para:
- Menores de 18 años → derivar a pediatra/nutricionista
- Embarazadas o en lactancia → derivar a ginecólogo/nutricionista
- Usuarios con IMC < 17.5 → señal de posible trastorno alimentario → derivar a profesional

En estos casos, el sistema puede ofrecer información educativa general pero no un plan personalizado.

---

## Restricciones de Cambios en el Plan

### CP01 — Cooldown entre ajustes de plan
```
Mínimo entre ajustes: 14 días
```
El sistema no ajusta el plan más de una vez cada 2 semanas, salvo situación de alarma médica.

### CP02 — Variación máxima por ajuste
```
Calorías:   ≤ ±200 kcal por ciclo
Proteína:   ≤ ±15 g por ciclo
Número de comidas: ≤ ±1 por ciclo
```

### CP03 — Datos mínimos para ajuste
No se aplica ningún ajuste sin:
- Mínimo 7 días de registros de peso en el período
- Mínimo 7 días de registros de comidas en el período
- Diagnóstico emitido por el `progress-analyst`

### CP04 — Cambios mayores requieren confirmación
Si el ajuste propuesto supera el 10% de las calorías actuales, requiere confirmación explícita del usuario antes de aplicarse.

---

## Restricciones de Comunicación

### CC01 — Límite de notificaciones
```
Máximo por día:          2 notificaciones push
Mínimo entre mensajes:   4 horas
Silencio nocturno:       22:00 – 07:00 (hora local del usuario)
```

### CC02 — Sin mensajes alarmistas
El sistema nunca usa lenguaje que genere ansiedad o culpa. Términos prohibidos en mensajes al usuario:
- "Fallaste", "no cumpliste", "hiciste mal"
- "Peligroso", "alarmante" (salvo alerta médica real)
- "Deberías haber...", "tendrías que..."

### CC03 — Sin promesas de resultados específicos
El sistema nunca garantiza:
- Fechas exactas de alcance de objetivo
- Pérdida/ganancia de kg específicos en tiempo determinado
- Resultados sin adherencia al plan

Siempre usa rangos y proyecciones probabilistas.

### CC04 — Rechazo de recomendaciones
Si el usuario rechaza una recomendación:
- Primera vez: esperar 7 días antes de volver a presentarla
- Segunda vez: archivarla permanentemente en memoria como "rechazada"
- No insistir más de 2 veces en la misma recomendación

---

## Restricciones Dietéticas Absolutas

### CD01 — Alergias son inviolables
Si el usuario declara alergia a un alimento, ese alimento y sus derivados nunca aparecen en ningún plan, sugerencia o alternativa. Sin excepciones.

Alérgenos prioritarios (declarar en onboarding):
- Gluten / trigo
- Lácteos
- Huevo
- Frutos secos (especificar cuáles)
- Mariscos / pescado
- Soya
- Maní/cacahuate

### CD02 — Restricciones religiosas y éticas
Si el usuario declara restricciones dietéticas religiosas o éticas, el sistema las respeta absolutamente:
- Halal
- Kosher
- Vegano (sin ningún producto animal)
- Vegetariano (sin carne ni pescado)
- Sin cerdo
- Sin alcohol (en ingredientes de cocción)

### CD03 — Eliminación de grupos alimentarios
El sistema no elimina grupos alimentarios completos de un plan salvo:
- Restricción declarada por el usuario (ej: vegano)
- Alergia confirmada
- Indicación médica registrada en perfil

No se elimina carbohidratos, grasas o proteínas completos por preferencia sin base.

---

## Restricciones de Datos

### CDa01 — Privacidad de datos sensibles
Los siguientes datos son sensibles y no pueden compartirse entre agentes sin estar en el perfil explícito del usuario:
- Condiciones médicas
- Historial de trastornos alimentarios
- Datos de peso y medidas (solo accesibles con autenticación)

### CDa02 — Sin inferencias médicas
El sistema no puede inferir condiciones médicas a partir de patrones de datos. Solo trabaja con condiciones explícitamente declaradas por el usuario.

### CDa03 — Retención de datos
El historial del usuario se retiene indefinidamente mientras la cuenta esté activa. Si el usuario solicita eliminación de cuenta, se eliminan todos los datos personales en cumplimiento con regulación aplicable (GDPR / ley local).

---

## Restricciones de Contenido

### CCo01 — Sin contenido médico prescriptivo
El sistema no prescribe medicamentos, suplementos específicos con dosis, ni tratamientos médicos. Puede mencionar suplementos comunes (proteína en polvo, creatina) de forma informativa, nunca prescriptiva.

### CCo02 — Sin contenido que promueva trastornos alimentarios
El sistema nunca:
- Promueve restricción extrema como virtud
- Califica alimentos como "malos" o "prohibidos" de forma absoluta
- Genera contenido que glorifique el hambre o el déficit extremo

### CCo03 — Suplementos
El sistema puede mencionar suplementos en contexto educativo. No puede recomendar marcas específicas ni dosificaciones clínicas. Siempre sugiere consultar con un profesional para cualquier suplementación.

---

## Tabla de Restricciones Rápida

| Código | Área | Restricción | Violación → Acción |
|---|---|---|---|
| CS01 | Seguridad | Mínimos calóricos | Usar mínimo + notificar |
| CS02 | Seguridad | Velocidad pérdida peso | Limitar a 0.9 kg/sem |
| CS03 | Seguridad | Déficit máximo | Limitar a −500 kcal |
| CP01 | Plan | Cooldown ajustes | Bloquear ajuste + registrar |
| CP03 | Plan | Datos mínimos | No ajustar + solicitar datos |
| CC01 | Comunicación | Límite notificaciones | Cancelar notificación extra |
| CD01 | Dieta | Alergias | Eliminar alimento del sistema |
| CDa02 | Datos | Sin inferencias médicas | Registrar y no inferir |
| CCo01 | Contenido | Sin prescripción médica | Reescribir como informativo |
