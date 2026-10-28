import axios, { AxiosError } from 'axios';
import { ApiErrorResponse } from '@/types';

let mswReadyPromise: Promise<boolean> | null = null;

export function ensureMswReady(): Promise<boolean> {
  if (typeof window === 'undefined' || process.env.NEXT_PUBLIC_USE_MOCKS === 'false') {
    return Promise.resolve(true);
  }
  if (!mswReadyPromise) {
    mswReadyPromise = import('@/mocks/browser')
      .then(({ worker }) => worker.start({ onUnhandledFrame: 'bypass', quiet: true }))
      .then(() => true)
      .catch((err) => {
        console.warn('MSW worker failed to start:', err);
        return false;
      });
  }
  return mswReadyPromise;
}

if (typeof window !== 'undefined') {
  ensureMswReady();
}

export const apiClient = axios.create({
  baseURL:
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: false,
});

apiClient.interceptors.request.use(
  async (config) => {
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_USE_MOCKS !== 'false') {
      await ensureMswReady();
    }

    // Attach JWT Authorization header
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      if (token && config.headers && !config.headers['Authorization']) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse | Record<string, unknown>>) => {
    const status = error.response?.status;
    const url = error.config?.url || '';

    // Special Case: 503 degraded dependency visualization
    if (status === 503 && url.includes('/health/ready') && error.response?.data) {
      return Promise.resolve({
        ...error.response,
        data: error.response.data,
      });
    }

    if (status === 401) {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_role');
        sessionStorage.removeItem('auth_token');
        document.cookie = 'auth_token=; path=/; max-age=0; SameSite=Lax';
        document.cookie = 'user_role=; path=/; max-age=0; SameSite=Lax';
        const redirectPath = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        window.location.replace(redirectPath);
      }
    }

    return Promise.reject(error.response?.data || error);
  }
);