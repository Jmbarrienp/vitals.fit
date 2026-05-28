import { useState } from 'react';
import {
  View, Text, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Input } from '../src/components/Input';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { useUpdateProfile } from '../src/hooks/useProfile';
import { useCreateGoal, useCalculateNutrition } from '../src/hooks/useNutrition';
import type { GoalType } from '../src/types';

const TOTAL_STEPS = 2;

const ACTIVITY_OPTIONS = [
  { value: 'SEDENTARY', label: 'Sedentario', desc: 'Trabajo de escritorio, sin ejercicio', emoji: '💺' },
  { value: 'LIGHT', label: 'Ligero', desc: 'Ejercicio 1–3 días por semana', emoji: '🚶' },
  { value: 'MODERATE', label: 'Moderado', desc: 'Ejercicio 3–5 días por semana', emoji: '🏃' },
  { value: 'ACTIVE', label: 'Muy activo', desc: 'Ejercicio intenso 6–7 días', emoji: '🏋️' },
];

const GOAL_OPTIONS: { value: GoalType; label: string; desc: string; emoji: string; color: string }[] = [
  { value: 'LOSE_FAT', label: 'Bajar grasa', desc: 'Déficit calórico controlado', emoji: '🔥', color: '#ef4444' },
  { value: 'GAIN_MUSCLE', label: 'Ganar músculo', desc: 'Superávit para hipertrofia', emoji: '💪', color: '#22c55e' },
  { value: 'MAINTAIN', label: 'Mantenerme', desc: 'Calorías de mantenimiento', emoji: '⚖️', color: '#6366f1' },
  { value: 'RECOMPOSITION', label: 'Recomposición', desc: 'Perder grasa y ganar músculo', emoji: '⚡', color: '#f59e0b' },
];

const ACTIVITY_FACTORS: Record<string, number> = {
  SEDENTARY: 1.2, LIGHT: 1.375, MODERATE: 1.55, ACTIVE: 1.725,
};

const GOAL_ADJUSTMENTS: Record<string, number> = {
  LOSE_FAT: -350, GAIN_MUSCLE: 250, MAINTAIN: 0, RECOMPOSITION: -150,
};

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE'>('MALE');

  const [activityLevel, setActivityLevel] = useState('MODERATE');
  const [goalType, setGoalType] = useState<GoalType>('LOSE_FAT');

  const { mutate: updateProfile, isPending: savingProfile } = useUpdateProfile();
  const { mutate: createGoal, isPending: savingGoal } = useCreateGoal();
  const { mutate: calculate, isPending: calculating } = useCalculateNutrition();

  const isLoading = savingProfile || savingGoal || calculating;

  // Live BMR/TDEE calculation
  const w = parseFloat(weightKg) || 0;
  const h = parseFloat(heightCm) || 0;
  const a = parseInt(age) || 0;
  const bmr = w > 0 && h > 0 && a > 0
    ? Math.round(sex === 'MALE'
        ? 10 * w + 6.25 * h - 5 * a + 5
        : 10 * w + 6.25 * h - 5 * a - 161)
    : null;
  const tdee = bmr ? Math.round(bmr * (ACTIVITY_FACTORS[activityLevel] ?? 1.55)) : null;
  const targetCalories = tdee ? tdee + (GOAL_ADJUSTMENTS[goalType] ?? 0) : null;

  // Validate step 1
  const validateStep1 = () => {
    if (!name.trim()) { Alert.alert('Falta el nombre'); return false; }
    const ageN = parseInt(age);
    if (!ageN || ageN < 13 || ageN > 100) { Alert.alert('Edad inválida', 'Debe ser entre 13 y 100 años.'); return false; }
    const wN = parseFloat(weightKg);
    if (!wN || wN < 30 || wN > 300) { Alert.alert('Peso inválido', 'Debe ser entre 30 y 300 kg.'); return false; }
    const hN = parseFloat(heightCm);
    if (!hN || hN < 100 || hN > 250) { Alert.alert('Altura inválida', 'Debe ser entre 100 y 250 cm.'); return false; }
    return true;
  };

  const handleFinish = () => {
    updateProfile(
      {
        name: name.trim(),
        age: parseInt(age),
        weightKg: parseFloat(weightKg),
        heightCm: parseFloat(heightCm),
        sex,
        activityLevel: activityLevel as any,
        fitnessLevel: 'BEGINNER',
      },
      {
        onSuccess: () => {
          createGoal(
            { type: goalType },
            {
              onSuccess: () => {
                calculate(undefined, {
                  onSuccess: () => router.replace('/(tabs)/dashboard'),
                  onError: () => router.replace('/(tabs)/dashboard'),
                });
              },
              onError: () => Alert.alert('Error', 'No se pudo crear el objetivo.'),
            },
          );
        },
        onError: () => Alert.alert('Error', 'No se pudo guardar el perfil.'),
      },
    );
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
        <View className="flex-1 px-5 pt-14 pb-10">

          {/* Progress dots */}
          <View className="flex-row items-center gap-2 mb-8">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i < step ? 'bg-primary flex-1' : 'bg-border w-6'
                }`}
                style={{ flex: i < step ? 1 : undefined, width: i < step ? undefined : 24 }}
              />
            ))}
          </View>

          {/* ── STEP 1 — Datos biométricos ── */}
          {step === 1 && (
            <View className="flex-1">
              <Text className="text-text-muted text-sm mb-1">Paso 1 de 2</Text>
              <Text className="text-text-primary text-2xl font-bold mb-1">Tu perfil físico</Text>
              <Text className="text-text-secondary text-sm mb-8 leading-5">
                Usamos estos datos para calcular tu gasto calórico real con la fórmula Mifflin-St Jeor.
              </Text>

              <Input label="Tu nombre" value={name} onChangeText={setName} placeholder="José" autoCapitalize="words" />

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input label="Edad" value={age} onChangeText={setAge} placeholder="25" keyboardType="numeric" />
                </View>
                <View className="flex-1">
                  <Input label="Peso (kg)" value={weightKg} onChangeText={setWeightKg} placeholder="75" keyboardType="decimal-pad" />
                </View>
                <View className="flex-1">
                  <Input label="Altura (cm)" value={heightCm} onChangeText={setHeightCm} placeholder="175" keyboardType="numeric" />
                </View>
              </View>

              {/* Sex */}
              <Text className="text-text-secondary text-sm mb-2 font-medium">Sexo biológico</Text>
              <View className="flex-row gap-3 mb-6">
                {(['MALE', 'FEMALE'] as const).map((s) => (
                  <TouchableOpacity
                    key={s}
                    className={`flex-1 py-4 rounded-2xl items-center border ${
                      sex === s ? 'bg-primary border-primary' : 'bg-surface border-border'
                    }`}
                    onPress={() => setSex(s)}
                    activeOpacity={0.8}
                  >
                    <Text className="text-2xl mb-1">{s === 'MALE' ? '♂️' : '♀️'}</Text>
                    <Text className={`text-sm font-semibold ${sex === s ? 'text-white' : 'text-text-secondary'}`}>
                      {s === 'MALE' ? 'Hombre' : 'Mujer'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Live BMR preview */}
              {bmr && (
                <Card className="mb-6 border-primary/20 bg-primary/5">
                  <Text className="text-text-secondary text-xs mb-1">Metabolismo basal estimado</Text>
                  <Text className="text-primary text-3xl font-bold">{bmr} <Text className="text-lg">kcal</Text></Text>
                  <Text className="text-text-muted text-xs mt-1">Fórmula Mifflin-St Jeor · lo que quemas sin moverse</Text>
                </Card>
              )}

              <Button
                label="Continuar →"
                onPress={() => { if (validateStep1()) setStep(2); }}
              />
            </View>
          )}

          {/* ── STEP 2 — Objetivo y actividad ── */}
          {step === 2 && (
            <View className="flex-1">
              <Text className="text-text-muted text-sm mb-1">Paso 2 de 2</Text>
              <Text className="text-text-primary text-2xl font-bold mb-1">Tu objetivo</Text>
              <Text className="text-text-secondary text-sm mb-6 leading-5">
                Define tu nivel de actividad y objetivo. El sistema ajustará tus calorías automáticamente.
              </Text>

              {/* Activity */}
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">
                Nivel de actividad
              </Text>
              <View className="gap-2 mb-6">
                {ACTIVITY_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    className={`flex-row items-center p-4 rounded-2xl border ${
                      activityLevel === opt.value ? 'bg-primary/10 border-primary' : 'bg-surface border-border'
                    }`}
                    onPress={() => setActivityLevel(opt.value)}
                    activeOpacity={0.8}
                  >
                    <Text className="text-2xl mr-3">{opt.emoji}</Text>
                    <View className="flex-1">
                      <Text className={`font-semibold text-sm ${activityLevel === opt.value ? 'text-primary' : 'text-text-primary'}`}>
                        {opt.label}
                      </Text>
                      <Text className="text-text-muted text-xs mt-0.5">{opt.desc}</Text>
                    </View>
                    {activityLevel === opt.value && (
                      <View className="w-5 h-5 rounded-full bg-primary items-center justify-center">
                        <Text className="text-white text-xs">✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Goal */}
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-3">
                ¿Cuál es tu objetivo?
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-6">
                {GOAL_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    className={`rounded-2xl p-4 border items-center ${
                      goalType === opt.value ? 'border-2' : 'bg-surface border-border'
                    }`}
                    style={{
                      width: '48%',
                      backgroundColor: goalType === opt.value ? `${opt.color}15` : undefined,
                      borderColor: goalType === opt.value ? opt.color : undefined,
                    }}
                    onPress={() => setGoalType(opt.value)}
                    activeOpacity={0.8}
                  >
                    <Text className="text-2xl mb-2">{opt.emoji}</Text>
                    <Text
                      className="font-bold text-sm text-center"
                      style={{ color: goalType === opt.value ? opt.color : '#f1f5f9' }}
                    >
                      {opt.label}
                    </Text>
                    <Text className="text-text-muted text-xs text-center mt-1">{opt.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* TDEE preview */}
              {targetCalories && (
                <Card className="mb-6 border-primary/20">
                  <Text className="text-text-secondary text-xs mb-3 font-medium">Tu plan nutricional estimado</Text>
                  <View className="flex-row justify-between">
                    <View className="items-center">
                      <Text className="text-text-secondary text-lg font-bold">{bmr}</Text>
                      <Text className="text-text-muted text-xs">BMR</Text>
                    </View>
                    <Text className="text-text-muted text-lg self-center">→</Text>
                    <View className="items-center">
                      <Text className="text-text-secondary text-lg font-bold">{tdee}</Text>
                      <Text className="text-text-muted text-xs">TDEE</Text>
                    </View>
                    <Text className="text-text-muted text-lg self-center">→</Text>
                    <View className="items-center">
                      <Text className="text-primary text-2xl font-bold">{targetCalories}</Text>
                      <Text className="text-text-muted text-xs">Meta kcal</Text>
                    </View>
                  </View>
                  <Text className="text-text-muted text-xs mt-3 text-center">
                    {goalType === 'LOSE_FAT' && `Déficit de ${Math.abs(GOAL_ADJUSTMENTS.LOSE_FAT)} kcal · ~0.3–0.5 kg/semana`}
                    {goalType === 'GAIN_MUSCLE' && `Superávit de ${GOAL_ADJUSTMENTS.GAIN_MUSCLE} kcal · ~0.2–0.3 kg/semana`}
                    {goalType === 'MAINTAIN' && 'Calorías de mantenimiento exactas'}
                    {goalType === 'RECOMPOSITION' && 'Déficit mínimo · foco en proteína alta'}
                  </Text>
                </Card>
              )}

              <View className="flex-row gap-3">
                <View className="w-12">
                  <Button label="←" variant="outline" onPress={() => setStep(1)} />
                </View>
                <View className="flex-1">
                  <Button
                    label={isLoading ? 'Creando tu plan...' : '¡Empezar!'}
                    loading={isLoading}
                    onPress={handleFinish}
                  />
                </View>
              </View>
            </View>
          )}

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
