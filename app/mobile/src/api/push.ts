import { apiClient } from './client';

export async function registerPushToken(token: string, platform: string): Promise<void> {
  await apiClient.post('/push/token', { token, platform });
}
