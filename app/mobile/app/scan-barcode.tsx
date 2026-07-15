import { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useBarcodeCapture } from '../src/hooks/useBarcodeCapture';
import { bandCopy, modeCopy } from '../src/lib/vision';
import type { ScanConfirmationItem } from '../src/types/vision';

/** Numeric retail types only — matches the backend DTO's @IsNumberString @Length(8,14). */
const RETAIL_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a'] as const;

/**
 * Nutrition Vision V3.1 — barcode capture + proposal review. A SIBLING screen
 * to `scan.tsx`, not a variant of it: the camera here is a live decode feed
 * (`CameraView`), not a single photo. Everything downstream of decoding —
 * proposal shape, band/mode copy, confirm/reject/fallback — is identical to
 * the photo flow, because it converges on the same VisionScan lifecycle.
 * A barcode scan always resolves to at most ONE candidate (a barcode has no
 * "alternate reading"), so there is no per-item selection here.
 */
export default function ScanBarcodeScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { state, proposal, error, startScanning, onBarcodeScanned, confirm, reject, fallbackToManual } = useBarcodeCapture();

  useEffect(() => {
    (async () => {
      if (!permission) return;
      if (!permission.granted) {
        const res = await requestPermission();
        if (!res.granted) return; // render() below shows the permission-denied state
      }
      startScanning();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  const handleScanned = (result: BarcodeScanningResult) => {
    onBarcodeScanned(result.data);
  };

  const goManual = async () => {
    await fallbackToManual();
    router.replace('/(tabs)/log');
  };

  const onConfirm = async () => {
    const candidate = proposal?.candidates[0];
    if (!candidate || !candidate.foodItemId) return;
    const items: ScanConfirmationItem[] = [{
      foodItemId: candidate.foodItemId,
      quantity: candidate.portion.grams,
      unit: 'g',
      grams: candidate.portion.grams,
      acceptedFromCandidate: candidate.detectionIndex,
    }];
    await confirm(items, proposal!.suggestedMealType);
  };

  useEffect(() => {
    if (state === 'done') {
      Alert.alert('Registrado', 'Tu comida se registró.', [{ text: 'OK', onPress: () => router.replace('/(tabs)/log') }]);
    }
  }, [state]);

  if (permission && !permission.granted) {
    return (
      <View className="flex-1 bg-background px-5 pt-14">
        <Card>
          <Text className="text-text-primary text-base font-semibold mb-1">Necesitamos la cámara</Text>
          <Text className="text-text-muted text-sm mb-4">Para escanear códigos de barras necesitamos permiso de cámara.</Text>
          <Button label="Registrar a mano" onPress={() => router.replace('/(tabs)/log')} />
        </Card>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="px-5 pt-14 pb-4 flex-row items-center justify-between">
        <Text className="text-text-primary text-2xl font-bold">Escanear código de barras</Text>
        <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
      </View>

      {state === 'scanning' && (
        <View className="flex-1 px-5 pb-10">
          <View className="flex-1 rounded-2xl overflow-hidden border border-border">
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...RETAIL_BARCODE_TYPES] }}
              onBarcodeScanned={handleScanned}
            />
          </View>
          <Text className="text-text-muted text-xs text-center mt-3">Apunta al código de barras del producto</Text>
        </View>
      )}

      <ScrollView className="flex-1 px-5">
        {state === 'proposing' && (
          <Card className="items-center py-10">
            <ActivityIndicator size="large" color="#6366f1" />
            <Text className="text-text-muted text-sm mt-3">Buscando el producto…</Text>
          </Card>
        )}

        {state === 'error' && (
          <Card>
            <Text className="text-text-primary text-base font-semibold mb-1">No pudimos escanear</Text>
            <Text className="text-text-muted text-sm mb-4">Ocurrió un problema. Puedes registrarlo a mano.</Text>
            <Button label="Registrar a mano" onPress={goManual} />
          </Card>
        )}

        {state === 'proposed' && proposal && <BarcodeProposal proposal={proposal} />}

        {state === 'confirming' && (
          <Card className="items-center py-8"><ActivityIndicator color="#6366f1" /><Text className="text-text-muted text-sm mt-2">Registrando…</Text></Card>
        )}

        {state === 'proposed' && proposal && (
          <View className="mt-4 mb-8 gap-2">
            {proposal.mode !== 'FALLBACK' && <Button label="Confirmar y registrar" onPress={onConfirm} />}
            <Button label="Registrar a mano" variant="outline" onPress={goManual} />
            <TouchableOpacity className="py-3 items-center" onPress={reject}>
              <Text className="text-text-muted text-sm">Descartar</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function BarcodeProposal({ proposal }: { proposal: NonNullable<ReturnType<typeof useBarcodeCapture>['proposal']> }) {
  const mode = modeCopy(proposal.mode);
  const band = bandCopy(proposal.scanConfidence.band);
  const candidate = proposal.candidates[0];

  return (
    <Card>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-text-primary text-base font-semibold">{mode.title}</Text>
        <Text className="text-xs font-semibold" style={{ color: band.color }}>{band.label}</Text>
      </View>
      <Text className="text-text-muted text-xs mb-3">{mode.hint}</Text>

      {!candidate ? (
        <Text className="text-text-muted text-sm py-2">No encontramos este producto en nuestra base de datos.</Text>
      ) : (
        <View className="flex-row items-center py-2.5 border-b border-border">
          <View className="flex-1">
            <Text className="text-text-primary text-sm">{candidate.displayName}</Text>
            <Text className="text-text-muted text-[10px]">~{candidate.portion.grams}g</Text>
          </View>
        </View>
      )}
    </Card>
  );
}
