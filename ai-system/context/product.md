# product.md — Visión y Lógica del Producto

> Documento maestro del producto. Define qué es, para qué existe, qué problemas resuelve y cómo se diferencia. Todos los agentes deben conocer este documento antes de tomar cualquier decisión de UX o negocio.

---

## ¿Qué es este producto?

Una aplicación fitness centrada en **nutrición personalizada e inteligente**. No es una calculadora de calorías con interfaz bonita — es un sistema que aprende del usuario y adapta sus recomendaciones con el tiempo.

El usuario debe sentir que tiene acceso a:
- Un **nutricionista** que conoce su historial completo
- Un **entrenador personal** que ajusta el plan a sus resultados reales
- Un **sistema inteligente** que recuerda sus preferencias y hábitos

---

## Propuesta de Valor

| Para quién | El problema que resuelve | Cómo lo resuelve |
|---|---|---|
| Personas que quieren perder peso | No saben cuánto comer ni qué comer | Plan calórico personalizado con comidas reales |
| Personas que quieren ganar músculo | No optimizan proteína ni timing | Distribución de macros por objetivo con seguimiento |
| Personas que han fallado en otras apps | Se aburren o sienten que el plan es genérico | Personalización real basada en historial y preferencias |
| Usuarios ocupados | No tienen tiempo de calcular todo | Automatización total del plan con ajustes automáticos |

---

## Diferenciadores Clave

1. **Memoria real del usuario** — el sistema recuerda lo que funcionó y lo que no
2. **Ajuste automático** — el plan cambia cuando el progreso se estanca, sin que el usuario lo pida
3. **Personalización profunda** — no hay dos planes iguales, ni siquiera para el mismo objetivo
4. **Retención inteligente** — las notificaciones referencian datos reales, nunca son genéricas
5. **Base nutricional científica** — todas las fórmulas están referenciadas (no "reglas inventadas")

---

## Lo que el Producto NO es

- No es una red social fitness
- No es un contador de pasos o wearable companion (en MVP)
- No es un sistema de recetas estático
- No reemplaza diagnóstico médico ni prescripción dietética clínica
- No promete resultados sin adherencia del usuario

---

## Flujo de Experiencia del Usuario

```
Onboarding (< 3 min)
    ↓
Plan personalizado generado automáticamente
    ↓
Registro diario de comidas (fricción mínima)
    ↓
Feedback inteligente diario
    ↓
Ajuste automático cada 2 semanas
    ↓
Progreso visible → retención
```

---

## Métricas de Éxito del Producto

| Métrica | MVP (mes 1–3) | Crecimiento (mes 4–6) |
|---|---|---|
| Retención día 7 | > 40% | > 55% |
| Retención día 30 | > 20% | > 35% |
| Tiempo de onboarding | < 3 min | < 2 min |
| Adherencia diaria al plan | > 50% | > 65% |
| NPS | > 30 | > 50 |

---

## Fases del Producto

### Fase 1 — MVP (semanas 1–8)
Funcionalidades mínimas para validar el core:
- Onboarding con perfil completo
- Cálculo de TDEE y macros
- Generación de plan de 7 días
- Registro de comidas y peso
- Dashboard básico de progreso

### Fase 2 — Core Inteligente (semanas 9–16)
- Análisis de progreso real vs esperado
- Ajuste automático del plan cada 2 semanas
- Historial y gráficos de progreso
- Recomendaciones personalizadas

### Fase 3 — Retención y Escala (semana 17+)
- Sistema de notificaciones personalizadas
- Hitos, logros y motivación contextual
- Integración de actividad física
- Reportes semanales automatizados

---

## Reglas de Negocio Generales

1. El plan nunca cambia sin datos suficientes (mínimo 7 días de registro)
2. Los cambios drásticos al plan requieren confirmación del usuario
3. El sistema nunca promete fechas de resultado — proyecta rangos
4. Las calorías mínimas nunca bajan de 1200 kcal (mujeres) o 1500 kcal (hombres)
5. Toda recomendación debe poder justificarse con datos del historial del usuario
