import { apiRequest } from './api';
import type { AppNotification } from '../types/notification.types';

export const NotificationsService = {
  /** Fetch all in-app notifications for the signed-in customer */
  async listNotifications(): Promise<AppNotification[]> {
    const res = await apiRequest<AppNotification[] | { items: AppNotification[] }>('notifications');
    if (Array.isArray(res)) return res;
    if (res && 'items' in res && Array.isArray(res.items)) return res.items;
    return [];
  },

  /** Mark all or specific notifications as read */
  async markRead(options: { notificationIds?: string[]; all?: boolean }): Promise<{ success: boolean }> {
    return apiRequest<{ success: boolean }>('notifications/read', {
      method: 'POST',
      body: options,
    });
  },

  /** Register device token for push notifications */
  async registerDevice(device: {
    deviceId: string;
    token: string;
    platform: 'android' | 'ios' | 'web';
  }): Promise<{ registered: boolean }> {
    return apiRequest<{ registered: boolean }>('devices', {
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
