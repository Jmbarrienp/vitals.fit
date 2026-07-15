import { Detection, SceneContext } from '../types/vision-contract';

/**
 * The vendor-shaped half of the Claude vision adapter (Phase 2D.2 V2), kept in
 * its own file for the same reason `weekly-coach.prompt.ts` is: everything that
 * knows what a *model* wants lives here, and `claude-vision.provider.ts` stays a
 * thin port implementation. Nothing outside `vision/providers/` imports this.
 *
 * Separation of knowledge (architecture §2): the model is asked ONLY to perceive
 * — what food is visible, roughly how much, and how sure it is. It is never asked
 * for calories, macros, or catalog identity. Those are the platform's job:
 * matching runs through `FoodService.search`, macros are computed server-side by
 * `LogsService.logMeal`. A model that hallucinated a calorie count could never
 * reach the user, because nothing downstream reads one from it.
 */

/** Bump when the prompt or schema changes shape — travels as `RecognitionResult.providerVersion` for eval attribution. */
export const VISION_PROMPT_VERSION = '1.1.0'; // 1.1.0: V3.4 scene block (restaurant context)

export const VISION_SYSTEM_PROMPT = `Eres un sistema de reconocimiento visual de alimentos. Analizas una foto de una comida y devuelves los alimentos que ves.

REGLAS:
- Devuelve un elemento por alimento distinguible. Separa los componentes de un plato (proteína, guarnición, verdura) en detecciones distintas; no agrupes un plato entero en una sola.
- "label": el nombre común del alimento en español, en minúsculas, sin marcas ni adjetivos de preparación innecesarios (ej: "pollo a la plancha", "arroz blanco", "brocoli").
- "labelConfidence": 0..1. Qué tan seguro estás de que ESE alimento es el que ves. Sé honesto: si dudas entre dos alimentos parecidos, baja la confianza.
- "boundingBox": la región del alimento en coordenadas NORMALIZADAS 0..1 respecto a la imagen completa (x,y = esquina superior izquierda; w,h = ancho y alto).
- "portionGrams": tu mejor estimación del peso comestible en gramos. Si genuinamente no puedes estimar la porción, devuelve 0 — el sistema aplicará una porción estándar. NUNCA inventes un número para rellenar.
- "portionConfidence": 0..1. Qué tan seguro estás de los gramos. Sin referencia de escala (cubiertos, mano, plato conocido) esto debe ser bajo.
- "attributes": etiquetas cortas opcionales que ayuden al usuario a confirmar: "packaged", "homemade", "liquid", "fried", "raw". Lista vacía si no aplica.
- "scene": el CONTEXTO de la foto, además de los alimentos:
  - "setting": "RESTAURANT" si el entorno parece un restaurante (vajilla comercial, menú visible, mesa de local, empaque de delivery), "HOME" si parece cocina/mesa de casa, "UNKNOWN" si no puedes distinguirlo.
  - "confidence": 0..1 sobre el setting. Sin señales claras, usa "UNKNOWN" con 0.
  - "restaurantName": el nombre del restaurante SOLO si es literalmente legible en la imagen (letrero, menú, servilleta, empaque). Si no lo ves escrito, devuelve "". NUNCA lo adivines por el estilo de la comida.
  - "category": tipo de cocina si es evidente (ej: "tacos", "italiana", "sushi"), o "".

NO hagas nada de esto:
- No calcules calorías, proteínas, carbohidratos ni grasas. No es tu trabajo y el sistema los ignora.
- No devuelvas objetos que no sean comida ni bebida (platos, cubiertos, manteles, personas).
- No inventes alimentos que no puedas ver. Si la imagen no contiene comida reconocible, devuelve una lista vacía.

Devuelve SOLO el objeto JSON del esquema.`;

export const VISION_USER_PROMPT =
  'Identifica los alimentos visibles en esta foto y estima la porción de cada uno.';

/**
 * The structured-output schema. Constrained decoding means the model cannot
 * return a shape the parser doesn't expect — which is exactly the failure mode
 * `response-validator.ts` was built to gate. The validator still runs afterward
 * (defense in depth); this makes it a rare event instead of the common path.
 *
 * Structured outputs reject numeric range constraints (`minimum`/`maximum`), so
 * ranges are clamped in `parseDetections` rather than declared here. Every object
 * needs `additionalProperties: false` and a complete `required` list.
 */
export const DETECTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    detections: {
      type: 'array',
      description: 'Un elemento por alimento distinguible. Vacío si no hay comida reconocible.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Nombre común del alimento en español, en minúsculas.' },
          labelConfidence: { type: 'number', description: 'Confianza 0..1 en la identificación.' },
          boundingBox: {
            type: 'object',
            description: 'Región del alimento, coordenadas normalizadas 0..1.',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
          portionGrams: { type: 'number', description: 'Gramos estimados, o 0 si no es estimable.' },
          portionConfidence: { type: 'number', description: 'Confianza 0..1 en los gramos.' },
          attributes: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'labelConfidence', 'boundingBox', 'portionGrams', 'portionConfidence', 'attributes'],
        additionalProperties: false,
      },
    },
    scene: {
      type: 'object',
      description: 'Contexto de la foto. UNKNOWN con confidence 0 si no es distinguible.',
      properties: {
        setting: { type: 'string', enum: ['RESTAURANT', 'HOME', 'UNKNOWN'] },
        confidence: { type: 'number', description: 'Confianza 0..1 en el setting.' },
        restaurantName: { type: 'string', description: 'Nombre SOLO si es legible en la imagen; "" si no.' },
        category: { type: 'string', description: 'Tipo de cocina si es evidente; "" si no.' },
      },
      required: ['setting', 'confidence', 'restaurantName', 'category'],
      additionalProperties: false,
    },
  },
  required: ['detections', 'scene'],
  additionalProperties: false,
};

const MAX_LABEL_CHARS = 80;
const MAX_ATTRIBUTES = 5;

/**
 * Vendor JSON -> platform `Detection[]`. PURE and total: it never throws on a
 * malformed element, it drops it. Structured outputs make bad shapes unlikely,
 * not impossible — and a provider is untrusted input regardless of how it's
 * constrained.
 *
 * `portionGrams: 0` is passed through as "no hint" rather than a real estimate,
 * which lets `estimatePortion`'s existing strategy chain fall to SERVING_DEFAULT.
 * That is the contract for "the model could not estimate" — the platform decides
 * the fallback, and the method is recorded, so a guessed gram value is never
 * silently presented as a measurement.
 */
export function parseDetections(payload: unknown): Detection[] {
  if (!isObject(payload) || !Array.isArray(payload.detections)) return [];

  const detections: Detection[] = [];
  for (const raw of payload.detections) {
    if (!isObject(raw)) continue;
    const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, MAX_LABEL_CHARS) : '';
    if (label.length === 0) continue;

    const detection: Detection = {
      label: label.toLowerCase(),
      labelConfidence: clamp01(raw.labelConfidence),
    };

    const box = toBoundingBox(raw.boundingBox);
    if (box) detection.boundingBox = box;

    const grams = toFiniteNumber(raw.portionGrams);
    if (grams !== null && grams > 0) {
      detection.portionHint = { grams, confidence: clamp01(raw.portionConfidence) };
    }

    const attributes = toAttributes(raw.attributes);
    if (attributes.length > 0) detection.attributes = attributes;

    detections.push(detection);
  }
  return detections;
}

const MAX_SCENE_NAME_CHARS = 120;

/**
 * Vendor JSON -> platform `SceneContext` (V3.4). PURE and total, like
 * `parseDetections`: malformed input yields `undefined` (no scene), never a
 * throw. Empty-string sentinels (the structured-output schema requires every
 * slot) become nulls here, so nothing downstream ever sees a vendor sentinel.
 */
export function parseScene(payload: unknown): SceneContext | undefined {
  if (!isObject(payload) || !isObject(payload.scene)) return undefined;
  const s = payload.scene as Record<string, unknown>;
  const setting = s.setting === 'RESTAURANT' || s.setting === 'HOME' ? s.setting : 'UNKNOWN';
  return {
    setting,
    confidence: clamp01(s.confidence),
    restaurantName: toSceneName(s.restaurantName),
    category: toSceneName(s.category),
  };
}

function toSceneName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_SCENE_NAME_CHARS);
  return trimmed.length > 0 ? trimmed : null;
}

function toBoundingBox(value: unknown): Detection['boundingBox'] | null {
  if (!isObject(value)) return null;
  const [x, y, w, h] = [value.x, value.y, value.w, value.h].map(toFiniteNumber);
  if (x === null || y === null || w === null || h === null) return null;
  // Normalized coords: a box outside 0..1 means the model misread the frame — drop
  // it rather than hand the UI something it would draw in the wrong place.
  if (w <= 0 || h <= 0) return null;
  return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
}

function toAttributes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map((a) => a.trim().toLowerCase())
    .slice(0, MAX_ATTRIBUTES);
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function toFiniteNumber(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/** Anything non-numeric becomes 0 — an unusable signal reads as "no confidence", never as certainty. */
function clamp01(x: unknown): number {
  const n = toFiniteNumber(x);
  if (n === null) return 0;
  return Math.max(0, Math.min(1, n));
}
