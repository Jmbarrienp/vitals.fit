import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { visionApi } from '../api/vision';
import type { ScanConfirmationItem, VisionScanProposal } from '../types/vision';

/** Explicit capture state machine — testable transitions, no nutrition logic. */
export type CaptureState =
  | 'idle'
  | 'capturing'
  | 'proposing'
  | 'proposed'
  | 'confirming'
  | 'done'
  | 'error'
  /** V3.6 — the backend already logged it (earned trust). Undo is one tap away. */
  | 'auto_accepted';

/**
 * Orchestrates the V1 capture flow: launch camera -> submit to Vision ->
 * proposal -> confirm / reject / fallback. It NEVER creates a LoggedMeal itself;
 * confirm() calls the backend which converges on LogsService.logMeal. On any
 * failure it exposes state so the UI can fall back to manual logging.
 */
export function useVisionCapture() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<CaptureState>('idle');
  const [proposal, setProposal] = useState<VisionScanProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setState('idle');
    setProposal(null);
    setError(null);
  }, []);

  /** Same invalidations as manual logging — today's totals, food lists, intelligence. */
  const invalidate = useCallback(() => {
    ['today', 'food-recent', 'food-frequent', 'intelligence'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k] }),
    );
  }, [queryClient]);

  /** Launch the camera, then submit to the Vision pipeline. Returns the proposal (or null on abort/failure). */
  const capture = useCallback(async (): Promise<VisionScanProposal | null> => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setState('error');
      setError('CAMERA_PERMISSION_DENIED');
      return null;
    }

    setState('capturing');
    // base64 so the photo can reach the backend, which is where recognition happens.
    // quality 0.6 keeps the payload small; the backend caps it at 5 MB regardless.
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false, base64: true });
    if (shot.canceled || !shot.assets?.[0]) {
      setState('idle');
      return null;
    }

    setState('proposing');
    try {
      const asset = shot.assets[0];
      const imageRef = asset.fileName ?? `capture-${Date.now()}.jpg`;
      // V2: submit the real pixels. The backend calls the provider and returns a
      // platform proposal — the vendor key never reaches this device. If the
      // camera gave us no base64, we still submit the reference: the backend
      // degrades that to the manual flow rather than failing the capture.
      const image = asset.base64 ? { base64: asset.base64, mimeType: 'image/jpeg' as const } : undefined;
      const res = await visionApi.createScan(imageRef, 'PHOTO', image);
      setProposal(res.data);
      // V3.6: the backend may have already logged this on the user's earned
      // trust. It decided and acted; the client reflects that and offers undo.
      if (res.data.trust?.executed) {
        invalidate();
        setState('auto_accepted');
      } else {
        setState('proposed');
      }
      return res.data;
    } catch (e) {
      setState('error');
      setError('SCAN_FAILED');
      return null;
    }
  }, []);

  const confirm = useCallback(
    async (items: ScanConfirmationItem[], mealType?: string) => {
      if (!proposal) return;
      setState('confirming');
      try {
        await visionApi.confirm(proposal.scanId, items, mealType);
        invalidate();
        setState('done');
      } catch (e) {
        setState('error');
        setError('CONFIRM_FAILED');
      }
    },
    [proposal, invalidate],
  );

  /**
   * V3.6 — revert an auto-accepted meal. The backend deletes it through
   * LogsService and records the undo as ground truth, so this exact food stops
   * auto-accepting until trust is re-earned.
   */
  const undo = useCallback(async () => {
    if (!proposal) return;
    try {
      await visionApi.undo(proposal.scanId);
      invalidate();
      reset();
    } catch (e) {
      setState('error');
      setError('UNDO_FAILED');
    }
  }, [proposal, invalidate, reset]);

  const reject = useCallback(async () => {
    if (proposal) await visionApi.reject(proposal.scanId).catch(() => undefined);
    reset();
  }, [proposal, reset]);

  /** User goes to manual logging — record the fallback (best-effort) and reset. */
  const fallbackToManual = useCallback(async () => {
    if (proposal) await visionApi.fallback(proposal.scanId).catch(() => undefined);
    reset();
  }, [proposal, reset]);

  return { state, proposal, error, capture, confirm, reject, fallbackToManual, undo, reset };
}
