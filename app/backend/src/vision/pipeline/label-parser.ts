import {
  LabelBasis,
  NutritionLabel,
  NutritionLabelField,
  OCR_CONTRACT_VERSION,
  RawLabelFields,
  ServingUnit,
} from '../types/ocr-contract';

/**
 * Nutrition label normalization (Phase 2D.2 V3.2) — PURE and total. Takes a
 * provider's verbatim transcription and produces the canonical `NutritionLabel`:
 * every value per-serving, in canonical units, with unreadable fields reported
 * rather than guessed.
 *
 * This is where "labels vary enormously" is actually handled, and it lives in the
 * platform rather than in any adapter precisely BECAUSE it varies: the rules are
 * the same whether the text came from Claude, an on-device engine, or a
 * commercial OCR. It is also what gives a probabilistic pipeline a deterministic
 * boundary — the same transcription always yields the same numbers.
 *
 * Never throws. An unparseable field becomes a `missingFields` entry, never an
 * invented value: a nutrition tracker that guesses macros is worse than one that
 * asks.
 */

const KJ_PER_KCAL = 4.184;
/** Fields the platform needs to log a meal at all. `productName` and `servingsPerContainer` are nice-to-have. */
const REQUIRED_FIELDS: NutritionLabelField[] = ['servingSize', 'calories', 'protein', 'carbs', 'fat'];

export function parseLabel(fields: RawLabelFields, providerId: string): NutritionLabel {
  const missing: NutritionLabelField[] = [];

  const serving = parseServing(fields.servingSize);
  if (!serving) missing.push('servingSize');

  const basis = parseBasis(fields.basis);
  // Per-100g values are only convertible when we know the serving mass. Without
  // it, converting would be a guess — leave the basis unresolved and let the
  // scale factor stay 1 so the numbers remain the (honest) per-100g figures,
  // with servingSize already reported missing so confidence collapses anyway.
  const scale = basis === 'HUNDRED_G' && serving && serving.unit !== 'unit' ? serving.size / 100 : 1;

  const calories = parseEnergyKcal(fields.calories);
  if (calories === null) missing.push('calories');
  const protein = parseNumber(fields.protein);
  if (protein === null) missing.push('protein');
  const carbs = parseNumber(fields.carbs);
  if (carbs === null) missing.push('carbs');
  const fat = parseNumber(fields.fat);
  if (fat === null) missing.push('fat');

  const productName = cleanName(fields.productName);
  if (!productName) missing.push('productName');
  const servingsPerContainer = parseServingsPerContainer(fields.servingsPerContainer);
  if (servingsPerContainer === null) missing.push('servingsPerContainer');

  return {
    productName,
    // A missing serving is reported, not invented; 0 keeps it out of the valid
    // range so `validateNutritionLabel` rejects it rather than silently logging.
    servingSize: serving ? round2(serving.size) : 0,
    servingUnit: serving ? serving.unit : 'unit',
    servingsPerContainer,
    calories: calories === null ? 0 : Math.round(calories * scale),
    protein: protein === null ? 0 : round1(protein * scale),
    carbs: carbs === null ? 0 : round1(carbs * scale),
    fat: fat === null ? 0 : round1(fat * scale),
    confidence: clamp01(fields.confidence),
    missingFields: missing,
    source: providerId,
    version: OCR_CONTRACT_VERSION,
  };
}

/** Fraction of the log-critical fields the provider actually read. Drives confidence (see label-candidate.ts). */
export function labelCompleteness(label: NutritionLabel): number {
  const missingRequired = label.missingFields.filter((f) => REQUIRED_FIELDS.includes(f)).length;
  return Math.max(0, 1 - missingRequired / REQUIRED_FIELDS.length);
}

/**
 * Locale-tolerant number parsing — the single messiest part of real labels.
 *
 * Separator disambiguation (both "8,5" and "1,234" are legal on different
 * continents): a separator followed by EXACTLY three digits at the end of the
 * number is a thousands separator; anything else is a decimal separator. When
 * both separators appear, the rightmost one is decimal and the other is
 * thousands. This resolves "8,5"->8.5, "1,234"->1234, "1.234,5"->1234.5 and
 * "1,234.5"->1234.5 without needing to know the label's locale.
 */
export function parseNumber(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  // Grab the first numeric run, tolerating "<1 g", "approx. 8", "8.5g", "8 , 5 g".
  const match = raw.replace(/\s+/g, '').match(/-?\d[\d.,]*/);
  if (!match) return null;

  let token = match[0];
  const lastComma = token.lastIndexOf(',');
  const lastDot = token.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalAt = Math.max(lastComma, lastDot);
    const thousandsChar = decimalAt === lastComma ? '.' : ',';
    token = token.split(thousandsChar).join('');
    token = token.replace(/,/g, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sepAt = Math.max(lastComma, lastDot);
    const decimals = token.length - sepAt - 1;
    const isThousands = decimals === 3 && sepAt > 0;
    token = isThousands ? token.replace(/[.,]/g, '') : token.replace(/,/g, '.');
  }

  // A second separator can survive the branches above (e.g. "1.234.567").
  const parts = token.split('.');
  if (parts.length > 2) token = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];

  const value = Number(token);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Energy in kcal. European labels print kJ (often "1046 kJ / 250 kcal") and the
 * kcal figure is what the platform logs — so when both appear, the kcal wins and
 * no conversion is done. A kJ-only label is converted deterministically.
 */
export function parseEnergyKcal(raw: string): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.toLowerCase();

  // Prefer an explicit kcal/Cal figure wherever it appears in the string.
  const kcalMatch = text.match(/(-?\d[\d.,]*)\s*(kcal|cal\b|calorías|calorias|calories)/);
  if (kcalMatch) return parseNumber(kcalMatch[1]);

  const kjMatch = text.match(/(-?\d[\d.,]*)\s*kj/);
  if (kjMatch) {
    const kj = parseNumber(kjMatch[1]);
    return kj === null ? null : kj / KJ_PER_KCAL;
  }

  // A bare number on the calories line is kcal by convention on US/LATAM labels.
  return parseNumber(text);
}

/**
 * Serving size + unit. Prefers a parenthesised metric weight, which is exactly
 * how US labels disambiguate their own volumetric servings ("2/3 cup (55g)") —
 * the gram figure is the one the platform can actually use.
 */
export function parseServing(raw: string): { size: number; unit: ServingUnit } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.toLowerCase();

  const paren = text.match(/\(([^)]*)\)/);
  if (paren) {
    const inner = parseMeasure(paren[1]);
    if (inner) return inner;
  }

  const direct = parseMeasure(text);
  if (direct) return direct;

  // A bare count ("1 barra", "2 galletas") is a real serving we cannot convert
  // to mass — report it as 'unit' rather than pretending it is grams.
  const bare = parseNumber(text);
  if (bare !== null && bare > 0) return { size: bare, unit: 'unit' };
  return null;
}

export function parseServingsPerContainer(raw: string): number | null {
  const n = parseNumber(raw);
  if (n === null || n <= 0) return null;
  return round2(n);
}

/** Which quantity the numbers refer to. Null when the label doesn't say — treated as per-serving, the overwhelming default. */
export function parseBasis(raw: string): LabelBasis | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.toLowerCase();
  if (/100\s*(g|ml|gr)/.test(text)) return 'HUNDRED_G';
  if (/(serving|porci[oó]n|ração|racao|portion)/.test(text)) return 'SERVING';
  return null;
}

function parseMeasure(text: string): { size: number; unit: ServingUnit } | null {
  const match = text.match(/(-?\d[\d.,]*)\s*(g|gr|gramos|grams|ml|mililitros|milliliters)\b/);
  if (!match) return null;
  const size = parseNumber(match[1]);
  if (size === null || size <= 0) return null;
  const unit: ServingUnit = /^m/.test(match[2]) ? 'ml' : 'g';
  return { size, unit };
}

function cleanName(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
  return name.length > 0 ? name : null;
}

function clamp01(x: unknown): number {
  const n = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  return Math.max(0, Math.min(1, n));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
