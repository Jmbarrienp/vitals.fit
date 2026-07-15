import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { visionApi } from '../api/vision';
import type { ScanConfirmationItem, VisionScanProposal } from '../types/vision';

/** Mirrors useVisionCapture's shape — a label scan is a single-shot photo, like the food-photo flow. */
export type LabelCaptureState = 'idle' | 'capturing' | 'proposing' | 'proposed' | 'confirming' | 'done' | 'error';

/**
 * Orchestrates the V3.2 label flow: capture -> OCR -> normalized proposal ->
 * edit -> confirm. It NEVER creates a LoggedMeal itself and it NEVER computes
 * nutrition — the backend transcribes, normalizes and validates; this hook
 * carries the numbers the user confirmed back through the same confirm path as
 * every other modality.
 */
export function useLabelCapture() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LabelCaptureState>('idle');
  const [proposal, setProposal] = useState<VisionScanProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setState('idle');
    setProposal(null);
    setError(null);
  }, []);

  const capture = useCallback(async (): Promise<VisionScanProposal | null> => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setState('error');
      setError('CAMERA_PERMISSION_DENIED');
      return null;
    }

    setState('capturing');
    // Higher quality than the food-photo flow: OCR reads small print, and a
    // label that compresses into illegibility just becomes a failed scan.
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false, base64: true });
    if (shot.canceled || !shot.assets?.[0]) {
      setState('idle');
      return null;
    }

    setState('proposing');
    try {
      const asset = shot.assets[0];
      const imageRef = asset.fileName ?? `label-${Date.now()}.jpg`;
      const image = asset.base64 ? { base64: asset.base64, mimeType: 'image/jpeg' as const } : undefined;
      const res = await visionApi.createLabelScan(imageRef, image);
      setProposal(res.data);
      setState('proposed');
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
        // Same invalidations as manual logging, photo vision and barcode.
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

  return { state, proposal, error, capture, confirm, reject, fallbackToManual, reset };
}
