import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { visionApi } from '../api/vision';
import type { ScanConfirmationItem, VisionScanProposal } from '../types/vision';

/**
 * Explicit capture state machine (V3.1) — mirrors `useVisionCapture`'s shape
 * exactly, so the two modalities feel identical to anything downstream. The
 * one structural difference: barcode decoding is a live, continuous camera
 * feed (`CameraView`), not a single-shot capture, so there is a `scanning`
 * state instead of `capturing`, and the screen owns rendering the camera
 * (this hook cannot "launch" it the way `ImagePicker.launchCameraAsync` does).
 */
export type BarcodeCaptureState = 'idle' | 'scanning' | 'proposing' | 'proposed' | 'confirming' | 'done' | 'error';

/**
 * Orchestrates the V3.1 barcode flow: live scan -> decode -> submit to Vision
 * -> proposal -> confirm/reject/fallback. It NEVER creates a LoggedMeal itself
 * — confirm() calls the backend, which converges on the SAME confirmScan path
 * as photo scans (`VisionScanService.confirmScan`, unchanged for this modality).
 */
export function useBarcodeCapture() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<BarcodeCaptureState>('idle');
  const [proposal, setProposal] = useState<VisionScanProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  // CameraView's onBarcodeScanned fires on every frame that still sees the
  // barcode — this guard makes sure a held-still phone submits exactly once.
  const submittingRef = useRef(false);

  const reset = useCallback(() => {
    submittingRef.current = false;
    setState('idle');
    setProposal(null);
    setError(null);
  }, []);

  const startScanning = useCallback(() => {
    submittingRef.current = false;
    setError(null);
    setState('scanning');
  }, []);

  const onBarcodeScanned = useCallback(async (barcode: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setState('proposing');
    try {
      const res = await visionApi.createBarcodeScan(barcode);
      setProposal(res.data);
      setState('proposed');
    } catch (e) {
      setState('error');
      setError('SCAN_FAILED');
    }
  }, []);

  const confirm = useCallback(
    async (items: ScanConfirmationItem[], mealType?: string) => {
      if (!proposal) return;
      setState('confirming');
      try {
        await visionApi.confirm(proposal.scanId, items, mealType);
        // Same invalidations as manual logging and photo-vision — today's totals, food lists, intelligence.
        ['today', 'food-recent', 'food-frequent', 'intelligence'].forEach((k) =>
          queryClient.invalidateQueries({ queryKey: [k] }),
        );
        setState('done');
      } catch (e) {
        setState('error');
        setError('CONFIRM_FAILED');
      }
    },
    [proposal, queryClient],
  );

  const reject = useCallback(async () => {
    if (proposal) await visionApi.reject(proposal.scanId).catch(() => undefined);
    reset();
  }, [proposal, reset]);

  const fallbackToManual = useCallback(async () => {
    if (proposal) await visionApi.fallback(proposal.scanId).catch(() => undefined);
    reset();
  }, [proposal, reset]);

  return { state, proposal, error, startScanning, onBarcodeScanned, confirm, reject, fallbackToManual, reset };
}
