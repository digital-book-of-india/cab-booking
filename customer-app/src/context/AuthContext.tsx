import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AuthService } from "../services/auth.service";
import { CustomerService } from "../services/customer.service";
import { TokenStorage } from "../services/tokenStorage";
import type { AuthUser, DeviceInfo } from "../types/auth.types";

export type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  activeChallenge: {
    phone: string;
    challengeId: string;
    resendAfterSeconds: number;
  } | null;
  requestOtp: (
    phone: string
  ) => Promise<{
    challengeId: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
  }>;
  verifyOtp: (otp: string, device?: DeviceInfo) => Promise<AuthUser>;
  loginDemoUser: (phone?: string) => Promise<AuthUser>;
  updateProfile: (
    name: string,
    phoneOrEmail?: string | null,
    email?: string | null
  ) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  clearChallenge: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
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

      // Try fetching profile with existing access token
      if (accessToken) {
        try {
          const profile = await CustomerService.getProfile();
          setUser({
            id: profile.id,
            phone: profile.phone,
            role: "CUSTOMER",
            status: profile.accountStatus,
            profileComplete: Boolean(profile.name),
            isNewUser: false,
            name: profile.name,
            email: profile.email,
          });
          setIsLoading(false);
          return;
        } catch {
          // Token might be expired, fallback to refresh below
        }
      }

      // If accessToken is missing or expired, rotate tokens with refreshToken
      if (refreshToken) {
        try {
          const tokens = await AuthService.refreshTokens({ refreshToken });
          await TokenStorage.setTokens(tokens.accessToken, tokens.refreshToken);
          const profile = await CustomerService.getProfile();
          setUser({
            id: profile.id,
            phone: profile.phone,
            role: "CUSTOMER",
            status: profile.accountStatus,
            profileComplete: Boolean(profile.name),
            isNewUser: false,
            name: profile.name,
            email: profile.email,
          });
          setIsLoading(false);
          return;
        } catch {
          // Refresh failed - tokens invalid or revoked
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

  /** Request OTP from backend API */
  const requestOtp = useCallback(async (phone: string) => {
    const res = await AuthService.requestOtp({ phone, purpose: "login" });
    setActiveChallenge({
      phone,
      challengeId: res.challengeId,
      resendAfterSeconds: res.resendAfterSeconds || 30,
    });
    return res;
  }, []);

  /** Verify OTP with backend API and establish authenticated session */
  const verifyOtp = useCallback(
    async (otp: string, device?: DeviceInfo): Promise<AuthUser> => {
      if (!activeChallenge) {
        throw new Error("No active OTP request found. Please request an OTP first.");
      }

      const res = await AuthService.verifyOtp({
        challengeId: activeChallenge.challengeId,
        phone: activeChallenge.phone,
        otp,
        role: "CUSTOMER",
        device,
      });

      // Save real cryptographically signed JWT & rotating refresh token
      await TokenStorage.setTokens(res.accessToken, res.refreshToken);

      let profileName = res.user.name ?? null;
      let profileEmail = res.user.email ?? null;

      try {
        const profile = await CustomerService.getProfile();
        if (profile.name) profileName = profile.name;
        if (profile.email) profileEmail = profile.email;
      } catch {
        // use profile from verifyOtp response
      }

      const authUser: AuthUser = {
        ...res.user,
        phone: activeChallenge.phone,
        name: profileName,
        email: profileEmail,
        profileComplete: Boolean(profileName),
      };

      setUser(authUser);
      setActiveChallenge(null);
      return authUser;
    },
    [activeChallenge]
  );

  /** Dev-only helper for quick testing */
  const loginDemoUser = useCallback(async (phone?: string): Promise<AuthUser> => {
    const demoPhone = phone || "+919876543210";
    const req = await AuthService.requestOtp({ phone: demoPhone, purpose: "login" });
    const user = await AuthService.verifyOtp({
      challengeId: req.challengeId,
      phone: demoPhone,
      otp: "123456",
      role: "CUSTOMER",
    });
    await TokenStorage.setTokens(user.accessToken, user.refreshToken);
    const authUser: AuthUser = {
      ...user.user,
      phone: demoPhone,
      profileComplete: Boolean(user.user.name),
    };
    setUser(authUser);
    return authUser;
  }, []);

  /** Update user profile (name, email) */
  const updateProfile = useCallback(
    async (
      name: string,
      phoneOrEmail?: string | null,
      optionalEmail?: string | null
    ) => {
      let email: string | null | undefined;

      if (phoneOrEmail !== undefined) {
        if (phoneOrEmail && phoneOrEmail.includes("@")) {
          email = phoneOrEmail;
        } else if (phoneOrEmail === null) {
          email = null;
        }
      }

      if (optionalEmail !== undefined) {
        email = optionalEmail;
      }

      const updated = await CustomerService.updateProfile({ name, email });
      setUser((prev) =>
        prev
          ? {
              ...prev,
              name: updated.name || name,
              email: email !== undefined ? email : updated.email ?? prev.email,
              profileComplete: Boolean(name),
            }
          : null
      );
    },
    []
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
              phone: profile.phone || prev.phone,
              email: profile.email,
              profileComplete: Boolean(profile.name),
            }
          : null
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
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
