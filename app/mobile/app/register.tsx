import {
  View, Text, KeyboardAvoidingView, Platform,
  ScrollView, Alert,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { Input } from '../src/components/Input';
import { Button } from '../src/components/Button';
import { useRegister } from '../src/hooks/useAuth';

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: 'Las contraseñas no coinciden',
  path: ['confirm'],
});
type Form = z.infer<typeof schema>;

export default function RegisterScreen() {
  const { control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  });
  const { mutate: register, isPending } = useRegister();

  const onSubmit = ({ email, password }: Form) => {
    register({ email, password }, {
      onError: (e: any) => {
        if (!e?.response) {
          Alert.alert(
            'Sin conexión',
            'No se puede conectar al servidor.\n\nVerifica que:\n1. El backend esté corriendo\n2. Tu iPhone y PC estén en la misma WiFi',
          );
          return;
        }
        const status = e?.response?.status;
        const msg = e?.response?.data?.message;
        if (status === 409) {
          Alert.alert('Email en uso', 'Ya existe una cuenta con este email. Intenta iniciar sesión.');
          return;
        }
        Alert.alert('Error', typeof msg === 'string' ? msg : 'No se pudo crear la cuenta.');
      },
    });
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 px-6 pt-20 pb-10">

          <View className="mb-10">
            <Text className="text-primary text-4xl font-bold">FitnessAI</Text>
            <Text className="text-text-primary text-2xl font-semibold mt-2">Crea tu cuenta</Text>
            <Text className="text-text-secondary mt-1">Empieza tu transformación hoy</Text>
          </View>

          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, value } }) => (
              <Input
                label="Email"
                value={value}
                onChangeText={onChange}
                placeholder="tu@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                error={errors.email?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, value } }) => (
              <Input
                label="Contraseña"
                value={value}
                onChangeText={onChange}
                placeholder="Mínimo 8 caracteres"
                secureTextEntry
                error={errors.password?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="confirm"
            render={({ field: { onChange, value } }) => (
              <Input
                label="Confirmar contraseña"
                value={value}
                onChangeText={onChange}
                placeholder="Repite tu contraseña"
                secureTextEntry
                error={errors.confirm?.message}
              />
            )}
          />

          <View className="mt-2">
            <Button label="Crear cuenta" loading={isPending} onPress={handleSubmit(onSubmit)} />
          </View>

          <View className="flex-row justify-center mt-6">
            <Text className="text-text-secondary">¿Ya tienes cuenta? </Text>
            <Link href="/login">
              <Text className="text-primary font-semibold">Inicia sesión</Text>
            </Link>
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
