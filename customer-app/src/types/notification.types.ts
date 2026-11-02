export type NotificationType =
  | 'RIDE_UPDATE'
  | 'PAYMENT_UPDATE'
  | 'PROMO'
  | 'SUPPORT_UPDATE'
  | 'SECURITY'
  | 'TEST_NOTIFICATION';

export type AppNotification = {
  id: string;
  userId?: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  readAt?: string | null;
  data?: Record<string, string>;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type NotificationMeta = {
  requestId?: string;
  page: number;
  limit: number;
  total: number;
  pageCount: number;
  unreadCount: number;
};

export type NotificationInboxResult = {
  items: AppNotification[];
  meta: NotificationMeta;
};
