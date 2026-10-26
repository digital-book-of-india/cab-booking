import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { objectId } from '../../common/zod';
import {
  markReadSchema,
  notificationListQuerySchema,
  registerDeviceSchema,
  testNotificationSchema,
} from './notifications.schemas';
import type { NotificationsService } from './notifications.service';

export function createNotificationsController(service: NotificationsService) {
  const registerDevice: RequestHandler = async (req, res) => {
    const input = registerDeviceSchema.parse(req.body);
    ok(res, await service.registerDevice(actorFrom(req).userId, input), 201);
  };

  const removeDevice: RequestHandler = async (req, res) => {
    await service.removeDevice(actorFrom(req).userId, objectId.parse(req.params['deviceId']));
    ok(res, { removed: true });
  };

  const list: RequestHandler = async (req, res) => {
    const query = notificationListQuerySchema.parse(req.query);
    const { items, meta } = await service.list(actorFrom(req).userId, query);
    ok(res, items, 200, meta);
  };

  const markRead: RequestHandler = async (req, res) => {
    ok(res, await service.markRead(actorFrom(req).userId, markReadSchema.parse(req.body)));
  };

  const sendTest: RequestHandler = async (req, res) => {
    const input = testNotificationSchema.parse(req.body);
    ok(res, await service.sendTestNotification(actorFrom(req), input));
  };

  return { registerDevice, removeDevice, list, markRead, sendTest };
}
