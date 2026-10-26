import { create } from 'zustand';
import { AdminUser, Role } from '@/types';

interface AuthState {
  user: AdminUser | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: AdminUser | null, token?: string) => void;
  setToken: (token: string | null) => void;
  logout: () => void;
  hasRole: (allowedRoles: Role[]) => boolean;
}

const getStoredToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: getStoredToken(),
  isAuthenticated: !!getStoredToken(),
  setUser: (user, token) => {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('auth_token', token);
        document.cookie = `auth_token=${encodeURIComponent(token)}; path=/; max-age=604800; SameSite=Lax`;
      }
      if (user?.role) {
        localStorage.setItem('user_role', user.role);
        document.cookie = `user_role=${encodeURIComponent(user.role)}; path=/; max-age=604800; SameSite=Lax`;
      }
    }
    set({ user, token: token ?? get().token, isAuthenticated: !!user });
  },
  setToken: (token) => {
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('auth_token', token);
        document.cookie = `auth_token=${encodeURIComponent(token)}; path=/; max-age=604800; SameSite=Lax`;
      } else {
        localStorage.removeItem('auth_token');
        document.cookie = 'auth_token=; path=/; max-age=0; SameSite=Lax';
      }
    }
    set({ token, isAuthenticated: !!get().user && !!token });
  },
  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_role');
      sessionStorage.removeItem('auth_token');
      document.cookie = 'auth_token=; path=/; max-age=0; SameSite=Lax';
      document.cookie = 'user_role=; path=/; max-age=0; SameSite=Lax';
    }
    set({ user: null, token: null, isAuthenticated: false });
  },
  hasRole: (allowedRoles: Role[]) => {
    const current = get().user;
    if (!current) return false;
    return allowedRoles.includes(current.role);
  },
}));
