# Vitals Fit — Diseño Definitivo del Módulo de Nutrición

> Auditoría + arquitectura lista para implementación.
> Fecha: 2026-06-09 · Autor: equipo producto/arquitectura
> Basado en lectura directa del código (`app/backend`, `app/mobile`).

---

## 1. Executive Summary

Vitals Fit tiene una **base de cálculo metabólico sólida** (Mifflin-St Jeor, macros por g/kg, plan history versionado) y una **arquitectura de eventos limpia** (`meal.logged` → recomendaciones + push). Eso es el 20% difícil y ya está bien hecho.

Pero el **módulo de nutrición operativo —el que el usuario toca 4 veces al día— está en estado de prototipo**, no de producto:

- La base de alimentos tiene **~30 ítems**. Fitia tiene cientos de miles.
- El registro de comidas **no persiste ítems individuales** (`LoggedMealItem` está muerto), por lo que es imposible editar, reanalizar o aprender de lo que el usuario comió.
- **No hay forma de borrar o editar** una comida mal registrada.
- Solo existe **un método de registro** (búsqueda manual por texto), el más lento de todos.
- **No se trackea fibra ni agua** pese a tener metas para ambos.

**La tesis de este documento:** no necesitas competir con Fitia en tamaño de base de datos —esa guerra ya está perdida y no importa. Necesitas ganar en **velocidad de registro** (el único KPI que predice retención en apps de nutrición) y en **inteligencia del nutricionista IA** (donde tienes ventaja real porque ya tienes la infraestructura de agentes). El registro por foto/voz/texto-libre con IA no es un "nice to have": es tu **única ruta defendible** frente a apps con 10 años de ventaja en datos.

**Recomendación de una línea:** arregla los cimientos rotos (items, edición, base de datos real vía Open Food Facts), luego apuesta todo a **registro multimodal con IA** como diferenciador, no a más campos en un formulario.

---

## 2. Gap Analysis: actual vs. objetivo

| Capacidad | Estado actual (código real) | App líder | Severidad |
|---|---|---|---|
| **Tamaño base de alimentos** | ~30 alimentos seed | 100k–1M+ | 🔴 Crítico |
| **Fuente de datos** | Solo `LocalFoodAdapter`, substring search | USDA + Open Food Facts + comunidad | 🔴 Crítico |
| **Granularidad de registro** | Solo totales en `LoggedMeal`; `LoggedMealItem` nunca se escribe | Item-level con cantidades | 🔴 Crítico |
| **Editar/borrar comida** | No existe endpoint | Estándar | 🔴 Crítico |
| **Escaneo de barras** | Campo `barcode` + índice, sin endpoint ni UI | Estándar | 🔴 Crítico |
| **Porciones** | Solo gramos (50/100/150/200) | Unidades caseras (1 taza, 1 rebanada, 1 huevo) | 🟠 Alto |
| **Registro por foto IA** | No existe | Diferenciador emergente | 🟠 Alto (oportunidad) |
| **Registro por voz/texto libre** | No existe | Diferenciador emergente | 🟠 Alto (oportunidad) |
| **Fibra / agua tracking** | Metas existen, sin columnas de log | Estándar | 🟠 Alto |
| **Favoritos / frecuentes / recientes** | `UserHabits.preferredFoods` sin usar; search ordena por `isCommon` | Estándar | 🟠 Alto |
| **Recetas / comidas compuestas** | No existe | Estándar | 🟡 Medio |
| **Alimento creado por usuario** | Solo modo "manual" efímero (no se guarda como FoodItem) | Estándar | 🟡 Medio |
| **Adherencia calculada** | `adherencePct`/`planFollowed` nunca se setean | Núcleo del coaching | 🟠 Alto |
| **Nutricionista IA** | Rules engine reactivo (`meal.logged`) | Diferenciador | 🟢 Ventaja a explotar |
| **Cálculo metabólico** | Mifflin-St Jeor correcto, plan history | Paridad | ✅ Listo |
| **Macros adaptativos** | Déficit fijo -350 kcal | % de TDEE + ajuste por progreso | 🟡 Medio |

**Lectura del gap:** los 4 rojos de arriba son **deuda de cimientos**, no features. Hasta que se arreglen, todo lo demás se construye sobre arena. La buena noticia: son acotados y de complejidad media.

---

## 3. Funcionalidades priorizadas (clasificación brutal)

### ✅ MUST HAVE (paridad — sin esto no eres competitivo)
1. **Base de alimentos real** (50k+) vía import de Open Food Facts + USDA FDC.
2. **Registro a nivel de ítem** (`LoggedMealItem` vivo) — habilita todo lo demás.
3. **Editar y borrar** comidas e ítems.
4. **Escaneo de código de barras** (es el registro más rápido que existe para productos empaquetados).
5. **Unidades caseras** ("1 huevo", "1 taza de arroz") con `ServingSize`.
6. **Favoritos + recientes + frecuentes** (el 80% de lo que alguien come son ~50 alimentos).
7. **Búsqueda decente**: full-text de Postgres + unaccent + trigram (fuzzy). El `contains` actual es inaceptable.
8. **Agua y fibra tracking** (cierra metas ya prometidas).

### 🚀 SHOULD HAVE (ventaja competitiva real)
9. **Registro por texto libre con IA** ("comí 4 huevos y una arepa") → parsing a ítems. **Tu mayor ROI.**
10. **Registro por voz** (= texto libre + transcripción; reutiliza el mismo parser).
11. **Registro por foto con IA** (Claude vision) con estimación de porción y `confidence`.
12. **Nutricionista IA proactivo**: detección de déficit de proteína, exceso calórico, inconsistencia, baja adherencia, con priorización por impacto.
13. **Adherencia calculada** automáticamente por día/semana.
14. **Quick-add desde plan**: "registrar la comida que el plan sugería" en 1 tap.

### 🟡 NICE TO HAVE (cuando todo lo anterior esté pulido)
15. Recetas personalizadas (comidas compuestas guardables).
16. Objetivos adaptativos automáticos (ajuste de calorías por tendencia de peso).
17. Macros por comida (no solo diarios).
18. Copiar día anterior / plantillas de día.
19. Integración con HealthKit/Google Fit (calorías quemadas → ajuste dinámico).

### 🗑️ WASTE OF TIME (descartar explícitamente)
- **Conteo de micronutrientes completo (vitaminas A/B/C/D, minerales traza).** El 99% de usuarios no lo mira, los datos de OFF son incompletos y ruidosos, y duplica el tamaño del schema. Trackea solo: kcal, P, C, G, **fibra, azúcar, sodio, agua**. Punto.
- **"Nutri-Score" / sistemas de puntaje de salud propietarios.** Engagement teatro; no cambia comportamiento.
- **Base de datos de restaurantes/menús.** Mantenimiento infinito, cobertura regional pésima en LATAM. El registro por foto/texto lo resuelve mejor.
- **Códigos de barras como feature aislada de "escanear y guardar producto en despensa/inventario".** Sobreingeniería; nadie gestiona inventario en una app de fitness.
- **Gamificación pesada (insignias, niveles, monedas).** Ya tienes `UserMilestone` y streaks; eso basta. No construyas una economía de puntos.
- **Editor de recetas con cálculo de "rendimiento por cocción" (pérdida de agua al cocinar).** Precisión falsa; complejidad enorme; cero impacto en retención.

---

## 4. Diseño UX detallado

### Principio rector
> **Registrar una comida no debería tomar más de 5 segundos para el caso común.**
> El caso común = algo que ya comiste antes. Optimiza para eso, no para el alimento nuevo y exótico.

### 4.1 La pantalla de registro rediseñada

El `log.tsx` actual obliga a: elegir tipo de comida → elegir modo → escribir → buscar → seleccionar → elegir porción → guardar. **7 decisiones para registrar un huevo.** Rediseño:

```
┌─────────────────────────────────────┐
│  Registrar                    [×]    │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ 🔍  ¿Qué comiste?               │ │  ← un solo campo, foco inmediato
│  └─────────────────────────────────┘ │
│                                      │
│  [ 📷 Foto ] [ 🎤 Voz ] [ |||| Barras ]│  ← métodos rápidos, siempre visibles
│                                      │
│  ── Recientes ──────────────────────│
│  🥚 Huevo (2 u)            156 kcal +│  ← 1 tap = registrado
│  🍞 Arepa (1 u)            180 kcal +│
│  🍗 Pechuga pollo (150g)   248 kcal +│
│                                      │
│  ── Favoritos ⭐ ────────────────────│
│  🥤 Batido proteína        120 kcal +│
└─────────────────────────────────────┘
```

**Decisiones de diseño:**
- **El tipo de comida se infiere por la hora** (07:00→desayuno, 13:00→almuerzo), con override de 1 tap. No preguntes lo que puedes adivinar. Usa `UserHabits.typicalMealTimes`.
- **Recientes y favoritos primero, antes de buscar.** El campo de búsqueda es el plan B, no el A.
- **Los métodos IA (foto/voz/barras) son chips siempre visibles**, no escondidos tras un toggle "manual".
- **El "+" registra con la última porción usada de ese alimento.** Si comes 2 huevos siempre, registra 2 huevos. Tap largo → ajustar cantidad.

### 4.2 Flujo por persona

| Persona | Camino optimizado |
|---|---|
| **Principiante absoluto / adulto mayor** | Foto o voz. "Saca una foto de tu plato" o "dime qué comiste". Cero conocimiento nutricional requerido. La IA hace el trabajo. |
| **Sin experiencia en nutrición** | Recientes + favoritos. No tiene que entender gramos; usa "1 porción", "1 plato". |
| **Usuario avanzado** | Búsqueda + barras + edición de macros. Quiere precisión y control; déjalo editar gramos y ver desglose. |

**Regla de oro de accesibilidad (adulto mayor):** todo flujo crítico debe completarse **sin teclear**. Foto y voz cumplen esto; por eso son must-have de UX, no lujos.

### 4.3 Edición (hoy imposible)
- Tap en una comida del dashboard → editar cantidad / borrar ítem / borrar comida.
- Swipe-to-delete en la lista de comidas del día.
- Esto **requiere** `LoggedMealItem` vivo (sección 5).

---

## 5. Diseño técnico

### 5.1 Arreglar el registro a nivel de ítem (cimiento #1)

**Problema actual:** [logs.service.ts](app/backend/src/logs/logs.service.ts) recibe totales ya calculados del cliente y nunca crea `LoggedMealItem`. Esto:
- Impide editar/reanalizar.
- Confía cálculos al cliente (inconsistencia y manipulación).
- Hace imposible que el nutricionista IA sepa *qué* comió el usuario, solo *cuánto*.

**Nuevo contrato `POST /logs/meal`:**
```ts
// El cliente manda ítems + cantidades. El SERVIDOR calcula macros.
{
  mealType?: "BREAKFAST" | ...,   // opcional → se infiere por hora
  loggedAt?: ISODate,
  source: "search" | "barcode" | "photo" | "voice" | "text" | "manual" | "favorite",
  items: [
    { foodItemId: "uuid", quantity: 2, unit: "unit" },   // 2 huevos
    { foodItemId: "uuid", quantity: 150, unit: "g" },
    // manual one-off (sin foodItemId):
    { customName: "Postre", calories: 200, proteinG: 3, carbsG: 30, fatG: 8 }
  ],
  aiAnalysisId?: "uuid"  // si vino de foto/voz/texto, enlaza la predicción
}
```
El servicio resuelve cada `foodItemId`, convierte unidad→gramos vía `ServingSize`, calcula macros **en backend**, crea `LoggedMeal` + N `LoggedMealItem`, recalcula `DailyLog`, recalcula `adherencePct`, y emite `meal.logged`. Una transacción Prisma.

### 5.2 Base de alimentos real

- **Adapter pattern ya existe** (`FoodAdapter` interface) — bien pensado. Añadir:
  - `OpenFoodFactsAdapter` (online, para barcode lookup en tiempo real con cache).
  - **Import batch USDA FDC + OFF LATAM** a `FoodItem` local (no llamar APIs externas en cada búsqueda).
- **Estrategia:** local-first. Buscar en DB local (rápido, offline-capaz). Para barcode no encontrado localmente → fallback a OFF API → cachear el resultado como `FoodItem` nuevo (`source="open_food_facts"`, `isVerified=false`).
- **Búsqueda:** reemplazar `contains` por Postgres full-text con `unaccent` + `pg_trgm` (fuzzy). Ranking: `isCommon` > favoritos del usuario > frecuentes del usuario > verificados > resto.

### 5.3 Registro por texto libre / voz (mayor ROI)

```
"comí 4 huevos y una arepa"
        │
        ▼
POST /logs/parse   { text }
        │
        ▼
Claude Haiku (rápido/barato) con tool-use estructurado:
  → [{ name:"huevo", qty:4, unit:"unit", confidence:0.95 },
     { name:"arepa", qty:1, unit:"unit", confidence:0.88 }]
        │
        ▼
Resolver cada nombre contra FoodItem (fuzzy match)
        │
        ▼
Devolver propuesta editable al usuario (NO auto-guardar)
        │
        ▼ usuario confirma/ajusta
POST /logs/meal (items resueltos, source="text")
```

- **Voz = transcripción (expo-speech / Whisper) → mismo endpoint `/logs/parse`.** No es un sistema aparte.
- **Clave UX:** la IA *propone*, el usuario *confirma*. Nunca auto-guardar una estimación. Genera confianza y corrige errores.

### 5.4 Registro por foto (ver sección dedicada, 5.6)

### 5.5 Adherencia automática

Tras cada `meal.logged`, calcular en `DailyLog`:
```
adherencePct = 1 - clamp(|caloriesLogged - target| / target, 0, 1)
planFollowed = adherencePct >= 0.85 && proteinG >= 0.9 * proteinTarget
```
Esto desbloquea al `progress-analyst` que hoy no tiene el dato pese a depender de él.

### 5.6 Nutricionista IA proactivo

Hoy el rules engine reacciona a `meal.logged`. Elevarlo a **análisis diario agregado** (cron nocturno + reactivo):

| Detección | Regla concreta | Recomendación |
|---|---|---|
| **Déficit proteína** | `protein7dAvg < 0.8 * target` por 3+ días | "Te faltan ~30g de proteína al día. Agrega [fuente local]." HIGH |
| **Exceso calórico** | `cal7dAvg > target * 1.1` | "Vas +250 kcal/día sobre tu meta esta semana." HIGH |
| **Inconsistencia** | `stdDev(cal últimos 7d) > 0.4 * mean` | "Tus días varían mucho; intenta consistencia." MEDIUM |
| **Baja adherencia** | `díasLogueados < 4 en 7` | retención, no nutrición → handoff a retention-agent | 
| **Fibra baja** | `fiber7dAvg < 0.6 * target` | "Sube fibra: avena, frijoles, fruta." LOW |

**Priorización por impacto:** ordenar por (severidad × proximidad al objetivo del usuario). Un déficit de proteína para alguien en `GAIN_MUSCLE` es HIGH; para `HEALTH_WELLNESS` es MEDIUM. Reusa el campo `Priority` y `macroAdjustments` que ya existen en `Recommendation`.

**Con `ANTHROPIC_API_KEY`:** Claude redacta el mensaje (cálido, datos reales del usuario). Sin la key: rules engine con plantillas. La infraestructura ya soporta ambos.

---

## 6. Sistema de análisis de comida por foto (diseño completo)

### 6.1 Flujo UX
```
1. Usuario toca 📷 → cámara (o galería)
2. Foto → preview con overlay "Analizando tu plato..."  (~2-4s)
3. IA devuelve ítems detectados:
   ┌──────────────────────────────┐
   │ Detectamos:                  │
   │ ✓ Arroz blanco    ~200g  ▓░░ │  ← barra = confianza
   │ ✓ Pollo a la plancha ~150g ▓▓░│
   │ ? Ensalada        ~80g   ▓░░ │  ← baja confianza, resaltada
   │                              │
   │ [+ Agregar algo]             │
   │ Total estimado: ~520 kcal    │
   │ [ Ajustar ]   [ Confirmar ]  │
   └──────────────────────────────┘
4. Usuario ajusta cantidades/ítems si quiere → Confirmar
5. POST /logs/meal con source="photo", aiAnalysisId
```

### 6.2 Qué detecta la IA
- Ítems de comida (clasificación), por foto, usando **Claude vision** (un solo modelo, sin pipeline de visión propio).
- Por ítem: nombre, porción estimada (en gramos y/o unidades caseras), `confidence` 0–1.
- Pista de contexto: hora del día, plato típico de la región del usuario (`profile.country`).

### 6.3 Estimación de porción (lo difícil)
- **V1 (honesto):** estimación gruesa por categoría visual ("plato estándar de arroz ≈ 150–250g"), siempre presentada como **rango editable**, nunca como verdad exacta.
- **No prometas precisión que no tienes.** El usuario perdona "~200g, ajústalo" pero no perdona "200g" que estaba mal y arruinó su día.
- **V2 (opcional):** referencia de escala (moneda/mano en foto) o fork detection. Solo si los datos muestran que la gente lo usa.

### 6.4 Estimación de calorías
- `porción_estimada_g × macros_del_FoodItem_resuelto`. La IA da nombre+porción; los **macros salen de tu base de datos**, no de la alucinación del modelo. Esto ancla la precisión.

### 6.5 Manejo de errores
- **Foto no es comida** → "No detectamos comida. ¿Reintentar o registrar manualmente?"
- **Timeout / API caída** → fallback inmediato a búsqueda manual, sin bloquear. Log en `AiGenerationLog` (ya existe).
- **Baja confianza global** → no auto-confirmar; forzar revisión del usuario.

### 6.6 Almacenamiento de confianza
Nueva entidad `FoodAnalysis` (sección 7): guarda foto URL, ítems detectados como JSON, `confidence` por ítem, modelo usado, y si el usuario **corrigió** (señal de oro para evaluar/mejorar). Enlazada a `LoggedMeal` vía `aiAnalysisId`.

### 6.7 Qué implementar primero
- **Primero:** texto libre + voz (sección 5.3). Misma IA de parsing, **sin** el problema de visión/porción, 10x más fácil, cubre el 70% del valor. Voz especialmente para adultos mayores.
- **Después:** foto. Es el "wow" de marketing pero el más caro en precisión y soporte. Lánzalo cuando el parser de texto ya esté pulido y reuses su resolución de ítems.

---

## 7. Esquema de base de datos (cambios Prisma)

### 7.1 Extender `FoodItem`
```prisma
model FoodItem {
  // ... campos existentes ...
  sugarPer100g    Float?   // trackear azúcar (no micros completos)
  servingSizes    ServingSize[]
  createdByUserId String?  // alimentos creados por usuario
  brand           String?  // marca comercial
  @@index([nameLower])
  // NUEVO: full-text. Migración SQL: CREATE INDEX ... USING GIN (to_tsvector(...))
}
```

### 7.2 Nueva: `ServingSize` (unidades caseras — desbloquea UX)
```prisma
model ServingSize {
  id          String   @id @default(uuid())
  foodItemId  String
  label       String   // "1 huevo", "1 taza", "1 rebanada", "1 arepa"
  grams       Float    // 1 huevo = 50g
  isDefault   Boolean  @default(false)
  foodItem    FoodItem @relation(fields: [foodItemId], references: [id], onDelete: Cascade)
  @@index([foodItemId])
}
```

### 7.3 Revivir `LoggedMealItem` con cantidad/unidad
```prisma
model LoggedMealItem {
  // ... campos existentes ...
  quantity    Float    @default(1)      // NUEVO: 2 (huevos), 150 (g)
  unit        String   @default("g")    // NUEVO: "g" | "unit" | "cup" | ...
  customName  String?                   // NUEVO: ítem manual sin foodItem
  foodItemId  String?                   // ahora opcional (manual one-off)
}
```

### 7.4 Extender `DailyLog` (cerrar metas prometidas)
```prisma
model DailyLog {
  // ... campos existentes ...
  fiberG    Float @default(0)   // NUEVO
  sugarG    Float @default(0)   // NUEVO
  sodiumMg  Float @default(0)   // NUEVO
  waterMl   Int   @default(0)   // NUEVO
}
```

### 7.5 Nueva: `UserFavoriteFood`
```prisma
model UserFavoriteFood {
  id         String   @id @default(uuid())
  userId     String
  foodItemId String
  createdAt  DateTime @default(now())
  @@unique([userId, foodItemId])
  @@index([userId])
}
```
(Frecuentes se derivan por query agregada sobre `LoggedMealItem`, no necesitan tabla.)

### 7.6 Nueva: `FoodAnalysis` (IA: foto/voz/texto)
```prisma
model FoodAnalysis {
  id            String   @id @default(uuid())
  userId        String
  source        String   // "photo" | "voice" | "text"
  inputRef      String?  // storageUrl de foto, o texto crudo
  model         String   // "claude-haiku-4-5" / vision
  detectedItems Json     // [{ name, qty, unit, grams, confidence, resolvedFoodItemId }]
  overallConfidence Float
  userCorrected Boolean  @default(false)  // señal de calidad
  latencyMs     Int
  createdAt     DateTime @default(now())
  @@index([userId, createdAt])
}
```

### 7.7 Recetas (Fase 4, no antes)
```prisma
model Recipe {
  id         String   @id @default(uuid())
  userId     String
  name       String
  servings   Int      @default(1)
  items      RecipeItem[]   // misma forma que PlannedMealItem
  // macros se calculan, no se almacenan duplicados
}
```

**Índices clave:** GIN full-text en `FoodItem`, `pg_trgm` en `nameLower`, `barcode` (ya existe), `LoggedMealItem(foodItemId)` para "frecuentes", `FoodAnalysis(userId, createdAt)`.

---

## 8. Endpoints requeridos

### Existentes a modificar
```
POST   /api/logs/meal          → recibe items[]+unidades; backend calcula macros
GET    /api/food/search        → full-text + fuzzy, ranking personalizado
```

### Nuevos — Fase 1 (cimientos)
```
PATCH  /api/logs/meal/:id            editar comida (cantidades, items)
DELETE /api/logs/meal/:id            borrar comida
DELETE /api/logs/meal/:id/item/:itemId   borrar ítem
GET    /api/food/barcode/:code       lookup local → fallback OFF → cache
GET    /api/food/recent              últimos N alimentos del usuario
GET    /api/food/frequent            top alimentos por frecuencia (agregado)
GET    /api/food/favorites           favoritos
POST   /api/food/favorites/:id       marcar favorito
DELETE /api/food/favorites/:id       quitar favorito
POST   /api/food                     crear alimento de usuario (custom)
POST   /api/logs/water               registrar agua
GET    /api/logs/day/:date           día específico (no solo "today")
```

### Nuevos — Fase 2/3 (inteligencia)
```
POST   /api/logs/parse               texto/voz → items propuestos (IA)
POST   /api/logs/photo               foto → FoodAnalysis (IA vision)
GET    /api/nutrition/insights       análisis del nutricionista IA (déficits, patrones)
GET    /api/nutrition/adherence      adherencia diaria/semanal calculada
```

### Nuevos — Fase 4
```
POST   /api/recipes                  CRUD recetas
GET    /api/recipes
POST   /api/logs/copy-day            copiar día anterior
POST   /api/nutrition/auto-adjust    objetivos adaptativos (o vía cron)
```

---

## 9. Objetivos adaptativos (reglas concretas)

Cron quincenal + trigger en `weight.updated` (ya parcialmente existe en el handler). Reglas:

```
Sea rate = tendencia de peso (kg/semana, regresión lineal sobre 14+ días)
Sea adh  = adherencia media 14 días

GUARD: solo ajustar si adh >= 0.8 (sin adherencia, el plan no es el problema)

LOSE_FAT:
  rate > -0.2 kg/sem (estancado)  → calorías -= 150 (máx -2 ajustes/mes)
  rate < -0.9 kg/sem (muy rápido) → calorías += 150 (proteger masa magra)
  -0.7 ≤ rate ≤ -0.3              → mantener (rango ideal)

GAIN_MUSCLE:
  rate < +0.1 kg/sem              → calorías += 150
  rate > +0.4 kg/sem (mucha grasa)→ calorías -= 100

GLOBAL:
  Nunca bajar de MINIMUMS por sexo (ya implementado).
  Recalcular macros: proteína fija g/kg, grasa 27%, carbos = resto.
  Registrar en PlanHistory con reasonForChange (ya soportado).
  Si adh < 0.8 → NO ajustar plan; emitir señal a retention-agent.
```

**Crítica:** el déficit fijo de -350 kcal del `nutrition.service` actual es un punto de partida aceptable, **pero debería ser ~20% bajo TDEE** (no constante), porque -350 es agresivo para alguien de TDEE 1800 y tímido para uno de 3200. Cambio simple, alto impacto.

---

## 10. Roadmap por fases

### FASE 1 — MVP Nutrición Competitiva (cimientos)
**Objetivo:** que registrar sea rápido, editable y sobre datos reales.
- Revivir `LoggedMealItem` + cálculo de macros en backend.
- Editar/borrar comidas e ítems.
- Import Open Food Facts + USDA → base real (50k+).
- Búsqueda full-text + fuzzy + unaccent.
- `ServingSize` (unidades caseras).
- Barcode scan (endpoint + UI cámara).
- Favoritos / recientes / frecuentes.
- Agua + fibra tracking.
- Rediseño de `log.tsx` (recientes-first, métodos visibles).

| Métrica | Valor |
|---|---|
| **Impacto** | 🔴 Altísimo — sin esto no hay producto |
| **Complejidad** | Media |
| **Dependencias** | Ninguna (es la base) |
| **Tiempo estimado** | 3–4 semanas |

### FASE 2 — Nutrición Inteligente
**Objetivo:** registro por lenguaje + adherencia real.
- `POST /logs/parse` (texto libre con Claude Haiku + tool-use).
- Registro por voz (transcripción → parse).
- Cálculo automático de adherencia (`adherencePct`, `planFollowed`).
- Quick-add desde el plan.
- Alimentos creados por usuario persistentes.

| Métrica | Valor |
|---|---|
| **Impacto** | 🟠 Alto — diferenciador de velocidad |
| **Complejidad** | Media (reusa infra de IA existente) |
| **Dependencias** | Fase 1 (items vivos, base real) |
| **Tiempo estimado** | 2–3 semanas |

### FASE 3 — Nutricionista IA
**Objetivo:** la app que *entiende* lo que comes, no solo lo guarda.
- `GET /nutrition/insights`: déficit proteína, exceso calórico, inconsistencia, fibra.
- Priorización por impacto × objetivo.
- Análisis diario agregado (cron) + reactivo.
- Mensajes redactados por Claude (con `ANTHROPIC_API_KEY`).
- Foto con IA (`POST /logs/photo` + `FoodAnalysis` + UX de confianza).

| Métrica | Valor |
|---|---|
| **Impacto** | 🟠 Alto — retención + ventaja defendible |
| **Complejidad** | Alta (foto/porción es lo más duro) |
| **Dependencias** | Fase 2 (parser, resolución de ítems) |
| **Tiempo estimado** | 3–4 semanas |

### FASE 4 — Ventajas Competitivas
**Objetivo:** pulido y lock-in.
- Recetas personalizadas.
- Objetivos adaptativos automáticos (sección 9).
- Copiar día / plantillas.
- Macros por comida.
- HealthKit / Google Fit (calorías quemadas → ajuste dinámico de objetivo).

| Métrica | Valor |
|---|---|
| **Impacto** | 🟡 Medio — incremental |
| **Complejidad** | Media |
| **Dependencias** | Fases 1–3 |
| **Tiempo estimado** | 3–4 semanas |

---

## 11. Riesgos técnicos

| Riesgo | Mitigación |
|---|---|
| **Calidad/licencia de datos OFF** | OFF es ODbL (atribución requerida). Datos LATAM incompletos → combinar con USDA y permitir alimentos de usuario. Marcar `isVerified`. |
| **Costo de IA en foto/voz/texto** | Usar Haiku para parsing (barato). Foto solo bajo demanda. Trackear costo en `AiGenerationLog` (ya existe). Considerar límite por plan (`Subscription` ya existe → foto = feature PRO). |
| **Estimación de porción imprecisa (foto)** | Presentar siempre como rango editable; macros desde DB, no del modelo; medir `userCorrected` para mejorar. |
| **Latencia IA bloqueando UX** | Parsing async con fallback inmediato a manual. Nunca bloquear el registro por esperar a la IA. |
| **Migración de datos `LoggedMeal` existentes** | Los logs viejos no tienen ítems; backfill no es posible. Aceptar que el histórico previo no es item-level; aplicar solo a registros nuevos. |
| **Tamaño de DB / búsqueda lenta** | GIN + pg_trgm; `isCommon` cacheado (el schema ya lo anticipa con comentario Redis). Paginar. |
| **Confianza del usuario en IA** | Patrón "IA propone, usuario confirma" en TODOS los métodos IA. Cero auto-guardado de estimaciones. |
| **Sobre-ingeniería del equipo** | Resistir micros completos, restaurantes, gamificación. Releer sección 3 "Waste of Time" antes de cada feature nuevo. |

---

## 12. Recomendación final (sin rodeos)

1. **No persigas el tamaño de base de datos de Fitia.** Esa guerra está perdida y no es donde se gana retención. Importa OFF+USDA para tener "suficiente", y gana en **velocidad de registro**.

2. **Arregla los cimientos antes de brillar.** `LoggedMealItem` muerto, sin edición/borrado, y 30 alimentos no son detalles: son la diferencia entre un demo y un producto. **Fase 1 es no negociable y va primero.**

3. **Tu foso defensivo es el registro multimodal con IA**, no más campos en un formulario. Y dentro de eso: **texto/voz primero, foto después**. Texto libre da el 70% del "wow" al 10% del costo y complejidad de la foto, y la voz es tu mejor arma para accesibilidad (adultos mayores, principiantes).

4. **Explota la infraestructura de agentes que ya tienes.** El `Recommendation` model, el bus de eventos, `AiGenerationLog`, el fallback rules-engine/Claude — eso ya está construido y es exactamente lo que necesita el nutricionista IA. Es tu ventaja injusta sobre apps que tendrían que construirlo desde cero.

5. **Mata sin culpa:** micronutrientes completos, base de restaurantes, gamificación pesada, Nutri-Score. Cada uno parece "más completo" pero diluye foco y no mueve retención.

**El producto ganador no es el que tiene más alimentos. Es el que hace que registrar lo que comiste sea tan rápido que el usuario no abandone en la semana 2.** Optimiza cada decisión contra esa frase.
```
