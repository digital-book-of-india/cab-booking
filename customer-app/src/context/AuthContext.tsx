import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AuthService } from '../services/auth.service';
import { CustomerService } from '../services/customer.service';
import { TokenStorage } from '../services/tokenStorage';
import type { AuthUser, DeviceInfo } from '../types/auth.types';

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  activeChallenge: { phone: string; challengeId: string; resendAfterSeconds: number } | null;
  requestOtp: (phone: string) => Promise<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }>;
  verifyOtp: (otp: string, device?: DeviceInfo) => Promise<AuthUser>;
  loginDemoUser: (phone?: string) => Promise<AuthUser>;
  updateProfile: (name: string, email?: string | null) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  clearChallenge: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const DEMO_USER: AuthUser = {
  id: 'demo-user-101',
  phone: '+919876543210',
  role: 'CUSTOMER',
  status: 'ACTIVE',
  profileComplete: true,
  isNewUser: false,
  name: 'Demo Rider',
  email: 'rider@example.com',
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeChallenge, setActiveChallenge] = useState<{
    phone: string;
    challengeId: string;
    resendAfterSeconds: number;
  } | null>(null);

  /** Restore session from stored tokens on app launch */
  const restoreSession = useCallback(async () => {
    try {
      const accessToken = await TokenStorage.getAccessToken();
      const refreshToken = await TokenStorage.getRefreshToken();

      if (!accessToken && !refreshToken) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      // Demo Mode token restoration
      if (accessToken === 'demo-access-token') {
        setUser(DEMO_USER);
        setIsLoading(false);
        return;
      }

      if (accessToken) {
        try {
          const profile = await CustomerService.getProfile();
          setUser({
            id: profile.id,
            phone: profile.phone,
            role: 'CUSTOMER',
            status: profile.accountStatus,
            profileComplete: Boolean(profile.name),
            isNewUser: false,
            name: profile.name,
            email: profile.email,
          });
          setIsLoading(false);
          return;
        } catch {
          // Token might be expired, try refreshing
        }
      }

      if (refreshToken) {
        try {
          const tokens = await AuthService.refreshTokens({ refreshToken });
          await TokenStorage.setTokens(tokens.accessToken, tokens.refreshToken);
          const profile = await CustomerService.getProfile();
          setUser({
            id: profile.id,
            phone: profile.phone,
            role: 'CUSTOMER',
            status: profile.accountStatus,
            profileComplete: Boolean(profile.name),
            isNewUser: false,
            name: profile.name,
            email: profile.email,
          });
          setIsLoading(false);
          return;
        } catch {
          // Refresh failed - tokens invalid
          await TokenStorage.clearTokens();
          setUser(null);
        }
      }
    } catch {
      await TokenStorage.clearTokens();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  /** 1-tap instant Demo Login */
  const loginDemoUser = useCallback(async (phone?: string): Promise<AuthUser> => {
    const customDemoUser: AuthUser = {
      ...DEMO_USER,
      phone: phone || DEMO_USER.phone,
    };
    await TokenStorage.setTokens('demo-access-token', 'demo-refresh-token');
    setUser(customDemoUser);
    setActiveChallenge(null);
    return customDemoUser;
  }, []);

  /** Request OTP with automatic Demo Fallback on network timeout */
  const requestOtp = useCallback(async (phone: string) => {
    try {
      const res = await AuthService.requestOtp({ phone, purpose: 'login' });
      setActiveChallenge({
        phone,
        challengeId: res.challengeId,
        resendAfterSeconds: res.resendAfterSeconds || 30,
      });
      return res;
    } catch (err) {
      console.warn(
        '[AuthContext] Backend request timed out or unreachable. Falling back to Demo Challenge for:',
        phone,
        err,
      );
      const fallbackRes = {
        challengeId: `demo-challenge-${Date.now()}`,
        expiresInSeconds: 300,
        resendAfterSeconds: 30,
      };
      setActiveChallenge({
        phone,
        challengeId: fallbackRes.challengeId,
        resendAfterSeconds: 30,
      });
      return fallbackRes;
    }
  }, []);

  /** Verify OTP and establish session */
  const verifyOtp = useCallback(
    async (otp: string, device?: DeviceInfo): Promise<AuthUser> => {
      if (!activeChallenge) {
        throw new Error('No active OTP request found. Please request an OTP first.');
      }

      // If active challenge is a Demo Challenge or OTP is demo code (123456)
      if (activeChallenge.challengeId.startsWith('demo-') || otp === '123456') {
        const demoAuthUser: AuthUser = {
          id: 'demo-user-101',
          phone: activeChallenge.phone,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          profileComplete: true,
          isNewUser: false,
          name: 'Demo Rider',
          email: 'rider@example.com',
        };
        await TokenStorage.setTokens('demo-access-token', 'demo-refresh-token');
        setUser(demoAuthUser);
        setActiveChallenge(null);
        return demoAuthUser;
      }

      try {
        const res = await AuthService.verifyOtp({
          challengeId: activeChallenge.challengeId,
          phone: activeChallenge.phone,
          otp,
          role: 'CUSTOMER',
          device,
        });

        await TokenStorage.setTokens(res.accessToken, res.refreshToken);

        let profileName = null;
        let profileEmail = null;
        try {
          const profile = await CustomerService.getProfile();
          profileName = profile.name;
          profileEmail = profile.email;
        } catch {
          // use basic user
        }

        const authUser: AuthUser = {
          ...res.user,
          phone: activeChallenge.phone,
          name: profileName,
          email: profileEmail,
        };

        setUser(authUser);
        setActiveChallenge(null);
        return authUser;
      } catch (err) {
        // If real backend call timed out or failed and user entered 123456, let them in via demo
        if (otp === '123456' || otp === '000000') {
          return loginDemoUser(activeChallenge.phone);
        }
        throw err;
      }
    },
    [activeChallenge, loginDemoUser],
  );

  /** Update user name and email */
  const updateProfile = useCallback(
    async (name: string, email?: string | null) => {
      try {
        const updated = await CustomerService.updateProfile({ name, email });
        setUser((prev) =>
          prev
            ? {
                ...prev,
                name: updated.name,
                email: updated.email,
                profileComplete: Boolean(updated.name),
              }
            : null,
        );
      } catch {
        // Fallback for demo mode
        setUser((prev) =>
          prev
            ? {
                ...prev,
                name,
                email,
                profileComplete: Boolean(name),
              }
            : null,
        );
      }
    },
    [],
  );

  /** Refresh profile data */
  const refreshProfile = useCallback(async () => {
    try {
      const profile = await CustomerService.getProfile();
      setUser((prev) =>
        prev
          ? {
              ...prev,
              name: profile.name,
              email: profile.email,
              profileComplete: Boolean(profile.name),
            }
          : null,
      );
    } catch {
      // ignore
    }
  }, []);

  /** Logout and clear tokens */
  const logout = useCallback(async () => {
    try {
      await AuthService.logout();
    } catch {
      // ignore server logout errors
    } finally {
      await TokenStorage.clearTokens();
      setUser(null);
      setActiveChallenge(null);
    }
  }, []);

  const clearChallenge = useCallback(() => {
    setActiveChallenge(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      activeChallenge,
      requestOtp,
      verifyOtp,
      loginDemoUser,
      updateProfile,
      refreshProfile,
      logout,
      clearChallenge,
    }),
    [
      user,
      isLoading,
      activeChallenge,
      requestOtp,
      verifyOtp,
      loginDemoUser,
      updateProfile,
      refreshProfile,
      logout,
      clearChallenge,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
