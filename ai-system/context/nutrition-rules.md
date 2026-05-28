# nutrition-rules.md — Reglas y Fórmulas Nutricionales

> Fuente de verdad nutricional del sistema. Todos los agentes y skills deben usar estas fórmulas y rangos. Ningún agente puede inventar reglas nutricionales propias. Referencias basadas en literatura científica validada.

---

## 1. Cálculo del Metabolismo Basal (BMR)

### Fórmula principal: Mifflin-St Jeor (1990)
La más precisa para población general según meta-análisis de Frankenfield et al. (2005).

```
Hombres: BMR = (10 × peso_kg) + (6.25 × altura_cm) − (5 × edad_años) + 5
Mujeres: BMR = (10 × peso_kg) + (6.25 × altura_cm) − (5 × edad_años) − 161
```

### Fórmula alternativa: Harris-Benedict revisada (Roza & Shizgal, 1984)
Usar cuando el usuario tenga masa muscular significativamente alta o baja.

```
Hombres: BMR = 88.362 + (13.397 × peso_kg) + (4.799 × altura_cm) − (5.677 × edad_años)
Mujeres: BMR = 447.593 + (9.247 × peso_kg) + (3.098 × altura_cm) − (4.330 × edad_años)
```

> **Regla del sistema:** Usar Mifflin-St Jeor por defecto. Cambiar a Harris-Benedict solo si el usuario declara ser atleta con > 3 años de entrenamiento consistente.

---

## 2. Gasto Energético Total (TDEE)

```
TDEE = BMR × Factor de Actividad
```

| Nivel de actividad | Descripción | Factor |
|---|---|---|
| Sedentario | Sin ejercicio, trabajo de oficina | × 1.2 |
| Ligeramente activo | Ejercicio ligero 1–3 días/semana | × 1.375 |
| Moderadamente activo | Ejercicio moderado 3–5 días/semana | × 1.55 |
| Muy activo | Ejercicio intenso 6–7 días/semana | × 1.725 |
| Extra activo | Trabajo físico intenso + ejercicio diario | × 1.9 |

> **Regla del sistema:** El factor de actividad solo considera actividad habitual, no el ejercicio del día. Los entrenamientos registrados se calculan por separado y se añaden al TDEE del día correspondiente.

---

## 3. Ajuste Calórico por Objetivo

```
Calorías objetivo = TDEE + Ajuste por objetivo
```

| Objetivo | Ajuste | Ritmo esperado | Notas |
|---|---|---|---|
| Pérdida de peso agresiva | −500 kcal | ~0.5 kg/semana | Solo para IMC > 30 |
| Pérdida de peso moderada | −300 a −400 kcal | ~0.3–0.4 kg/semana | Recomendado general |
| Pérdida de peso suave | −200 kcal | ~0.2 kg/semana | Para últimos 3–5 kg |
| Mantenimiento | 0 kcal | Sin cambio de peso | |
| Ganancia limpia | +200 a +300 kcal | ~0.2–0.3 kg/semana | Minimiza grasa ganada |
| Ganancia estándar | +300 a +500 kcal | ~0.3–0.5 kg/semana | |

---

## 4. Mínimos Calóricos Absolutos (No Negociables)

Estas restricciones son inviolables. El sistema nunca puede generar un plan por debajo de estos valores, independientemente del objetivo del usuario.

| Grupo | Mínimo calórico diario |
|---|---|
| Mujeres adultas | 1,200 kcal |
| Hombres adultos | 1,500 kcal |
| Mujeres embarazadas | 1,800 kcal (derivar a profesional) |
| Menores de 18 años | No generar planes — derivar a profesional |

> Si el cálculo arroja un objetivo menor al mínimo, el sistema debe usar el mínimo y notificar al usuario que el déficit ha sido limitado por seguridad.

---

## 5. Distribución de Macronutrientes

### Por objetivo

#### Pérdida de peso
```
Proteína:  2.0–2.4 g/kg de peso corporal
Grasa:     25–30% de calorías totales
Carbohidratos: resto de calorías
```

#### Mantenimiento
```
Proteína:  1.6–2.0 g/kg de peso corporal
Grasa:     25–35% de calorías totales
Carbohidratos: resto de calorías
```

#### Ganancia muscular
```
Proteína:  1.8–2.2 g/kg de peso corporal
Grasa:     20–30% de calorías totales
Carbohidratos: resto de calorías (prioridad energética)
```

### Conversión a calorías
```
1 g proteína    = 4 kcal
1 g carbohidrato = 4 kcal
1 g grasa       = 9 kcal
```

### Ejemplo de cálculo completo
```
Usuario: Mujer, 70 kg, objetivo pérdida de peso, 1,700 kcal/día

Proteína: 2.2 g × 70 kg = 154 g → 154 × 4 = 616 kcal (36%)
Grasa: 27% de 1700 = 459 kcal → 459 / 9 = 51 g
Carbos: 1700 − 616 − 459 = 625 kcal → 625 / 4 = 156 g

Resultado: 154g proteína / 156g carbos / 51g grasa
```

---

## 6. Fibra Dietética

| Grupo | Recomendación diaria |
|---|---|
| Mujeres adultas | 25 g/día |
| Hombres adultos | 38 g/día |

El sistema debe verificar que los planes generados alcancen el 80% de este objetivo mínimo.

---

## 7. Hidratación

```
Agua mínima diaria = peso_kg × 35 ml
```

| Condición | Ajuste |
|---|---|
| Ejercicio intenso (>60 min) | +500–750 ml |
| Clima cálido | +250–500 ml |
| Dieta alta en proteína | +250 ml adicionales |

> El sistema debe incluir recordatorio de hidratación en el plan diario. No es calculable por el sistema de comidas, se presenta como meta separada.

---

## 8. Velocidad de Progreso Esperada

El sistema debe calibrar las expectativas del usuario con estos rangos. Nunca prometer resultados fuera de estos.

| Objetivo | Ritmo saludable | Señal de alarma |
|---|---|---|
| Pérdida de peso | 0.3–0.8 kg/semana | > 1 kg/semana sostenido |
| Ganancia muscular | 0.2–0.4 kg/semana | > 0.7 kg/semana (probablemente grasa) |
| Recomposición | Peso estable, cambio en medidas | Expectativa de cambio rápido |

---

## 9. Adaptaciones por Condición Especial

> El sistema identifica estas condiciones en onboarding y las registra en memoria. Los agentes deben consultarlas antes de generar cualquier plan.

| Condición | Ajuste requerido | Derivación |
|---|---|---|
| Diabetes tipo 2 | Limitar carbos simples, priorizar índice glucémico bajo | Recomendar supervisión médica |
| Hipotiroidismo | TDEE puede estar sobreestimado, ajustar conservadoramente | Recomendar supervisión médica |
| Embarazo / lactancia | No generar planes de pérdida de peso | Derivar a nutricionista clínico |
| Historial de trastorno alimentario | Modo sin calorías explícitas disponible | Derivar a profesional de salud mental |
| Menores de 18 años | No generar planes calóricos | Derivar a pediatra/nutricionista |
| Vegetariano/vegano | Vigilar proteína completa, B12, hierro, zinc | Ajustar fuentes proteicas |

---

## 10. Interpretación del IMC (referencia, no diagnóstico)

| IMC | Clasificación | Acción del sistema |
|---|---|---|
| < 18.5 | Bajo peso | Alertar, no generar plan de déficit |
| 18.5–24.9 | Peso normal | Plan estándar por objetivo |
| 25.0–29.9 | Sobrepeso | Plan de pérdida moderada |
| 30.0–34.9 | Obesidad grado I | Plan conservador, derivar a profesional |
| ≥ 35.0 | Obesidad grado II+ | Derivar a profesional, plan de soporte |

```
IMC = peso_kg / (altura_m)²
```

> **Importante:** El IMC es una referencia poblacional, no un diagnóstico individual. El sistema lo usa como señal, no como criterio absoluto. Personas con alta masa muscular tendrán IMC elevado sin estar en riesgo.

---

## 11. Referencias Científicas Base

- Mifflin MD et al. (1990). *A new predictive equation for resting energy expenditure in healthy individuals.* American Journal of Clinical Nutrition.
- Frankenfield D et al. (2005). *Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults.* Journal of the American Dietetic Association.
- Phillips SM & Van Loon LJ (2011). *Dietary protein for athletes: From requirements to optimum adaptation.* Journal of Sports Sciences.
- USDA Dietary Guidelines for Americans 2020–2025.
- Institute of Medicine (2005). *Dietary Reference Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids.*
