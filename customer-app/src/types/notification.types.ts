export type NotificationType =
  | 'RIDE_UPDATE'
  | 'PAYMENT_UPDATE'
  | 'PROMO'
  | 'SUPPORT_UPDATE'
  | 'SECURITY';

export type AppNotification = {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
};
