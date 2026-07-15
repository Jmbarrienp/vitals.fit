import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useVisionCapture } from '../src/hooks/useVisionCapture';
import { bandCopy, modeCopy } from '../src/lib/vision';
import type { FoodCandidate, MenuCandidate, RestaurantContext, ScanConfirmationItem } from '../src/types/vision';

/**
 * Nutrition Vision V1 — camera capture + proposal review. Vision proposes; the
 * user confirms; confirmation converges on the existing LoggedMeal path. Any
 * failure or low confidence steers to manual logging. This screen RENDERS the
 * backend proposal and sends confirm/reject/fallback — it computes no nutrition.
 */
export default function ScanScreen() {
  const router = useRouter();
  const { state, proposal, error, capture, confirm, reject, fallbackToManual } = useVisionCapture();
  const [included, setIncluded] = useState<Set<number>>(new Set());
  // V3.4 — menu candidates the user tapped (indices into restaurant.menuCandidates).
  const [menuPicked, setMenuPicked] = useState<Set<number>>(new Set());

  // Auto-launch the camera once when the screen opens.
  useEffect(() => {
    (async () => {
      const p = await capture();
      if (p) setIncluded(new Set(p.candidates.filter((c) => c.foodItemId).map((c) => c.detectionIndex)));
      else if (!p && state === 'idle') router.back(); // user cancelled the camera
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goManual = async () => {
    await fallbackToManual();
    router.replace('/(tabs)/log');
  };

  const onConfirm = async () => {
    if (!proposal) return;
    const items: ScanConfirmationItem[] = proposal.candidates
      .filter((c) => c.foodItemId && included.has(c.detectionIndex))
      .map((c) => ({
        foodItemId: c.foodItemId,
        quantity: c.portion.grams,
        unit: 'g',
        grams: c.portion.grams,
        acceptedFromCandidate: c.detectionIndex,
      }));
    // V3.4 — picked menu dishes go in as one-off items with their PUBLISHED
    // nutrition only. Nothing is computed here: unpublished macros stay unsent
    // and the backend's existing one-off convention applies.
    for (const idx of menuPicked) {
      const dish = proposal.restaurant?.menuCandidates[idx];
      if (!dish || dish.calories == null) continue;
      items.push({
        foodItemId: null,
        customName: dish.name,
        quantity: dish.servingGrams ?? 1,
        unit: dish.servingGrams ? 'g' : 'serving',
        grams: dish.servingGrams ?? undefined,
        calories: dish.calories,
        proteinG: dish.proteinG ?? undefined,
        carbsG: dish.carbsG ?? undefined,
        fatG: dish.fatG ?? undefined,
        acceptedFromCandidate: null,
      });
    }
    if (items.length === 0) {
      Alert.alert('Nada que registrar', 'Selecciona al menos un alimento reconocido, o regístralo a mano.');
      return;
    }
    await confirm(items, proposal.suggestedMealType);
  };

  useEffect(() => {
    if (state === 'done') {
      Alert.alert('Registrado', 'Tu comida se registró.', [{ text: 'OK', onPress: () => router.replace('/(tabs)/log') }]);
    }
  }, [state]);

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-5 pt-14 pb-10">
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-text-primary text-2xl font-bold">Escanear comida</Text>
          <TouchableOpacity onPress={() => router.back()}><Text className="text-text-muted text-base">Cerrar</Text></TouchableOpacity>
        </View>

        {(state === 'capturing' || state === 'proposing') && (
          <Card className="items-center py-10">
            <ActivityIndicator size="large" color="#6366f1" />
            <Text className="text-text-muted text-sm mt-3">
              {state === 'capturing' ? 'Abriendo cámara…' : 'Analizando tu foto…'}
            </Text>
          </Card>
        )}

        {state === 'error' && (
          <Card>
            <Text className="text-text-primary text-base font-semibold mb-1">No pudimos escanear</Text>
            <Text className="text-text-muted text-sm mb-4">
              {error === 'CAMERA_PERMISSION_DENIED' ? 'Necesitamos permiso de cámara.' : 'Ocurrió un problema. Puedes registrarlo a mano.'}
            </Text>
            <Button label="Registrar a mano" onPress={goManual} />
          </Card>
        )}

        {state === 'proposed' && proposal && (
          <>
            {proposal.restaurant && (
              <RestaurantBanner
                restaurant={proposal.restaurant}
                picked={menuPicked}
                onToggle={(i) => setMenuPicked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
              />
            )}
            <Proposal
              proposal={proposal}
              included={included}
              onToggle={(i) => setIncluded((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
            />
          </>
        )}

        {state === 'confirming' && (
          <Card className="items-center py-8"><ActivityIndicator color="#6366f1" /><Text className="text-text-muted text-sm mt-2">Registrando…</Text></Card>
        )}

        {state === 'proposed' && proposal && (
          <View className="mt-4 gap-2">
            {proposal.mode !== 'FALLBACK' && <Button label="Confirmar y registrar" onPress={onConfirm} />}
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

function Proposal({
  proposal, included, onToggle,
}: {
  proposal: NonNullable<ReturnType<typeof useVisionCapture>['proposal']>;
  included: Set<number>;
  onToggle: (i: number) => void;
}) {
  const mode = modeCopy(proposal.mode);
  const band = bandCopy(proposal.scanConfidence.band);
  return (
    <Card>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-text-primary text-base font-semibold">{mode.title}</Text>
        <Text className="text-xs font-semibold" style={{ color: band.color }}>{band.label}</Text>
      </View>
      <Text className="text-text-muted text-xs mb-3">{mode.hint}</Text>
      {proposal.candidates.length === 0 && (
        <Text className="text-text-muted text-sm py-2">No detectamos alimentos en la foto.</Text>
      )}
      {proposal.candidates.map((c) => (
        <CandidateRow key={c.detectionIndex} c={c} checked={included.has(c.detectionIndex)} onToggle={() => onToggle(c.detectionIndex)} />
      ))}
    </Card>
  );
}

function CandidateRow({ c, checked, onToggle }: { c: FoodCandidate; checked: boolean; onToggle: () => void }) {
  const matched = !!c.foodItemId;
  return (
    <TouchableOpacity
      className="flex-row items-center py-2.5 border-b border-border"
      onPress={matched ? onToggle : undefined}
      activeOpacity={matched ? 0.7 : 1}
    >
      <View className="w-6">
        {matched ? (
          <Text className="text-lg" style={{ color: checked ? '#6366f1' : '#475569' }}>{checked ? '☑' : '☐'}</Text>
        ) : (
          <Text className="text-lg text-text-muted">•</Text>
        )}
      </View>
      <View className="flex-1">
        <Text className="text-text-primary text-sm">{c.displayName}</Text>
        <Text className="text-text-muted text-[10px]">
          {matched ? `~${c.portion.grams}g${portionHint(c)}` : 'no reconocido — regístralo a mano'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * V3.4 — restaurant context banner. The backend decided whether the signal was
 * strong enough to show; this renders it. Menu dishes with published calories
 * are tappable (they log as one-off items on confirm); dishes without published
 * nutrition are name-only hints — the platform never invents a number to make
 * something tappable.
 */
function RestaurantBanner({
  restaurant, picked, onToggle,
}: {
  restaurant: RestaurantContext;
  picked: Set<number>;
  onToggle: (i: number) => void;
}) {
  return (
    <Card className="mb-3">
      <Text className="text-text-primary text-sm font-semibold">
        🍽️ {restaurant.restaurantName ?? 'Parece comida de restaurante'}
      </Text>
      <Text className="text-text-muted text-[10px] mb-1">
        {restaurant.category ? `Cocina: ${restaurant.category} · ` : ''}Contexto detectado en la foto — confírmalo tú.
      </Text>
      {restaurant.menuCandidates.length > 0 && (
        <>
          <Text className="text-text-muted text-xs mt-1 mb-1">¿Pediste alguno de estos platos del menú?</Text>
          {restaurant.menuCandidates.map((dish: MenuCandidate, i: number) => (
            <MenuDishRow key={`${dish.name}-${i}`} dish={dish} checked={picked.has(i)} onToggle={() => onToggle(i)} />
          ))}
        </>
      )}
    </Card>
  );
}

function MenuDishRow({ dish, checked, onToggle }: { dish: MenuCandidate; checked: boolean; onToggle: () => void }) {
  const loggable = dish.calories != null;
  return (
    <TouchableOpacity
      className="flex-row items-center py-2 border-b border-border"
      onPress={loggable ? onToggle : undefined}
      activeOpacity={loggable ? 0.7 : 1}
    >
      <View className="w-6">
        {loggable ? (
          <Text className="text-lg" style={{ color: checked ? '#6366f1' : '#475569' }}>{checked ? '☑' : '☐'}</Text>
        ) : (
          <Text className="text-lg text-text-muted">•</Text>
        )}
      </View>
      <View className="flex-1">
        <Text className="text-text-primary text-sm">{dish.name}</Text>
        <Text className="text-text-muted text-[10px]">
          {loggable
            ? `${dish.calories} kcal publicadas${dish.proteinG != null ? ` · P${dish.proteinG} C${dish.carbsG} G${dish.fatG}` : ' · sin macros publicados'}`
            : 'sin datos publicados — regístralo a mano'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * V3.3 — when the backend's portion engine leaned on the user's own history,
 * say so. The platform decided the grams; this only surfaces the why.
 */
function portionHint(c: FoodCandidate): string {
  if (c.portion.method === 'USER_PRIOR') return ' · según tu historial';
  if (c.portion.method === 'BLENDED') return ' · ajustado a tu historial';
  return '';
}
