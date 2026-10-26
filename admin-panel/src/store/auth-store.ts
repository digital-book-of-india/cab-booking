import { create } from 'zustand';
import { AdminUser, Role } from '@/types';

interface AuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  setUser: (user: AdminUser | null) => void;
  logout: () => void;
  hasRole: (allowedRoles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: {
    id: 'usr_admin_001',
    name: 'Super Commander',
    email: 'admin@platform.internal',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
  },
  isAuthenticated: true,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  logout: () => set({ user: null, isAuthenticated: false }),
  hasRole: (allowedRoles: Role[]) => {
    const current = get().user;
    if (!current) return false;
    return allowedRoles.includes(current.role);
  },
}));
