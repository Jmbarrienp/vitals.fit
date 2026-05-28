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
import { useLogin } from '../src/hooks/useAuth';

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});
type Form = z.infer<typeof schema>;

export default function LoginScreen() {
  const { control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  });
  const { mutate: login, isPending } = useLogin();

  const onSubmit = (data: Form) => {
    login(data, {
      onError: (e: any) => {
        const status = e?.response?.status;
        const msg = e?.response?.data?.message;

        if (!e?.response) {
          Alert.alert(
            'Sin conexión',
            'No se puede conectar al servidor. Verifica que estés en la misma red WiFi que tu computadora.',
          );
          return;
        }
        if (status === 401) {
          Alert.alert('Credenciales incorrectas', 'Verifica tu email y contraseña.');
          return;
        }
        Alert.alert('Error', msg ?? 'Ocurrió un error. Intenta de nuevo.');
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
            <Text className="text-text-primary text-2xl font-semibold mt-2">Bienvenido de vuelta</Text>
            <Text className="text-text-secondary mt-1">Ingresa a tu cuenta para continuar</Text>
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
                placeholder="••••••••"
                secureTextEntry
                error={errors.password?.message}
              />
            )}
          />

          <View className="mt-2">
            <Button label="Iniciar sesión" loading={isPending} onPress={handleSubmit(onSubmit)} />
          </View>

          <View className="flex-row justify-center mt-6">
            <Text className="text-text-secondary">¿No tienes cuenta? </Text>
            <Link href="/register">
              <Text className="text-primary font-semibold">Regístrate</Text>
            </Link>
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
