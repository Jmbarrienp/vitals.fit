import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';

export function useLogin() {
  const { setAuth } = useAuthStore();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: async ({ data }) => {
      await setAuth(data.access_token, data.user as any);
      router.replace('/(tabs)/dashboard');
    },
  });
}

export function useRegister() {
  const { setAuth } = useAuthStore();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.register(email, password),
    onSuccess: async ({ data }) => {
      await setAuth(data.access_token, data.user as any);
      router.replace('/onboarding');
    },
  });
}

export function useMe() {
  const { isAuthenticated } = useAuthStore();
  return useQuery({
    queryKey: ['me'],
    queryFn: () => authApi.me().then((r) => r.data),
    enabled: isAuthenticated,
  });
}
