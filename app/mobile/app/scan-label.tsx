import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { useLabelCapture } from '../src/hooks/useLabelCapture';
import { bandCopy, modeCopy } from '../src/lib/vision';
import type { NutritionLabel, ScanConfirmationItem } from '../src/types/vision';

/**
 * Nutrition Vision V3.2 — label capture + editable review. A sibling to
 * `scan.tsx` and `scan-barcode.tsx`, reusing their Card/band/mode patterns so a
 * user cannot tell which pipeline produced the proposal.
 *
 * The modality's one UI difference: the transcribed numbers are ALWAYS editable,
 * in every mode. OCR misreads digits, and a label the user can correct in place
 * is the difference between a useful scan and a discarded one — that is also
 * what "OCR partial -> editable fields" and "never trap the user" mean in
 * practice. The screen computes nothing except the servings multiplier; the
 * backend already normalized every value to per-serving.
 */
export default function ScanLabelScreen() {
  const router = useRouter();
  const { state, proposal, error, capture, confirm, reject, fallbackToManual } = useLabelCapture();

  const [edited, setEdited] = useState<EditableLabel | null>(null);
  const [servings, setServings] = useState('1');

  useEffect(() => {
    (async () => {
      const p = await capture();
      if (p?.label) setEdited(toEditable(p.label));
      else if (!p && state === 'idle') router.back(); // user cancelled the camera
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state === 'done') {
      Alert.alert('Registrado', 'Tu comida se registró.', [{ text: 'OK', onPress: () => router.replace('/(tabs)/log') }]);
    }
  }, [state]);

  const goManual = async () => {
    await fallbackToManual();
    router.replace('/(tabs)/log');
  };

  const multiplier = useMemo(() => {
    const n = Number(servings.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [servings]);

  const onConfirm = async () => {
    if (!proposal || !edited) return;
    const values = readEditable(edited);
    if (!values) {
      Alert.alert('Revisa los valores', 'Calorías, proteínas, carbohidratos, grasas y porción deben ser números válidos.');
      return;
    }

    const grams = round1(values.servingSize * multiplier);
    const items: ScanConfirmationItem[] = [{
      // A one-off item: the label's own numbers are the truth for this package,
      // so we never link a catalog food (which would override them server-side).
      foodItemId: null,
      customName: values.productName,
      quantity: grams,
      unit: 'g',
      grams,
      calories: Math.round(values.calories * multiplier),
      proteinG: round1(values.protein * multiplier),
      carbsG: round1(values.carbs * multiplier),
      fatG: round1(values.fat * multiplier),
      acceptedFromCandidate: 0,
    }];
    await confirm(items, proposal.suggestedMealType);
  };

  return (
    <ScrollView className="flex-1 bg-background" keyboardShouldPersistTaps="handled">
      <View className="px-5 pt-14 pb-10">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-text-primary text-2xl font-bold">Escanear etiqueta</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        {(state === 'capturing' || state === 'proposing') && (
          <Card className="items-center py-10">
            <ActivityIndicator size="large" color="#6366f1" />
            <Text className="text-text-muted text-sm mt-3">
              {state === 'capturing' ? 'Abriendo cámara…' : 'Leyendo la etiqueta…'}
            </Text>
          </Card>
        )}

        {state === 'error' && (
          <Card>
            <Text className="text-text-primary text-base font-semibold mb-1">No pudimos leer la etiqueta</Text>
            <Text className="text-text-muted text-sm mb-4">
              {error === 'CAMERA_PERMISSION_DENIED' ? 'Necesitamos permiso de cámara.' : 'Ocurrió un problema. Puedes registrarlo a mano.'}
            </Text>
            <Button label="Registrar a mano" onPress={goManual} />
          </Card>
        )}

        {state === 'proposed' && proposal && !proposal.label && (
          <Card>
            <Text className="text-text-primary text-base font-semibold mb-1">No pudimos leer la etiqueta</Text>
            <Text className="text-text-muted text-sm mb-4">No encontramos una tabla nutricional en la foto.</Text>
            <Button label="Registrar a mano" onPress={goManual} />
          </Card>
        )}

        {state === 'proposed' && proposal?.label && edited && (
          <LabelForm
            proposal={proposal}
            label={proposal.label}
            edited={edited}
            servings={servings}
            onServings={setServings}
            onChange={(patch) => setEdited((prev) => (prev ? { ...prev, ...patch } : prev))}
          />
        )}

        {state === 'confirming' && (
          <Card className="items-center py-8"><ActivityIndicator color="#6366f1" /><Text className="text-text-muted text-sm mt-2">Registrando…</Text></Card>
        )}

        {state === 'proposed' && proposal?.label && (
          <View className="mt-4 gap-2">
            <Button label="Confirmar y registrar" onPress={onConfirm} />
            <Button label="Registrar a mano" variant="outline" onPress={goManual} />
            <TouchableOpacity className="py-3 items-center" onPress={reject}>
              <Text className="text-text-muted text-sm">Descartar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function LabelForm({
  proposal, label, edited, servings, onServings, onChange,
}: {
  proposal: NonNullable<ReturnType<typeof useLabelCapture>['proposal']>;
  label: NutritionLabel;
  edited: EditableLabel;
  servings: string;
  onServings: (v: string) => void;
  onChange: (patch: Partial<EditableLabel>) => void;
}) {
  const mode = modeCopy(proposal.mode);
  const band = bandCopy(proposal.scanConfidence.band);
  const missing = new Set(label.missingFields);

  return (
    <Card>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-text-primary text-base font-semibold">{mode.title}</Text>
        <Text className="text-xs font-semibold" style={{ color: band.color }}>{band.label}</Text>
      </View>
      <Text className="text-text-muted text-xs mb-1">Valores por porción. Corrige lo que haga falta antes de confirmar.</Text>
      {missing.size > 0 && (
        <Text className="text-amber-400 text-xs mb-3">
          No pudimos leer {missing.size === 1 ? 'un campo' : `${missing.size} campos`} — complétalo(s) abajo.
        </Text>
      )}
      {label.servingsPerContainer !== null && (
        <Text className="text-text-muted text-[10px] mb-3">El envase trae ~{label.servingsPerContainer} porciones.</Text>
      )}

      <View className="mt-2">
        <Input label="Producto" value={edited.productName} onChangeText={(v) => onChange({ productName: v })} placeholder="Nombre del producto" />
        <Input
          label={`Porción (${label.servingUnit === 'ml' ? 'ml' : 'g'})`}
          value={edited.servingSize}
          onChangeText={(v) => onChange({ servingSize: v })}
          keyboardType="decimal-pad"
        />
        <Input label="Calorías (kcal)" value={edited.calories} onChangeText={(v) => onChange({ calories: v })} keyboardType="decimal-pad" />
        <Input label="Proteína (g)" value={edited.protein} onChangeText={(v) => onChange({ protein: v })} keyboardType="decimal-pad" />
        <Input label="Carbohidratos (g)" value={edited.carbs} onChangeText={(v) => onChange({ carbs: v })} keyboardType="decimal-pad" />
        <Input label="Grasas (g)" value={edited.fat} onChangeText={(v) => onChange({ fat: v })} keyboardType="decimal-pad" />
        <Input label="¿Cuántas porciones comiste?" value={servings} onChangeText={onServings} keyboardType="decimal-pad" />
      </View>
    </Card>
  );
}

interface EditableLabel {
  productName: string;
  servingSize: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

function toEditable(label: NutritionLabel): EditableLabel {
  const missing = new Set(label.missingFields);
  // A field the backend couldn't read opens EMPTY rather than showing the 0 the
  // contract carries — a prefilled zero reads as "the label says zero", which is
  // exactly the invented value this modality refuses to produce.
  const show = (field: NutritionLabel['missingFields'][number], value: number) =>
    missing.has(field) ? '' : String(value);
  return {
    productName: label.productName ?? '',
    servingSize: show('servingSize', label.servingSize),
    calories: show('calories', label.calories),
    protein: show('protein', label.protein),
    carbs: show('carbs', label.carbs),
    fat: show('fat', label.fat),
  };
}

function readEditable(e: EditableLabel): { productName: string; servingSize: number; calories: number; protein: number; carbs: number; fat: number } | null {
  const servingSize = num(e.servingSize);
  const calories = num(e.calories);
  const protein = num(e.protein);
  const carbs = num(e.carbs);
  const fat = num(e.fat);
  if (servingSize === null || servingSize <= 0 || calories === null || protein === null || carbs === null || fat === null) return null;
  return {
    productName: e.productName.trim() || 'Producto empacado',
    servingSize, calories, protein, carbs, fat,
  };
}

function num(v: string): number | null {
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
