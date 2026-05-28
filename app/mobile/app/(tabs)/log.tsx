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
import { useFoodSearch, useCommonFoods } from '../../src/hooks/useFood';
import { macrosFromPortion, type FoodItem } from '../../src/api/food';
import type { MealType } from '../../src/types';

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

  const { mutate: logMeal, isPending } = useLogMeal();
  const { data: searchResults, isFetching } = useFoodSearch(searchQuery);
  const { data: commonFoods } = useCommonFoods();

  const displayedFoods = searchQuery.trim().length >= 2 ? searchResults : commonFoods;
  const isSearching = searchQuery.trim().length >= 2 && isFetching;

  const activePortion = showCustomPortion ? parseInt(customPortion) || 0 : portionG;
  const macros =
    selectedFood && activePortion > 0 ? macrosFromPortion(selectedFood, activePortion) : null;

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
    logMeal(
      {
        mealType,
        name: `${selectedFood.name} (${activePortion}g)`,
        totalCalories: macros!.calories,
        totalProteinG: macros!.proteinG,
        totalCarbsG: macros!.carbsG,
        totalFatG: macros!.fatG,
      },
      { onSuccess, onError },
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

                {!selectedFood && displayedFoods && displayedFoods.length > 0 && (
                  <View className="mt-3">
                    <Text className="text-text-muted text-xs mb-2">
                      {searchQuery.trim().length >= 2
                        ? `${displayedFoods.length} resultado${displayedFoods.length !== 1 ? 's' : ''}`
                        : 'Alimentos frecuentes'}
                    </Text>
                    {displayedFoods.slice(0, 8).map((food) => (
                      <TouchableOpacity
                        key={food.id}
                        className="flex-row items-center py-3 border-b border-border"
                        onPress={() => selectFood(food)}
                      >
                        <View className="flex-1">
                          <Text className="text-text-primary text-sm font-medium">{food.name}</Text>
                          <Text className="text-text-muted text-xs mt-0.5">
                            P:{food.proteinPer100g}g · C:{food.carbsPer100g}g · G:{food.fatPer100g}
                            g por 100g
                          </Text>
                        </View>
                        <Text className="text-primary font-bold text-sm ml-3">
                          {food.caloriesPer100g} kcal
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {!selectedFood &&
                  searchQuery.trim().length >= 2 &&
                  !isSearching &&
                  (!displayedFoods || displayedFoods.length === 0) && (
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
