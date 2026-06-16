import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useTodayLog, useUpdateMeal, useDeleteMeal, useDeleteMealItem,
} from '../../src/hooks/useNutrition';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import type { DailyLog, LoggedMeal, LoggedMealItem, MealType } from '../../src/types';

const MEAL_META: Record<MealType, { label: string; emoji: string }> = {
  BREAKFAST: { label: 'Desayuno', emoji: '🌅' },
  LUNCH: { label: 'Almuerzo', emoji: '☀️' },
  DINNER: { label: 'Cena', emoji: '🌙' },
  SNACK: { label: 'Snack', emoji: '🍎' },
};
const MEAL_ORDER: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];

/** Mensaje de error según el status HTTP (o falta de red). */
function errorMessage(error: unknown, fallback: string) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 404) return 'Esta comida ya no existe. Actualizamos tu día.';
  if (status === 403) return 'No tienes permiso para modificar esta comida.';
  if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (!status) return 'Sin conexión. Verifica tu internet e intenta de nuevo.';
  return fallback;
}
const statusOf = (error: unknown) =>
  (error as { response?: { status?: number } })?.response?.status;

export default function MealDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: today, isLoading } = useTodayLog();
  const updateMeal = useUpdateMeal();
  const deleteMeal = useDeleteMeal();
  const deleteItem = useDeleteMealItem();

  const meal: LoggedMeal | undefined = (today as DailyLog | undefined)?.meals?.find(
    (m) => m.id === id,
  );

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [mealType, setMealType] = useState<MealType>('BREAKFAST');
  const [cal, setCal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const startEdit = () => {
    if (!meal) return;
    setName(meal.name ?? '');
    setMealType(meal.mealType);
    setCal(String(meal.totalCalories));
    setProtein(String(Math.round(meal.totalProteinG)));
    setCarbs(String(Math.round(meal.totalCarbsG)));
    setFat(String(Math.round(meal.totalFatG)));
    setEditing(true);
  };

  const onSave = () => {
    if (!meal) return;
    const calNum = parseInt(cal);
    if (!calNum || calNum <= 0) {
      Alert.alert('Faltan datos', 'Ingresa al menos las calorías.');
      return;
    }
    updateMeal.mutate(
      {
        id: meal.id,
        data: {
          mealType,
          name: name.trim() || undefined,
          totalCalories: calNum,
          totalProteinG: parseFloat(protein) || 0,
          totalCarbsG: parseFloat(carbs) || 0,
          totalFatG: parseFloat(fat) || 0,
        },
      },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => {
          if (statusOf(e) === 404) { router.back(); return; }
          Alert.alert('Error', errorMessage(e, 'No se pudo guardar la comida.'));
        },
      },
    );
  };

  const onDeleteMeal = () => {
    if (!meal) return;
    Alert.alert(
      'Borrar comida',
      `¿Seguro que quieres borrar "${meal.name}"? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () =>
            deleteMeal.mutate(meal.id, {
              onSuccess: () => router.back(),
              onError: (e) => {
                if (statusOf(e) === 404) { router.back(); return; }
                Alert.alert('Error', errorMessage(e, 'No se pudo borrar la comida.'));
              },
            }),
        },
      ],
    );
  };

  const onDeleteItem = (item: LoggedMealItem) => {
    if (!meal) return;
    const isLast = (meal.items?.length ?? 0) <= 1;
    Alert.alert(
      'Borrar ítem',
      isLast
        ? 'Es el único ítem de esta comida, así que se borrará la comida completa. ¿Continuar?'
        : `¿Borrar "${item.nameSnapshot || 'este ítem'}" de la comida?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () =>
            deleteItem.mutate(
              { mealId: meal.id, itemId: item.id },
              {
                onSuccess: () => { if (isLast) router.back(); },
                onError: (e) => {
                  if (statusOf(e) === 404) { router.back(); return; }
                  Alert.alert('Error', errorMessage(e, 'No se pudo borrar el ítem.'));
                },
              },
            ),
        },
      ],
    );
  };

  if (isLoading && !today) {
    return <LoadingScreen message="Cargando comida..." />;
  }

  if (!meal) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-4xl mb-3">🤔</Text>
        <Text className="text-text-primary font-semibold text-base mb-2 text-center">
          Esta comida ya no existe
        </Text>
        <Text className="text-text-muted text-sm text-center mb-6">
          Puede que la hayas borrado o que ya no esté en el día de hoy.
        </Text>
        <View className="w-48">
          <Button label="Volver" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const meta = MEAL_META[meal.mealType];
  const time = new Date(meal.loggedAt).toLocaleTimeString('es', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const items = meal.items ?? [];
  const busy = updateMeal.isPending || deleteMeal.isPending || deleteItem.isPending;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="px-5 pt-14 pb-10">

          {/* ── Header ── */}
          <TouchableOpacity onPress={() => router.back()} className="mb-4">
            <Text className="text-primary text-base">‹ Volver</Text>
          </TouchableOpacity>

          <View className="flex-row items-center mb-1">
            <Text className="text-2xl mr-2">{meta.emoji}</Text>
            <View className="flex-1">
              <Text className="text-text-primary text-2xl font-bold">{meal.name}</Text>
              <Text className="text-text-muted text-sm mt-0.5">
                {meta.label} · {time}
              </Text>
            </View>
          </View>

          {/* ── Totals ── */}
          <Card className="my-4">
            <View className="flex-row justify-between">
              <View className="items-center flex-1">
                <Text className="text-primary font-bold text-lg">{meal.totalCalories}</Text>
                <Text className="text-text-muted text-xs">kcal</Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-macro-protein font-bold">
                  {Math.round(meal.totalProteinG)}g
                </Text>
                <Text className="text-text-muted text-xs">proteína</Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-macro-carbs font-bold">
                  {Math.round(meal.totalCarbsG)}g
                </Text>
                <Text className="text-text-muted text-xs">carbos</Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-macro-fat font-bold">{Math.round(meal.totalFatG)}g</Text>
                <Text className="text-text-muted text-xs">grasa</Text>
              </View>
            </View>
          </Card>

          {/* ── Items ── */}
          {items.length > 0 && (
            <View className="mb-4">
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
                Ítems
              </Text>
              <View className="gap-2">
                {items.map((item) => (
                  <Card key={item.id} className="flex-row items-center">
                    <View className="flex-1 mr-3">
                      <Text className="text-text-primary font-medium text-sm">
                        {item.nameSnapshot || 'Ítem'}
                      </Text>
                      <Text className="text-text-muted text-xs mt-0.5">
                        {item.amountG > 0 ? `${Math.round(item.amountG)}g · ` : ''}
                        {item.calories} kcal · P:{Math.round(item.proteinG)}g · C:
                        {Math.round(item.carbsG)}g · G:{Math.round(item.fatG)}g
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => onDeleteItem(item)}
                      disabled={busy}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      className="px-2 py-1"
                    >
                      <Text className="text-danger text-lg">🗑️</Text>
                    </TouchableOpacity>
                  </Card>
                ))}
              </View>
            </View>
          )}

          {/* ── Edit form ── */}
          {editing ? (
            <Card className="mb-4">
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">
                Editar comida
              </Text>

              <View className="flex-row gap-2 mb-4">
                {MEAL_ORDER.map((mt) => (
                  <TouchableOpacity
                    key={mt}
                    className={`flex-1 py-2 rounded-xl items-center border ${
                      mealType === mt ? 'bg-primary border-primary' : 'bg-surface border-border'
                    }`}
                    onPress={() => setMealType(mt)}
                  >
                    <Text className="text-base">{MEAL_META[mt].emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Input
                label="Nombre"
                value={name}
                onChangeText={setName}
                placeholder="Ej: Pollo con arroz"
              />
              <Input
                label="Calorías *"
                value={cal}
                onChangeText={setCal}
                placeholder="550"
                keyboardType="numeric"
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label="Proteína (g)"
                    value={protein}
                    onChangeText={setProtein}
                    placeholder="45"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Carbos (g)"
                    value={carbs}
                    onChangeText={setCarbs}
                    placeholder="60"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Grasa (g)"
                    value={fat}
                    onChangeText={setFat}
                    placeholder="10"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              <View className="flex-row gap-3 mt-1">
                <View className="flex-1">
                  <Button
                    label="Cancelar"
                    variant="outline"
                    onPress={() => setEditing(false)}
                    disabled={busy}
                  />
                </View>
                <View className="flex-1">
                  <Button label="Guardar" loading={updateMeal.isPending} onPress={onSave} />
                </View>
              </View>
            </Card>
          ) : (
            <View className="gap-3">
              <Button label="✏️ Editar comida" variant="outline" onPress={startEdit} disabled={busy} />
              <TouchableOpacity
                className="rounded-xl py-4 items-center justify-center border border-danger"
                onPress={onDeleteMeal}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Text className="text-danger font-semibold text-base">🗑️ Borrar comida</Text>
              </TouchableOpacity>
            </View>
          )}

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
