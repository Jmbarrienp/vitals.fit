import { apiClient } from './client';
import { AuthResponse, User } from '../types';

export const authApi = {
  register: (email: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/register', { email, password }),

  login: (email: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/login', { email, password }),

  me: () =>
    apiClient.get<User>('/auth/me'),
};
