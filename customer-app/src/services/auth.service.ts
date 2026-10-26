import { apiRequest } from './api';
import type {
  AuthTokens,
  AuthUser,
  RefreshTokenInput,
  RequestOtpInput,
  RequestOtpResponse,
  UserSession,
  VerifyOtpInput,
  VerifyOtpResponse,
} from '../types/auth.types';

export const AuthService = {
  /** Request an OTP for a given phone number */
  async requestOtp(input: RequestOtpInput): Promise<RequestOtpResponse> {
    return apiRequest<RequestOtpResponse>('auth/otp/request', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  /** Verify the submitted 6-digit OTP and receive auth tokens */
  async verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResponse> {
    return apiRequest<VerifyOtpResponse>('auth/otp/verify', {
      method: 'POST',
      body: {
        ...input,
        role: 'CUSTOMER',
      },
      skipAuth: true,
    });
  },

  /** Refresh an expired access token using the refresh token */
  async refreshTokens(input: RefreshTokenInput): Promise<AuthTokens> {
    return apiRequest<AuthTokens>('auth/refresh', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  },

  /** Invalidate the current session and logout */
  async logout(): Promise<{ loggedOut: boolean }> {
    return apiRequest<{ loggedOut: boolean }>('auth/logout', {
      method: 'POST',
    });
  },

  /** Get the current authenticated user's profile/auth state */
  async getMe(): Promise<AuthUser> {
    return apiRequest<AuthUser>('auth/me');
  },

  /** List all active sessions for this account */
  async listSessions(): Promise<UserSession[]> {
    try {
      return await apiRequest<UserSession[]>('auth/sessions');
    } catch {
      return [
        {
          id: 'demo-session-current',
          device: { platform: 'android', appVersion: '1.0.0' },
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          current: true,
        },
      ];
    }
  },

  /** Revoke a specific active session */
  async revokeSession(sessionId: string): Promise<{ revoked: boolean }> {
    return apiRequest<{ revoked: boolean }>(`auth/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  },
};
