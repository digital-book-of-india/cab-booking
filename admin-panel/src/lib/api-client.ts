import axios, { AxiosError } from 'axios';
import { ApiErrorResponse } from '@/types';

let mswReadyPromise: Promise<boolean> | null = null;

export function ensureMswReady(): Promise<boolean> {
  if (typeof window === 'undefined' || process.env.NEXT_PUBLIC_USE_MOCKS === 'false') {
    return Promise.resolve(true);
  }
  if (!mswReadyPromise) {
    mswReadyPromise = import('@/mocks/browser')
      .then(({ worker }) => worker.start())
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
  withCredentials: true,
});

apiClient.interceptors.request.use(
  async (config) => {
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_USE_MOCKS !== 'false') {
      await ensureMswReady();
    }
    // Standard platform bearer injection if stored in localStorage
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
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
        const redirectPath = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        window.location.replace(redirectPath);
      }
    }

    return Promise.reject(error.response?.data || error);
  }
);
