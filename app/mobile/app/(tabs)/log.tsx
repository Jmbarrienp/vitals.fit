import { useState, useCallback } from 'react';
import {
  View, Text, KeyboardAvoidingView, Platform,
  ScrollView, Alert, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { useLogMeal } from '../../src/hooks/useNutrition';
import {
  useFoodSearch, useCommonFoods, useRecentFoods, useFrequentFoods,
  useFavoriteFoods, useToggleFavorite, useCreateCustomFood,
} from '../../src/hooks/useFood';
import { macrosFromPortion, type FoodItem } from '../../src/api/food';
import type { MealType } from '../../src/types';
import { FEATURES } from '../../src/config/features';

const MEAL_TYPES: { value: MealType; label: string; emoji: string }[] = [
  { value: 'BREAKFAST', label: 'Desayuno', emoji: '🌅' },
  { value: 'LUNCH', label: 'Almuerzo', emoji: '☀️' },
  { value: 'DINNER', label: 'Cena', emoji: '🌙' },
  { value: 'SNACK', label: 'Snack', emoji: '🍎' },
];

const PORTIONS = [
  { label: '50g', value: 50 },
  { label: '100g', value: 100 },
  { label: '150g', value: 150 },
  { label: '200g', value: 200 },
  { label: 'Otro', value: 0 },
];

/** Fila de alimento con macros, kcal y estrella de favorito (tap fila = seleccionar). */
function FoodRow({
  food, onPress, onToggleFav,
}: {
  food: FoodItem;
  onPress: () => void;
  onToggleFav: () => void;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center py-3 border-b border-border"
      onPress={onPress}
    >
      <View className="flex-1 mr-2">
        <Text className="text-text-primary text-sm font-medium">{food.name}</Text>
        <Text className="text-text-muted text-xs mt-0.5">
          P:{food.proteinPer100g}g · C:{food.carbsPer100g}g · G:{food.fatPer100g}g por 100g
        </Text>
      </View>
      <Text className="text-primary font-bold text-sm mr-2">{food.caloriesPer100g} kcal</Text>
      <TouchableOpacity
        onPress={onToggleFav}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        className="px-1"
      >
        <Text className="text-lg" style={{ color: food.isFavorite ? '#f59e0b' : '#475569' }}>
          {food.isFavorite ? '★' : '☆'}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

/** Sección de acceso rápido (Favoritos / Recientes / Frecuentes). Oculta si vacía. */
function QuickSection({
  title, icon, foods, onPick, onToggleFav,
}: {
  title: string;
  icon: string;
  foods?: FoodItem[];
  onPick: (f: FoodItem) => void;
  onToggleFav: (f: FoodItem) => void;
}) {
  if (!foods || foods.length === 0) return null;
  return (
    <View className="mb-4">
      <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-1">
        {icon} {title}
      </Text>
      {foods.slice(0, 6).map((f) => (
        <FoodRow key={f.id} food={f} onPress={() => onPick(f)} onToggleFav={() => onToggleFav(f)} />
      ))}
    </View>
  );
}

export default function LogScreen() {
  const router = useRouter();
  const [mealType, setMealType] = useState<MealType>('BREAKFAST');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [portionG, setPortionG] = useState(100);
  const [customPortion, setCustomPortion] = useState('');
  const [showCustomPortion, setShowCustomPortion] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [saved, setSaved] = useState(false);

  const [manualName, setManualName] = useState('');
  const [manualCal, setManualCal] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  // Custom food creator (valores por 100g)
  const [showCustomFood, setShowCustomFood] = useState(false);
  const [cfName, setCfName] = useState('');
  const [cfCal, setCfCal] = useState('');
  const [cfProtein, setCfProtein] = useState('');
  const [cfCarbs, setCfCarbs] = useState('');
  const [cfFat, setCfFat] = useState('');

  const { mutate: logMeal, isPending } = useLogMeal();
  const { data: searchResults, isFetching } = useFoodSearch(searchQuery);
  const { data: commonFoods } = useCommonFoods();
  const { data: recentFoods } = useRecentFoods();
  const { data: frequentFoods } = useFrequentFoods();
  const { data: favoriteFoods } = useFavoriteFoods();
  const { mutate: toggleFavorite } = useToggleFavorite();
  const { mutate: createCustomFood, isPending: creatingCustom } = useCreateCustomFood();

  const isSearching = searchQuery.trim().length >= 2 && isFetching;
  const showResults = !selectedFood && searchQuery.trim().length >= 2;
  const showQuickAccess = !selectedFood && searchQuery.trim().length < 2;

  const activePortion = showCustomPortion ? parseInt(customPortion) || 0 : portionG;
  const macros =
    selectedFood && activePortion > 0 ? macrosFromPortion(selectedFood, activePortion) : null;

  const onToggleFav = (food: FoodItem) =>
    toggleFavorite({ id: food.id, next: !food.isFavorite });

  const selectFood = useCallback((food: FoodItem) => {
    setSelectedFood(food);
    setSearchQuery(food.name);
    setPortionG(100);
    setShowCustomPortion(false);
    setShowManual(false);
  }, []);

  const onSuccess = () => {
    resetForm();
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.push('/(tabs)/dashboard');
    }, 1200);
  };

  const onError = () => Alert.alert('Error', 'No se pudo guardar. Intenta de nuevo.');

  const handleLog = () => {
    if (showManual) {
      const cal = parseInt(manualCal);
      if (!cal || cal <= 0) {
        Alert.alert('Faltan datos', 'Ingresa al menos las calorías.');
        return;
      }
      logMeal(
        {
          mealType,
          name: manualName.trim() || undefined,
          totalCalories: cal,
          totalProteinG: parseFloat(manualProtein) || 0,
          totalCarbsG: parseFloat(manualCarbs) || 0,
          totalFatG: parseFloat(manualFat) || 0,
        },
        { onSuccess, onError },
      );
      return;
    }

    if (!selectedFood || activePortion <= 0) {
      Alert.alert(
        'Selecciona un alimento',
        'Busca y selecciona un alimento, o usa el modo manual.',
      );
      return;
    }
    // Nuevo flujo: enviamos el ítem de catálogo; el backend calcula macros y guarda foodItemId.
    logMeal(
      {
        mealType,
        name: `${selectedFood.name} (${activePortion} g)`,
        items: [{ foodItemId: selectedFood.id, quantity: activePortion, unit: 'g' }],
      },
      { onSuccess, onError },
    );
  };

  const handleCreateCustomFood = () => {
    const cal = parseInt(cfCal);
    if (!cfName.trim() || !cal || cal <= 0) {
      Alert.alert('Faltan datos', 'Ingresa nombre y calorías por 100g.');
      return;
    }
    createCustomFood(
      {
        name: cfName.trim(),
        caloriesPer100g: cal,
        proteinPer100g: parseFloat(cfProtein) || 0,
        carbsPer100g: parseFloat(cfCarbs) || 0,
        fatPer100g: parseFloat(cfFat) || 0,
      },
      {
        onSuccess: (food) => {
          setCfName(''); setCfCal(''); setCfProtein(''); setCfCarbs(''); setCfFat('');
          setShowCustomFood(false);
          setShowManual(false);
          selectFood(food); // queda listo para elegir porción y guardar
        },
        onError: () => Alert.alert('Error', 'No se pudo crear el alimento.'),
      },
    );
  };

  const resetForm = () => {
    setSearchQuery('');
    setSelectedFood(null);
    setManualName('');
    setManualCal('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');
    setPortionG(100);
    setShowManual(false);
    setShowCustomPortion(false);
  };

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

          {/* Header */}
          <Text className="text-text-primary text-2xl font-bold mb-1">Registrar comida</Text>
          <Text className="text-text-muted text-sm mb-5">
            Busca un alimento o ingresa manualmente
          </Text>

          {/* ── Nutrition Vision V1: camera capture (feature-flagged; off by default) ── */}
          {FEATURES.visionCapture && (
            <TouchableOpacity
              className="bg-primary/10 border border-primary/30 rounded-2xl py-3.5 px-4 mb-3 flex-row items-center justify-center gap-2"
              activeOpacity={0.8}
              onPress={() => router.push('/scan' as never)} // typed routes regenerate on `expo start`
            >
              <Text className="text-primary font-semibold text-sm">📷 Escanear comida con la cámara</Text>
            </TouchableOpacity>
          )}

          {/* ── Nutrition Vision V3.1: barcode scan (feature-flagged independently; off by default) ── */}
          {FEATURES.barcodeScan && (
            <TouchableOpacity
              className="bg-primary/10 border border-primary/30 rounded-2xl py-3.5 px-4 mb-3 flex-row items-center justify-center gap-2"
              activeOpacity={0.8}
              onPress={() => router.push('/scan-barcode' as never)} // typed routes regenerate on `expo start`
            >
              <Text className="text-primary font-semibold text-sm">📦 Escanear código de barras</Text>
            </TouchableOpacity>
          )}

          {/* ── Nutrition Vision V3.2: nutrition label OCR (feature-flagged independently; off by default) ── */}
          {FEATURES.labelScan && (
            <TouchableOpacity
              className="bg-primary/10 border border-primary/30 rounded-2xl py-3.5 px-4 mb-5 flex-row items-center justify-center gap-2"
              activeOpacity={0.8}
              onPress={() => router.push('/scan-label' as never)} // typed routes regenerate on `expo start`
            >
              <Text className="text-primary font-semibold text-sm">🏷️ Escanear etiqueta nutricional</Text>
            </TouchableOpacity>
          )}

          {/* ── Success banner ── */}
          {saved && (
            <View className="bg-green-500/15 border border-green-500/30 rounded-2xl py-3 px-4 mb-5 flex-row items-center gap-2">
              <Text className="text-green-400 font-semibold">✅ Comida guardada</Text>
            </View>
          )}

          {/* Meal type */}
          <View className="flex-row gap-2 mb-5">
            {MEAL_TYPES.map((m) => (
              <TouchableOpacity
                key={m.value}
                className={`flex-1 py-3 rounded-2xl items-center border ${
                  mealType === m.value ? 'bg-primary border-primary' : 'bg-surface border-border'
                }`}
                onPress={() => setMealType(m.value)}
              >
                <Text className="text-lg">{m.emoji}</Text>
                <Text
                  className={`text-xs mt-1 font-semibold ${
                    mealType === m.value ? 'text-white' : 'text-text-secondary'
                  }`}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Mode toggle */}
          <View className="flex-row gap-2 mb-5">
            <TouchableOpacity
              className={`flex-1 py-3 rounded-2xl items-center border ${
                !showManual ? 'bg-primary/10 border-primary' : 'bg-surface border-border'
              }`}
              onPress={() => setShowManual(false)}
            >
              <Text
                className={`text-sm font-semibold ${
                  !showManual ? 'text-primary' : 'text-text-secondary'
                }`}
              >
                🔍 Buscar
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 py-3 rounded-2xl items-center border ${
                showManual ? 'bg-primary/10 border-primary' : 'bg-surface border-border'
              }`}
              onPress={() => setShowManual(true)}
            >
              <Text
                className={`text-sm font-semibold ${
                  showManual ? 'text-primary' : 'text-text-secondary'
                }`}
              >
                ✏️ Manual
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── SEARCH MODE ── */}
          {!showManual && (
            <>
              <Card className="mb-4">
                <View className="flex-row items-center bg-background rounded-xl px-3 py-2 border border-border">
                  <Text className="text-text-muted mr-2">🔍</Text>
                  <TextInput
                    className="flex-1 text-text-primary text-base"
                    placeholder="Buscar alimento (ej: pollo, arroz...)"
                    placeholderTextColor="#64748b"
                    value={searchQuery}
                    onChangeText={(t) => {
                      setSearchQuery(t);
                      if (selectedFood && t !== selectedFood.name) setSelectedFood(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {isSearching && <ActivityIndicator size="small" color="#6366f1" />}
                  {searchQuery.length > 0 && !isSearching && (
                    <TouchableOpacity
                      onPress={() => {
                        setSearchQuery('');
                        setSelectedFood(null);
                      }}
                    >
                      <Text className="text-text-muted text-lg">×</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {showResults && searchResults && searchResults.length > 0 && (
                  <View className="mt-3">
                    <Text className="text-text-muted text-xs mb-2">
                      {searchResults.length} resultado{searchResults.length !== 1 ? 's' : ''}
                    </Text>
                    {searchResults.slice(0, 12).map((food) => (
                      <FoodRow
                        key={food.id}
                        food={food}
                        onPress={() => selectFood(food)}
                        onToggleFav={() => onToggleFav(food)}
                      />
                    ))}
                  </View>
                )}

                {showResults &&
                  !isSearching &&
                  (!searchResults || searchResults.length === 0) && (
                    <View className="py-4 items-center">
                      <Text className="text-text-muted text-sm">
                        Sin resultados para "{searchQuery}"
                      </Text>
                      <TouchableOpacity onPress={() => setShowManual(true)}>
                        <Text className="text-primary text-sm mt-2">Ingresar manualmente →</Text>
                      </TouchableOpacity>
                    </View>
                  )}
              </Card>

              {/* ── Acceso rápido: Favoritos / Recientes / Frecuentes / Comunes ── */}
              {showQuickAccess && (
                <Card className="mb-4">
                  <QuickSection
                    title="Favoritos" icon="⭐" foods={favoriteFoods}
                    onPick={selectFood} onToggleFav={onToggleFav}
                  />
                  <QuickSection
                    title="Recientes" icon="🕘" foods={recentFoods}
                    onPick={selectFood} onToggleFav={onToggleFav}
                  />
                  <QuickSection
                    title="Frecuentes" icon="🔁" foods={frequentFoods}
                    onPick={selectFood} onToggleFav={onToggleFav}
                  />
                  <QuickSection
                    title="Comunes" icon="🍽️" foods={commonFoods}
                    onPick={selectFood} onToggleFav={onToggleFav}
                  />
                  <TouchableOpacity
                    className="mt-1 py-2 items-center"
                    onPress={() => setShowCustomFood((v) => !v)}
                  >
                    <Text className="text-primary text-sm font-semibold">
                      {showCustomFood ? '× Cancelar' : '➕ Crear alimento propio'}
                    </Text>
                  </TouchableOpacity>

                  {showCustomFood && (
                    <View className="mt-2 pt-3 border-t border-border">
                      <Text className="text-text-muted text-xs mb-3">
                        Valores por cada 100g. Quedará guardado para registrarlo después.
                      </Text>
                      <Input
                        label="Nombre *"
                        value={cfName}
                        onChangeText={setCfName}
                        placeholder="Ej: Granola casera"
                      />
                      <Input
                        label="Calorías / 100g *"
                        value={cfCal}
                        onChangeText={setCfCal}
                        placeholder="471"
                        keyboardType="numeric"
                      />
                      <View className="flex-row gap-3">
                        <View className="flex-1">
                          <Input
                            label="Prot. / 100g"
                            value={cfProtein}
                            onChangeText={setCfProtein}
                            placeholder="10"
                            keyboardType="decimal-pad"
                          />
                        </View>
                        <View className="flex-1">
                          <Input
                            label="Carbs / 100g"
                            value={cfCarbs}
                            onChangeText={setCfCarbs}
                            placeholder="64"
                            keyboardType="decimal-pad"
                          />
                        </View>
                        <View className="flex-1">
                          <Input
                            label="Grasa / 100g"
                            value={cfFat}
                            onChangeText={setCfFat}
                            placeholder="20"
                            keyboardType="decimal-pad"
                          />
                        </View>
                      </View>
                      <Button
                        label="Crear y usar"
                        loading={creatingCustom}
                        onPress={handleCreateCustomFood}
                      />
                    </View>
                  )}
                </Card>
              )}

              {selectedFood && (
                <Card className="mb-4 border-primary/30">
                  <View className="flex-row items-start justify-between mb-4">
                    <View className="flex-1 mr-3">
                      <Text className="text-primary font-bold text-base">{selectedFood.name}</Text>
                      <Text className="text-text-muted text-xs mt-0.5">
                        {selectedFood.caloriesPer100g} kcal · P:{selectedFood.proteinPer100g}g ·
                        C:{selectedFood.carbsPer100g}g · G:{selectedFood.fatPer100g}g por 100g
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedFood(null);
                        setSearchQuery('');
                      }}
                    >
                      <Text className="text-text-muted text-xl">×</Text>
                    </TouchableOpacity>
                  </View>

                  <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
                    Porción
                  </Text>
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {PORTIONS.map((p) => {
                      const isActive =
                        (p.value !== 0 && !showCustomPortion && portionG === p.value) ||
                        (p.value === 0 && showCustomPortion);
                      return (
                        <TouchableOpacity
                          key={p.label}
                          className={`px-4 py-2 rounded-xl border ${
                            isActive ? 'bg-primary border-primary' : 'bg-surface border-border'
                          }`}
                          onPress={() => {
                            if (p.value === 0) setShowCustomPortion(true);
                            else {
                              setPortionG(p.value);
                              setShowCustomPortion(false);
                            }
                          }}
                        >
                          <Text
                            className={`text-sm font-semibold ${
                              isActive ? 'text-white' : 'text-text-secondary'
                            }`}
                          >
                            {p.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {showCustomPortion && (
                    <TextInput
                      className="bg-background border border-border rounded-xl px-4 py-3 text-text-primary text-base mb-3"
                      placeholder="Ej: 175 (en gramos)"
                      placeholderTextColor="#64748b"
                      value={customPortion}
                      onChangeText={setCustomPortion}
                      keyboardType="numeric"
                      autoFocus
                    />
                  )}

                  {macros && activePortion > 0 && (
                    <View className="bg-background rounded-xl p-3 flex-row justify-between">
                      <View className="items-center flex-1">
                        <Text className="text-primary font-bold text-lg">{macros.calories}</Text>
                        <Text className="text-text-muted text-xs">kcal</Text>
                      </View>
                      <View className="items-center flex-1">
                        <Text className="text-macro-protein font-bold">{macros.proteinG}g</Text>
                        <Text className="text-text-muted text-xs">proteína</Text>
                      </View>
                      <View className="items-center flex-1">
                        <Text className="text-macro-carbs font-bold">{macros.carbsG}g</Text>
                        <Text className="text-text-muted text-xs">carbos</Text>
                      </View>
                      <View className="items-center flex-1">
                        <Text className="text-macro-fat font-bold">{macros.fatG}g</Text>
                        <Text className="text-text-muted text-xs">grasa</Text>
                      </View>
                    </View>
                  )}
                </Card>
              )}
            </>
          )}

          {/* ── MANUAL MODE ── */}
          {showManual && (
            <Card className="mb-4">
              <Input
                label="Nombre (opcional)"
                value={manualName}
                onChangeText={setManualName}
                placeholder="Ej: Pollo con arroz"
              />
              <Input
                label="Calorías *"
                value={manualCal}
                onChangeText={setManualCal}
                placeholder="550"
                keyboardType="numeric"
              />
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">
                Macros (opcional)
              </Text>
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    label="Proteína (g)"
                    value={manualProtein}
                    onChangeText={setManualProtein}
                    placeholder="45"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Carbos (g)"
                    value={manualCarbs}
                    onChangeText={setManualCarbs}
                    placeholder="60"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View className="flex-1">
                  <Input
                    label="Grasa (g)"
                    value={manualFat}
                    onChangeText={setManualFat}
                    placeholder="10"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </Card>
          )}

          <Button label="Guardar comida" loading={isPending} onPress={handleLog} />

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
