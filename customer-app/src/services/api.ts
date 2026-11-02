import { API_CONFIG } from '../constants/config';
import { TokenStorage } from './tokenStorage';

export type ApiFieldError = {
  field: string;
  message: string;
};

export class ApiError extends Error {
  public code?: string;
  public fieldErrors: ApiFieldError[];
  public status: number;
  public data?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    fieldErrors: ApiFieldError[] = [],
    data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.data = data;
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  token?: string | null;
  skipAuth?: boolean;
  withMeta?: boolean;
};

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

export async function apiRequest<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const baseURL = API_CONFIG.baseURL;

  if (!baseURL) {
    throw new Error('Missing EXPO_PUBLIC_API_URL in customer-app/.env');
  }

  const { token, skipAuth, headers, body, signal, withMeta, ...requestOptions } = options;

  let authToken = token;
  if (!skipAuth && !authToken) {
    authToken = await TokenStorage.getAccessToken();
  }

  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_CONFIG.timeout);

  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abortFromCaller);
  }

  try {
    const cleanPath = path.replace(/^\/+/, '');
    const url = `${baseURL}/${cleanPath}`;

    const response = await fetch(url, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? {
            body: typeof body === 'string' ? body : JSON.stringify(body),
          }
        : {}),
    });

    const parsed = await parseResponse(response);

    if (!response.ok) {
      // Automatic 401 token refresh interceptor (skip for auth routes to prevent loops)
      if (
        response.status === 401 &&
        !skipAuth &&
        !cleanPath.startsWith('auth/refresh') &&
        !cleanPath.startsWith('auth/otp')
      ) {
        const storedRefreshToken = await TokenStorage.getRefreshToken();
        if (storedRefreshToken) {
          try {
            const refreshRes = await fetch(`${baseURL}/auth/refresh`, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ refreshToken: storedRefreshToken }),
            });
            const refreshParsed = await parseResponse(refreshRes);
            if (
              refreshRes.ok &&
              refreshParsed &&
              typeof refreshParsed === 'object' &&
              'data' in refreshParsed
            ) {
              const newTokens = (
                refreshParsed as {
                  data: { accessToken: string; refreshToken: string };
                }
              ).data;
              if (newTokens?.accessToken) {
                await TokenStorage.setTokens(
                  newTokens.accessToken,
                  newTokens.refreshToken,
                );
                // Retry the original request with the fresh access token
                return await apiRequest<T>(path, {
                  ...options,
                  token: newTokens.accessToken,
                });
              }
            } else {
              // Refresh token is revoked or expired
              await TokenStorage.clearTokens();
            }
          } catch {
            // Network failure during refresh
          }
        }
      }

      let message = `Request failed (${response.status})`;
      let code: string | undefined;
      let fieldErrors: ApiFieldError[] = [];

      if (parsed && typeof parsed === 'object') {
        const errorObj = (
          parsed as {
            error?: {
              message?: string;
              code?: string;
              fieldErrors?: ApiFieldError[];
            };
          }
        ).error;
        if (errorObj) {
          message = errorObj.message || message;
          code = errorObj.code;
          fieldErrors = errorObj.fieldErrors || [];
        } else if (
          'message' in parsed &&
          typeof (parsed as { message: unknown }).message === 'string'
        ) {
          message = (parsed as { message: string }).message;
        }
      }

      throw new ApiError(message, response.status, code, fieldErrors, parsed);
    }

    // Backend wraps successful responses in { success: true, data: T, meta?: ... }
    if (parsed && typeof parsed === 'object' && 'data' in parsed && 'success' in parsed) {
      if (withMeta) {
        return { data: (parsed as any).data, meta: (parsed as any).meta } as any;
      }
      return (parsed as { data: T }).data;
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (timedOut) {
      throw new Error('Request timed out. Please try again.');
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    throw new Error(
      error instanceof Error ? error.message : 'Unable to connect to server. Check your connection.',
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function apiRequestWithMeta<T, M = Record<string, unknown>>(
  path: string,
  options: Omit<ApiOptions, 'withMeta'> = {},
): Promise<{ data: T; meta?: M }> {
  return apiRequest<{ data: T; meta?: M }>(path, { ...options, withMeta: true });
}
