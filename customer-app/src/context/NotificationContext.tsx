import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from './AuthContext';
import { NotificationsService } from '../services/notifications.service';
import type {
  AppNotification,
  NotificationMeta,
} from '../types/notification.types';

export interface NotificationContextValue {
  unreadCount: number;
  notifications: AppNotification[];
  meta: NotificationMeta | null;
  isLoading: boolean;
  isRefreshing: boolean;
  fetchNotifications: (refresh?: boolean) => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  markAllAsRead: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined,
);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [meta, setMeta] = useState<NotificationMeta | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Fetch quick unread count
  const refreshUnreadCount = useCallback(async () => {
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    try {
      const count = await NotificationsService.getUnreadCount();
      setUnreadCount(count);
    } catch {
      // silent fail in background
    }
  }, [isAuthenticated]);

  // Fetch full notification list
  const fetchNotifications = useCallback(
    async (refresh = false) => {
      if (!isAuthenticated) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      if (refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const res = await NotificationsService.getInbox({ limit: 50 });
        setNotifications(res.items);
        setMeta(res.meta);
        setUnreadCount(res.meta.unreadCount);
      } catch {
        // silent fail
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [isAuthenticated],
  );

  // Initial load & Auth state changes
  useEffect(() => {
    if (isAuthenticated) {
      refreshUnreadCount();
      fetchNotifications();
    } else {
      setUnreadCount(0);
      setNotifications([]);
      setMeta(null);
    }
  }, [isAuthenticated, refreshUnreadCount, fetchNotifications]);

  // AppState listener (refreshes unread count when returning to app foreground)
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && isAuthenticated) {
        refreshUnreadCount();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [isAuthenticated, refreshUnreadCount]);

  // Mark all notifications as read (optimistic update)
  const markAllAsRead = useCallback(async () => {
    const previousItems = notifications;
    const previousCount = unreadCount;

    // Optimistic UI update
    setUnreadCount(0);
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));

    try {
      await NotificationsService.markRead({ all: true });
    } catch {
      // Revert if failed
      setNotifications(previousItems);
      setUnreadCount(previousCount);
    }
  }, [notifications, unreadCount]);

  // Mark a single notification as read (optimistic update)
  const markAsRead = useCallback(
    async (id: string) => {
      const item = notifications.find((n) => n.id === id);
      if (!item || item.read) return;

      // Optimistic UI update
      setUnreadCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );

      try {
        await NotificationsService.markRead({ ids: [id] });
      } catch {
        // Re-sync on failure
        refreshUnreadCount();
      }
    },
    [notifications, refreshUnreadCount],
  );

  return (
    <NotificationContext.Provider
      value={{
        unreadCount,
        notifications,
        meta,
        isLoading,
        isRefreshing,
        fetchNotifications,
        refreshUnreadCount,
        markAllAsRead,
        markAsRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
