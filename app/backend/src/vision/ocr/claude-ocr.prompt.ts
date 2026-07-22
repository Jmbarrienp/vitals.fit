import { RawLabelFields } from '../types/ocr-contract';

/**
 * The vendor-shaped half of the Claude OCR adapter (Phase 2D.2 V3.2) — same
 * split as `claude-vision.prompt.ts`: everything that knows what a *model* wants
 * lives here, and the adapter stays a thin port implementation.
 *
 * The instruction that defines this modality: TRANSCRIBE, DO NOT INTERPRET. The
 * model copies what is printed, verbatim, into typed slots. It converts nothing,
 * computes nothing, and infers nothing. All normalization (decimal commas,
 * kJ->kcal, per-100g basis, serving units) is done afterward by the platform's
 * pure parser.
 *
 * That division is deliberate and load-bearing: arithmetic performed by a model
 * is unverifiable and non-deterministic, while arithmetic performed by
 * `label-parser.ts` is pure, unit-tested, and identical for every provider. It is
 * also what keeps the "never invent a macro" invariant enforceable — a model that
 * only copies cannot hallucinate a calorie count, and a blank slot stays blank
 * instead of becoming a plausible-looking guess.
 */

/** Bump when the prompt or schema changes shape — travels as `LabelExtraction.providerVersion` for eval attribution. */
export const OCR_PROMPT_VERSION = '1.0.0';

export const OCR_SYSTEM_PROMPT = `Eres un sistema de transcripción de etiquetas nutricionales. Recibes la foto de una etiqueta y copias EXACTAMENTE lo que está impreso.

REGLA PRINCIPAL: TRANSCRIBE, NO INTERPRETES.
- Copia el texto tal como aparece, con sus unidades y su puntuación original. Si la etiqueta dice "3,5 g", escribe "3,5 g" — NO lo conviertas a "3.5".
- Si dice "1046 kJ / 250 kcal", escribe "1046 kJ / 250 kcal" completo.
- Si dice "2/3 cup (55g)", escribe "2/3 cup (55g)" completo.
- NO conviertas unidades. NO calcules nada. NO redondees. El sistema se encarga de eso.

CAMPOS:
- "productName": el nombre comercial del producto. "" si no es visible.
- "servingSize": el tamaño de la porción tal cual está impreso (ej: "30 g", "2/3 cup (55g)", "1 barra").
- "servingsPerContainer": porciones por envase tal cual (ej: "about 8", "8", "aprox. 12").
- "calories": la línea de energía tal cual (ej: "240", "132 kcal", "1046 kJ / 250 kcal").
- "protein" / "carbs" / "fat": el valor de proteínas / carbohidratos totales / grasas totales, tal cual (ej: "5 g", "2,3 g").
- "basis": si la etiqueta indica a qué cantidad se refieren los valores, cópialo (ej: "Por porción", "per 100 g"). "" si no lo dice.
- "confidence": 0..1, qué tan legible fue la etiqueta en general. Sé honesto: foto borrosa, ángulo malo o texto cortado = confianza baja.

SI NO PUEDES LEER UN CAMPO:
- Devuelve "" para ese campo. NUNCA inventes un número, NUNCA lo estimes, NUNCA lo deduzcas de los otros campos. Un campo vacío es una respuesta correcta; un número inventado es un error grave.

Si la imagen no es una etiqueta nutricional, devuelve todos los campos como "" y confidence 0.

Devuelve SOLO el objeto JSON del esquema.`;

export const OCR_USER_PROMPT = 'Transcribe los valores impresos en esta etiqueta nutricional.';

/**
 * Structured-output schema. Every field is a REQUIRED string (never nullable):
 * "" means "not readable", which keeps the schema simple and removes the model's
 * temptation to omit a slot it found hard. `confidence` is the only number, and
 * it is a self-report about legibility — not about the values themselves.
 *
 * Structured outputs reject numeric range constraints, so `confidence` is clamped
 * in the parser rather than declared here.
 */
export const LABEL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    productName: { type: 'string', description: 'Nombre comercial del producto, o "" si no es visible.' },
    servingSize: { type: 'string', description: 'Tamaño de porción impreso, verbatim.' },
    servingsPerContainer: { type: 'string', description: 'Porciones por envase, verbatim.' },
    calories: { type: 'string', description: 'Línea de energía verbatim, con sus unidades.' },
    protein: { type: 'string', description: 'Proteínas verbatim, con unidad.' },
    carbs: { type: 'string', description: 'Carbohidratos totales verbatim, con unidad.' },
    fat: { type: 'string', description: 'Grasas totales verbatim, con unidad.' },
    basis: { type: 'string', description: 'A qué cantidad se refieren los valores, verbatim. "" si no se indica.' },
    confidence: { type: 'number', description: 'Legibilidad general de la etiqueta, 0..1.' },
  },
  required: [
    'productName',
    'servingSize',
    'servingsPerContainer',
    'calories',
    'protein',
    'carbs',
    'fat',
    'basis',
    'confidence',
  ],
  additionalProperties: false,
};

const MAX_FIELD_CHARS = 120;

/**
 * Vendor JSON -> `RawLabelFields`. PURE and total: never throws, never invents.
 * Structured outputs make a malformed shape unlikely, not impossible — and a
 * provider is untrusted input regardless of how it is constrained.
 *
 * Note this deliberately does NOT parse numbers. It only guarantees the slots
 * are strings of sane length; `label-parser.ts` owns every interpretation.
 */
export function parseLabelExtraction(payload: unknown): RawLabelFields {
  const p = isObject(payload) ? payload : {};
  return {
    productName: str(p.productName),
    servingSize: str(p.servingSize),
    servingsPerContainer: str(p.servingsPerContainer),
    calories: str(p.calories),
    protein: str(p.protein),
    carbs: str(p.carbs),
    fat: str(p.fat),
    basis: str(p.basis),
    confidence: clamp01(p.confidence),
  };
}

function str(x: unknown): string {
  return typeof x === 'string' ? x.trim().slice(0, MAX_FIELD_CHARS) : '';
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Anything non-numeric reads as zero confidence — an unusable signal never reads as certainty. */
function clamp01(x: unknown): number {
  const n = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  return Math.max(0, Math.min(1, n));
}
