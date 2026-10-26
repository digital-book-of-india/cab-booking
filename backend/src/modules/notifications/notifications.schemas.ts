import { z } from 'zod';
import { paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';

export const registerDeviceSchema = z
  .object({
    token: z.string().trim().min(20).max(4096),
    platform: z.enum(['android', 'ios']),
    deviceId: z.string().trim().min(1).max(100).optional(),
    appVersion: z.string().trim().min(1).max(30).optional(),
  })
  .strict();

export const notificationListQuerySchema = paginationSchema.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const markReadSchema = z
  .object({
    ids: z.array(objectId).min(1).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.ids) !== Boolean(v.all), {
    message: 'send either ids or all: true',
    path: ['ids'],
  });

export const testNotificationSchema = z
  .object({
    channel: z.enum(['push', 'sms']),
    recipientId: objectId,
    title: z.string().trim().min(1).max(100).optional(),
    body: z.string().trim().min(1).max(300),
  })
  .strict();

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type MarkReadInput = z.infer<typeof markReadSchema>;
export type TestNotificationInput = z.infer<typeof testNotificationSchema>;
