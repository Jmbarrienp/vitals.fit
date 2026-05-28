# CLAUDE.md — Sistema Multi-Agente Fitness App

> Este archivo define el contexto completo del proyecto para cualquier agente, desarrollador o herramienta que participe en él. Léelo antes de escribir cualquier línea de código, prompt o decisión de arquitectura.

---

## 🧠 Visión del Producto

Una aplicación fitness tipo **Fitia**, pero con inteligencia real. No es una calculadora de calorías con una app encima — es un sistema que actúa como si el usuario tuviera acceso a:

- Un **nutricionista** que conoce su historial completo
- Un **entrenador personal** que adapta el plan a sus resultados
- Un **sistema inteligente** que aprende de sus hábitos y los usa para mejorar sus recomendaciones

El objetivo no es solo calcular bien. Es **retener al usuario** porque siente que el sistema lo conoce.

---

## 🎯 Objetivos del Sistema

| Objetivo | Descripción |
|---|---|
| Nutrición personalizada | Calorías y macros calculados por perfil real del usuario |
| Planes automáticos | Generación y ajuste continuo de planes alimenticios |
| Seguimiento de progreso | Registro diario con análisis de tendencias |
| Recomendaciones inteligentes | Sugerencias basadas en historial, no en reglas genéricas |
| Retención diaria | El usuario vuelve porque siente progreso y personalización |

---

## 🏗️ Arquitectura del Sistema

El sistema está organizado en **6 capas**. Cada capa tiene responsabilidades exclusivas. No se duplica lógica entre capas.

```
┌─────────────────────────────────────────────┐
│              CONTEXTO GLOBAL                │  ← Fuente de verdad
├─────────────────────────────────────────────┤
│              AGENTES                        │  ← Inteligencia especializada
├─────────────────────────────────────────────┤
│              SKILLS                         │  ← Lógica reutilizable
├─────────────────────────────────────────────┤
│              FLUJOS                         │  ← Orquestación entre agentes
├─────────────────────────────────────────────┤
│              MEMORIA                        │  ← Estado persistente del usuario
├─────────────────────────────────────────────┤
│              OUTPUTS                        │  ← Resultados estructurados
└─────────────────────────────────────────────┘
```

---

## 📁 Estructura de Carpetas

```
fitness-ai/
├── context/
│   ├── nutrition-rules.md        # Fórmulas, rangos, referencias científicas
│   ├── user-profiles.md          # Tipos de usuario, arquetipos, casos edge
│   ├── fitness-goals.md          # Pérdida, mantenimiento, ganancia muscular
│   └── product-logic.md          # Reglas de negocio del producto
│
├── agents/
│   ├── nutritionist/
│   │   ├── agent.md              # Rol, inputs, outputs, restricciones
│   │   └── prompts/
│   ├── trainer/
│   ├── progress-analyst/
│   ├── recommendation-engine/
│   ├── onboarding-agent/
│   └── retention-agent/
│
├── skills/
│   ├── calorie-calculation.md    # BMR, TDEE, déficit/superávit
│   ├── macro-distribution.md     # Proteína, carbos, grasa por objetivo
│   ├── meal-generation.md        # Algoritmo de generación de comidas
│   ├── progress-analysis.md      # Análisis de tendencias y ajustes
│   └── adaptive-planning.md      # Replanificación dinámica
│
├── flows/
│   ├── onboarding-flow.md        # Primer uso: datos → cálculo → plan
│   ├── daily-flow.md             # Uso diario: registro → análisis → feedback
│   └── adjustment-flow.md        # Ciclo de ajuste automático del plan
│
├── memory/
│   ├── schema.md                 # Estructura del perfil de usuario en DB
│   ├── user-profile.json         # Template del perfil persistente
│   └── progress-history.json     # Template del historial de progreso
│
└── outputs/
    ├── meal-plan.schema.json      # Schema del plan alimenticio
    ├── recommendation.schema.json # Schema de recomendaciones
    └── progress-report.schema.json
```

---

## 🤖 Agentes del Sistema

Cada agente tiene un rol exclusivo. Ninguno duplica la responsabilidad de otro.

### `nutritionist-agent`

**Rol:** Experto en nutrición. Calcula y ajusta la ingesta calórica y de macronutrientes.

**Inputs:**
- Perfil del usuario (edad, peso, talla, sexo)
- Nivel de actividad física
- Objetivo (perder, mantener, ganar)
- Historial de progreso reciente

**Outputs:**
- Calorías diarias objetivo (TDEE ajustado)
- Distribución de macronutrientes en gramos
- Alertas si la ingesta real se desvía del objetivo

**Restricciones:**
- Nunca genera planes de comidas (eso es `meal-generation` skill)
- Nunca define estrategias de entrenamiento
- Siempre usa fórmulas validadas (Harris-Benedict, Mifflin-St Jeor)

---

### `trainer-agent`

**Rol:** Define la estrategia fitness complementaria a la nutrición.

**Inputs:**
- Objetivo del usuario
- Nivel de condición física declarado
- Disponibilidad semanal (días/horas)
- Output del `nutritionist-agent`

**Outputs:**
- Distribución de entrenamientos semanales
- Tipo de actividad recomendada por objetivo
- Calorías estimadas quemadas por entrenamiento

**Restricciones:**
- No genera planes nutricionales
- Trabaja siempre en coherencia con el déficit/superávit calculado por `nutritionist-agent`

---

### `progress-analyst`

**Rol:** Analiza los datos reales del usuario y detecta si el plan está funcionando.

**Inputs:**
- Historial de peso registrado (últimas 4 semanas mínimo)
- Adherencia al plan (% días cumplidos)
- Ingesta calórica real vs objetivo
- Logs de entrenamiento

**Outputs:**
- Diagnóstico del progreso (en ruta / estancado / regresión)
- Causa probable del desvío (adherencia / calorías / agua / ciclo hormonal)
- Recomendación de ajuste al plan

**Restricciones:**
- No aplica el ajuste directamente (eso lo hace `recommendation-engine`)
- Requiere mínimo 7 días de datos para emitir diagnóstico

---

### `recommendation-engine`

**Rol:** Personaliza decisiones futuras basándose en el historial y preferencias del usuario.

**Inputs:**
- Output del `progress-analyst`
- Memoria del usuario (preferencias, restricciones, historial de planes)
- Contexto temporal (semana del plan, estación, eventos próximos)

**Outputs:**
- Ajuste calórico recomendado
- Cambios sugeridos en el plan de comidas
- Mensajes motivacionales personalizados

**Restricciones:**
- Nunca hace cambios drásticos sin justificación del `progress-analyst`
- Respeta restricciones alimentarias registradas en memoria

---

### `onboarding-agent`

**Rol:** Gestiona el primer contacto con el usuario y construye su perfil inicial.

**Inputs:**
- Respuestas del formulario de bienvenida
- Objetivos declarados
- Restricciones alimentarias y médicas

**Outputs:**
- Perfil inicial del usuario (guardado en memoria)
- Primera versión del plan nutricional
- Trigger para `nutritionist-agent` y `meal-generation` skill

**Restricciones:**
- Solo actúa en el primer uso o cuando el usuario resetea su perfil
- No modifica el plan una vez generado (eso es del `recommendation-engine`)

---

### `retention-agent` ⭐

**Rol:** El agente más crítico para el negocio. Maximiza la adherencia diaria del usuario.

> Este agente es co-igual al `nutritionist-agent` en importancia. La mayoría de apps fitness mueren no por mal cálculo, sino por abandono en semana 2.

**Inputs:**
- Días consecutivos sin abrir la app
- Última acción del usuario
- Hitos alcanzados y pendientes
- Horario habitual del usuario (inferido de memoria)

**Outputs:**
- Notificaciones personalizadas (no genéricas)
- Ajuste de dificultad del plan si hay señales de abandono
- Celebraciones de progreso en momentos estratégicos
- Reportes semanales de evolución

**Restricciones:**
- Nunca envía más de 2 notificaciones por día
- Las notificaciones deben referenciar datos reales del usuario, nunca mensajes genéricos

---

## 🛠️ Skills del Sistema

Las skills son lógica reutilizable que los agentes invocan. Ningún agente inventa lógica propia.

### `calorie-calculation`
```
Fórmula base: Mifflin-St Jeor
  Hombres: (10 × peso kg) + (6.25 × talla cm) − (5 × edad) + 5
  Mujeres: (10 × peso kg) + (6.25 × talla cm) − (5 × edad) − 161

Multiplicadores TDEE:
  Sedentario:          × 1.2
  Ligeramente activo:  × 1.375
  Moderadamente activo:× 1.55
  Muy activo:          × 1.725
  Extra activo:        × 1.9

Ajuste por objetivo:
  Pérdida de peso:    TDEE − 300 a 500 kcal
  Mantenimiento:      TDEE
  Ganancia muscular:  TDEE + 200 a 300 kcal
```

### `macro-distribution`
```
Pérdida de peso:
  Proteína:  2.0–2.4 g/kg peso corporal
  Grasa:     25–30% de calorías totales
  Carbos:    Resto de calorías

Mantenimiento:
  Proteína:  1.6–2.0 g/kg
  Grasa:     25–35%
  Carbos:    Resto

Ganancia muscular:
  Proteína:  1.8–2.2 g/kg
  Grasa:     20–30%
  Carbos:    Resto (prioridad energética)
```

### `meal-generation`
- Usa base de datos USDA / Open Food Facts
- Genera combinaciones que cumplan los macros objetivo (±5% tolerancia)
- Respeta restricciones: vegetariano, vegano, sin gluten, alergias
- Ofrece sustitutos cuando un alimento no está disponible
- Evita repetir las mismas comidas más de 2 veces por semana

### `progress-analysis`
- Requiere mínimo 7 registros de peso para calcular tendencia
- Usa regresión lineal simple para proyectar progreso a 4 semanas
- Detecta estancamiento si el peso no varía ±0.3 kg en 2 semanas
- Considera ciclo menstrual en usuarios que lo registran

### `adaptive-planning`
- Ajusta el plan cada 2 semanas basado en progreso real
- Cambios máximos permitidos por ciclo: ±200 kcal, ±10g proteína
- Requiere aprobación del usuario para cambios mayores al 15%

---

## 🔄 Flujos del Sistema

### Flujo de Onboarding
```
Usuario ingresa datos
        ↓
onboarding-agent recopila perfil
        ↓
nutritionist-agent calcula TDEE + macros
        ↓
meal-generation skill genera plan semana 1
        ↓
Plan guardado en memoria
        ↓
retention-agent configura notificaciones iniciales
```

### Flujo Diario
```
Usuario registra comidas / peso
        ↓
progress-analyst evalúa datos del día
        ↓
recommendation-engine decide si hay feedback inmediato
        ↓
retention-agent decide si enviar notificación
```

### Flujo de Ajuste (cada 2 semanas)
```
progress-analyst genera diagnóstico
        ↓
recommendation-engine propone ajustes
        ↓
nutritionist-agent valida coherencia nutricional
        ↓
meal-generation actualiza el plan
        ↓
Nuevas versión guardada en memoria con diff
```

---

## 🧠 Esquema de Memoria

La memoria es el componente más crítico. Sin ella, los agentes son calculadoras genéricas.

```json
{
  "user_id": "uuid",
  "profile": {
    "name": "string",
    "age": "number",
    "weight_kg": "number",
    "height_cm": "number",
    "sex": "male | female | other",
    "activity_level": "sedentary | light | moderate | active | extra",
    "goal": "lose | maintain | gain",
    "dietary_restrictions": ["vegetarian", "gluten_free", "..."],
    "allergies": ["string"]
  },
  "targets": {
    "calories_daily": "number",
    "protein_g": "number",
    "carbs_g": "number",
    "fat_g": "number"
  },
  "current_plan": {
    "version": "number",
    "created_at": "date",
    "meals": [...]
  },
  "progress": {
    "weight_log": [
      { "date": "date", "weight_kg": "number" }
    ],
    "adherence_log": [
      { "date": "date", "calories_logged": "number", "plan_followed": "boolean" }
    ]
  },
  "habits": {
    "typical_meal_times": ["07:00", "13:00", "19:00"],
    "app_usage_pattern": "morning | evening | irregular",
    "preferred_foods": ["string"],
    "disliked_foods": ["string"]
  },
  "plan_history": [
    {
      "version": "number",
      "active_from": "date",
      "active_to": "date",
      "reason_for_change": "string"
    }
  ]
}
```

---

## 🚀 Equipo de Desarrollo

| Rol | Responsabilidades | Stack |
|---|---|---|
| **Tech Lead** | Arquitectura de agentes, diseño de sistema, revisión de código | Python / FastAPI / LangChain o similar |
| **Backend Developer** | APIs REST, base de datos, lógica de negocio, autenticación | Node.js o Python, PostgreSQL, Redis |
| **Mobile Developer** | App iOS/Android, UX de retención, notificaciones push | React Native o Flutter |
| **Nutrition Data Engineer** | Base de datos de alimentos, normalización USDA/Open Food Facts, algoritmos de matching | Python, SQL, data pipelines |

> El equipo mínimo viable es 4 personas. El Nutrition Data Engineer **no es opcional** — sin datos de alimentos limpios y normalizados, los agentes no funcionan correctamente.

---

## 📅 Fases del Proyecto

### Fase 1 — MVP (semanas 1–8)
- [ ] Esquema de base de datos y memoria
- [ ] `nutritionist-agent`: cálculo de TDEE y macros
- [ ] `onboarding-agent`: recolección de perfil inicial
- [ ] `meal-generation` skill: plan básico de 7 días
- [ ] Pantallas: onboarding, dashboard, registro de comidas

### Fase 2 — Core Inteligente (semanas 9–16)
- [ ] `progress-analyst`: análisis de tendencias
- [ ] `recommendation-engine`: ajustes automáticos
- [ ] `adaptive-planning` skill: replanificación cada 2 semanas
- [ ] Pantallas: historial, progreso gráfico, ajuste del plan

### Fase 3 — Retención y Escala (semana 17 en adelante)
- [ ] `retention-agent`: notificaciones personalizadas, hitos
- [ ] `trainer-agent`: integración de actividad física
- [ ] Sistema de memoria avanzado: preferencias inferidas
- [ ] Pantallas: retos, logros, reportes semanales

---

## ⚙️ Principios de Funcionamiento

1. **Cada agente actúa solo dentro de su rol.** Si un agente necesita información de otro dominio, la solicita — no la calcula.
2. **No duplicar responsabilidades.** Un solo agente posee cada decisión.
3. **El contexto global es la fuente de verdad.** Ningún agente inventa reglas nutricionales.
4. **Las decisiones se basan en datos del usuario,** no en valores por defecto genéricos.
5. **La memoria es obligatoria.** Ningún agente responde sin leer el historial relevante primero.
6. **Outputs siempre estructurados.** JSON con schema definido, nunca texto libre como output de agente.
7. **Cambios incrementales.** El sistema no cambia planes drásticamente — los ajusta con justificación.

---

## 📊 Métricas de Éxito del Producto

| Métrica | Target MVP | Target 6 meses |
|---|---|---|
| Retención día 7 | > 40% | > 55% |
| Retención día 30 | > 20% | > 35% |
| Adherencia diaria al plan | > 50% | > 65% |
| Precisión calórica (±10%) | 100% | 100% |
| Tiempo de onboarding | < 3 min | < 2 min |

---

## 🗣️ Instrucción para Agentes

> Antes de responder cualquier solicitud dentro de este sistema:
>
> 1. **Identifica tu rol** — ¿cuál de los 6 agentes eres?
> 2. **Lee el contexto global** — ¿qué reglas aplican a esta situación?
> 3. **Consulta la memoria del usuario** — ¿qué sabes de su historial?
> 4. **Aplica las skills necesarias** — no inventes lógica, usa las skills definidas
> 5. **Genera un output estructurado** — JSON o formato definido en `outputs/`
> 6. **Registra lo relevante en memoria** — si tomaste una decisión importante, persístela
>
> **Nunca respondas de forma genérica. Siempre actúa como un sistema experto que conoce a este usuario específico.**

---

*Última actualización: Mayo 2026 — v1.0*