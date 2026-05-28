# user-personas.md — Perfiles y Arquetipos de Usuario

> Define quiénes son los usuarios del sistema, cómo piensan, qué los motiva y qué los hace abandonar. Los agentes deben usar estos perfiles para personalizar tono, nivel de detalle y tipo de recomendaciones.

---

## Cómo Usar Este Documento

Cuando el sistema infiera el perfil de un usuario nuevo, debe clasificarlo en uno de estos arquetipos durante el onboarding. Esta clasificación guía:
- El tono de los mensajes
- El nivel de detalle en explicaciones
- La agresividad de los objetivos propuestos
- La estrategia de retención

Un usuario puede evolucionar entre arquetipos con el tiempo.

---

## Arquetipo 1 — El Principiante Motivado

**Perfil demográfico:** 25–40 años, sin experiencia previa en nutrición estructurada.

**Situación:** Acaba de decidir "cambiar su estilo de vida". Alta motivación inicial, bajo conocimiento.

**Motivación principal:** Verse mejor, sentirse con más energía, una fecha límite (boda, verano, reunión).

**Miedos:** Hacer algo mal, que el plan sea muy complicado, no entender los números.

**Comportamiento en app:**
- Usa la app todos los días la primera semana
- Abandona si siente que el plan es difícil de seguir
- Necesita refuerzo positivo frecuente

**Señales en onboarding:**
- Declara objetivo de pérdida de peso > 10 kg
- Nivel de actividad: sedentario o ligeramente activo
- Sin restricciones dietéticas complejas

**Cómo debe responder el sistema:**
- Lenguaje simple, sin jerga nutricional
- Explicar el "por qué" de cada recomendación
- Celebrar pequeños logros (primer día completo, primera semana)
- Plan conservador: déficit moderado (300–400 kcal), cambios graduales

---

## Arquetipo 2 — El Atleta Amateur

**Perfil demográfico:** 20–35 años, hace ejercicio regularmente (3–5 días/semana).

**Situación:** Ya tiene hábitos de ejercicio, quiere optimizar su nutrición para mejorar rendimiento o composición corporal.

**Motivación principal:** Ganar músculo, bajar % grasa, mejorar marcas personales.

**Miedos:** Perder músculo en un déficit, no comer suficiente proteína, "hacer las cosas mal".

**Comportamiento en app:**
- Usuario más exigente con la precisión de los datos
- Quiere ver los números detallados (gramos exactos de macros)
- Registra comidas con cuidado
- Abandona si el plan se siente genérico o impreciso

**Señales en onboarding:**
- Nivel de actividad: activo o muy activo
- Objetivo: ganar músculo o recomposición corporal
- Puede tener conocimiento previo de macros

**Cómo debe responder el sistema:**
- Lenguaje técnico permitido (macros, TDEE, déficit calórico)
- Mostrar cálculos cuando se soliciten
- Enfocarse en proteína como prioridad
- Ajustes más precisos y frecuentes
- Integrar actividad física en el cálculo calórico

---

## Arquetipo 3 — El Ocupado Consistente

**Perfil demográfico:** 30–50 años, profesional con poco tiempo.

**Situación:** Quiere cuidarse pero no tiene tiempo para planificar comidas ni calcular nada.

**Motivación principal:** Salud a largo plazo, mantenerse en peso, no subir más.

**Miedos:** Que el sistema le pida demasiado, planes complicados, tener que pensar mucho.

**Comportamiento en app:**
- Uso irregular (fines de semana, momentos libres)
- Prefiere planes con pocas opciones y claras
- Valora la automatización total
- No registra cada comida — necesita opciones de registro rápido

**Señales en onboarding:**
- Disponibilidad de tiempo: baja
- Objetivo: mantenimiento o pérdida moderada
- Respuestas cortas en el formulario de onboarding

**Cómo debe responder el sistema:**
- Lenguaje directo y breve
- Planes con pocas comidas repetibles (menos variedad, más simplicidad)
- Notificaciones en horarios que el sistema infiere de su uso
- Resúmenes semanales en lugar de feedback diario
- Registro rápido: "¿Seguiste el plan hoy? Sí / Más o menos / No"

---

## Arquetipo 4 — El Reincidente

**Perfil demográfico:** Cualquier edad. Ha intentado dietas antes y ha fallado.

**Situación:** Escéptico por experiencias previas. Baja confianza en que "esta vez será diferente".

**Motivación principal:** Demostrar que puede, resultado visible rápido para creer.

**Miedos:** Fallar de nuevo, planes restrictivos, sentir hambre, que el sistema lo juzgue.

**Comportamiento en app:**
- Prueba la app con expectativas bajas
- Si no ve resultados en 2 semanas, abandona
- Sensible a mensajes que suenen a culpa o fracaso
- Necesita wins rápidos y alcanzables

**Señales en onboarding:**
- Menciona haber intentado dietas antes
- Peso con historial de fluctuación
- Objetivo ambicioso pero con tono de duda

**Cómo debe responder el sistema:**
- Tono empático y no crítico (nunca "no cumpliste")
- Objetivos de corto plazo muy concretos (esta semana, no "en 3 meses")
- Énfasis en progreso relativo, no en cifras absolutas
- Celebrar adherencia, no solo resultado en la balanza
- Plan flexible que tolera "días malos" sin resetear todo

---

## Arquetipo 5 — El Experto Autodirigido

**Perfil demográfico:** 25–45 años, conoce nutrición, puede que sea del sector fitness.

**Situación:** Usa la app como herramienta de tracking, no necesita que le expliquen las bases.

**Motivación principal:** Precisión, datos, optimización.

**Miedos:** Que el sistema lo trate como principiante, recomendaciones obvias, falta de control manual.

**Comportamiento en app:**
- Configura todo manualmente si puede
- Critica rápido si los cálculos no son correctos
- Alto engagement si la app le da control granular
- Puede convertirse en evangelizador si la app es buena

**Señales en onboarding:**
- Responde con datos precisos (peso exacto, % grasa estimado)
- Conoce términos como TDEE, macros, periodización
- Puede indicar su propio objetivo calórico

**Cómo debe responder el sistema:**
- Interfaz avanzada con control manual disponible
- No explicar lo básico a menos que se pregunte
- Mostrar datos completos y exportables
- Respetar sus ajustes manuales sin sobreescribirlos
- Ofrecer modo "experto" en configuración

---

## Señales de Riesgo de Abandono (todos los perfiles)

| Señal | Acción del sistema |
|---|---|
| Sin registro en 2 días | Notificación personalizada con dato de su último progreso |
| Adherencia < 40% en la semana | Simplificar el plan, no aumentar exigencia |
| Sin abrir la app en 5 días | Alerta al `retention-agent` con contexto del perfil |
| Peso sin cambio en 14 días | `progress-analyst` activa diagnóstico y propone ajuste |
| Feedback negativo en plan | `recommendation-engine` ofrece alternativas inmediatas |
