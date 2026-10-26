import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { ApiErrorResponse } from '@/types';

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (!config.headers['X-Request-Id']) {
      config.headers['X-Request-Id'] = `req_${Math.random().toString(36).substring(2, 10)}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse | any>) => {
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
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      }
    }

    return Promise.reject(error.response?.data || error);
  }
);
