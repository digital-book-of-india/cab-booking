import { apiRequest, apiRequestWithMeta } from './api';
import type { AppNotification, NotificationInboxResult, NotificationMeta } from '../types/notification.types';

export const NotificationsService = {
  /** Fetch paginated notifications with meta and unreadCount */
  async getInbox(params: { page?: number; limit?: number; unread?: boolean } = {}): Promise<NotificationInboxResult> {
    const query = new URLSearchParams();
    if (params.page) query.append('page', String(params.page));
    if (params.limit) query.append('limit', String(params.limit));
    if (params.unread !== undefined) query.append('unread', String(params.unread));

    const path = `notifications${query.toString() ? `?${query.toString()}` : ''}`;
    const res = await apiRequestWithMeta<any[], NotificationMeta>(path);

    const rawItems = Array.isArray(res.data) ? res.data : [];
    const items: AppNotification[] = rawItems.map((n: any) => ({
      id: String(n.id || n._id),
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      readAt: n.readAt,
      read: n.read !== undefined ? Boolean(n.read) : (n.readAt !== null && n.readAt !== undefined),
      createdAt: n.createdAt,
    }));

    const meta: NotificationMeta = {
      page: res.meta?.page ?? 1,
      limit: res.meta?.limit ?? 20,
      total: res.meta?.total ?? items.length,
      pageCount: res.meta?.pageCount ?? 1,
      unreadCount: res.meta?.unreadCount ?? items.filter((i) => !i.read).length,
    };

    return { items, meta };
  },

  /** Backward compatible helper: fetch all in-app notifications */
  async listNotifications(): Promise<AppNotification[]> {
    const result = await this.getInbox({ limit: 50 });
    return result.items;
  },

  /** Fetch current unread notifications count */
  async getUnreadCount(): Promise<number> {
    try {
      const res = await apiRequestWithMeta<any[], NotificationMeta>('notifications?limit=1');
      if (res.meta && typeof res.meta.unreadCount === 'number') {
        return res.meta.unreadCount;
      }
      return 0;
    } catch {
      return 0;
    }
  },

  /** Mark all or specific notifications as read */
  async markRead(options: { ids?: string[]; notificationIds?: string[]; all?: boolean }): Promise<{ updated?: number }> {
    const payload = options.all
      ? { all: true }
      : { ids: options.ids || options.notificationIds || [] };

    return apiRequest<{ updated?: number }>('notifications/read', {
      method: 'POST',
      body: payload,
    });
  },

  /** Register device token for push notifications */
  async registerDevice(device: {
    deviceId: string;
    token: string;
    platform: 'android' | 'ios' | 'web';
  }): Promise<{ id?: string; platform?: string; registered?: boolean }> {
    return apiRequest('devices', {
      method: 'POST',
      body: device,
    });
  },

  /** Unregister device push token */
  async removeDevice(deviceId: string): Promise<{ removed: boolean }> {
    return apiRequest<{ removed: boolean }>(`devices/${deviceId}`, {
      method: 'DELETE',
    });
  },
};
