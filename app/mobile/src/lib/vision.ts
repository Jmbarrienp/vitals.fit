import type { ConfidenceBand, ScanUxMode } from '../types/vision';

/**
 * Presentation-only copy for Nutrition Vision (V1). The client assigns UI text and
 * colors to backend-decided codes — it never computes confidence or a UX mode.
 */

export const BAND_COPY: Record<ConfidenceBand, { label: string; color: string }> = {
  HIGH: { label: 'Alta confianza', color: '#22c55e' },
  MEDIUM: { label: 'Confianza media', color: '#f59e0b' },
  LOW: { label: 'Baja confianza', color: '#ef4444' },
};

export const MODE_COPY: Record<ScanUxMode, { title: string; hint: string }> = {
  CONFIRM: { title: 'Esto detectamos', hint: 'Revisa y confirma para registrarlo.' },
  REVIEW: { title: 'Creemos que es esto', hint: 'No estamos seguros — ajusta lo que necesites antes de confirmar.' },
  FALLBACK: { title: 'No pudimos identificarlo bien', hint: 'Regístralo a mano; dejamos lo que alcanzamos a detectar.' },
  // V3.6 — the platform had earned this and already logged it. The copy leads
  // with what happened and keeps undo one tap away.
  AUTO_ACCEPT: { title: 'Registrado automáticamente', hint: 'Ya lo conocemos de tus registros anteriores. Puedes deshacerlo.' },
};

export function bandCopy(band: ConfidenceBand) {
  return BAND_COPY[band] ?? BAND_COPY.LOW;
}
export function modeCopy(mode: ScanUxMode) {
  return MODE_COPY[mode] ?? MODE_COPY.FALLBACK;
}
