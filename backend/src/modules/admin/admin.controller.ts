import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { objectId } from '../../common/zod';
import {
  bookingListQuerySchema,
  rideListQuerySchema,
  bookingRestrictionSchema,
  dispatchQueueQuerySchema,
  expiringDocumentsQuerySchema,
  liveDriversQuerySchema,
  manualAssignDriverSchema,
  userListQuerySchema,
  userStatusSchema,
  waiveFeeSchema,
} from './admin.schemas';
import type { AdminService } from './admin.service';

export function createAdminController(service: AdminService) {
  const listUsers: RequestHandler = async (req, res) => {
    const { items, meta } = await service.listUsers(userListQuerySchema.parse(req.query));
    ok(res, items, 200, meta);
  };

  const userDetail: RequestHandler = async (req, res) => {
    ok(res, await service.userDetail(objectId.parse(req.params['userId'])));
  };

  const setUserStatus: RequestHandler = async (req, res) => {
    const userId = objectId.parse(req.params['userId']);
    ok(res, await service.setUserStatus(actorFrom(req), userId, userStatusSchema.parse(req.body)));
  };

  const listBookings: RequestHandler = async (req, res) => {
    const { items, meta } = await service.listBookings(bookingListQuerySchema.parse(req.query));
    ok(res, items, 200, meta);
  };

  const listRides: RequestHandler = async (req, res) => {
    const { items, meta } = await service.listRides(rideListQuerySchema.parse(req.query));
    ok(res, items, 200, meta);
  };

  const rideDetail: RequestHandler = async (req, res) => {
    ok(res, await service.rideDetail(actorFrom(req), String(req.params['rideId'])));
  };

  const bookingDetail: RequestHandler = async (req, res) => {
    ok(res, await service.bookingDetail(actorFrom(req), String(req.params['bookingId'])));
  };

  const rideTrail: RequestHandler = async (req, res) => {
    ok(res, await service.rideTrail(actorFrom(req), String(req.params['rideId'])));
  };

  const waiveFee: RequestHandler = async (req, res) => {
    const input = waiveFeeSchema.parse(req.body);
    ok(res, await service.waiveFee(actorFrom(req), String(req.params['bookingId']), input));
  };

  const expiringDocuments: RequestHandler = async (req, res) => {
    const { items, meta } = await service.expiringDocuments(
      expiringDocumentsQuerySchema.parse(req.query),
    );
    ok(res, items, 200, meta);
  };

  const setCustomerBookingRestriction: RequestHandler = async (req, res) => {
    const customerId = objectId.parse(req.params['customerId']);
    const input = bookingRestrictionSchema.parse(req.body);
    ok(res, await service.setCustomerBookingRestriction(actorFrom(req), customerId, input));
  };

  const liveDrivers: RequestHandler = async (req, res) => {
    const { items, meta } = await service.getLiveDrivers(
      actorFrom(req),
      liveDriversQuerySchema.parse(req.query),
    );
    ok(res, items, 200, meta);
  };

  const dispatchQueue: RequestHandler = async (req, res) => {
    const actor = actorFrom(req);
    const { items, meta } = await service.getDispatchQueue(
      actor,
      dispatchQueueQuerySchema.parse(req.query),
    );
    ok(res, items, 200, meta);
  };

  const assignDriver: RequestHandler = async (req, res) => {
    const bookingId = String(req.params['bookingId']);
    const input = manualAssignDriverSchema.parse(req.body);
    ok(res, await service.manualAssignDriver(actorFrom(req), bookingId, input));
  };

  const dashboard: RequestHandler = async (_req, res) => {
    ok(res, await service.dashboard());
  };

  return { listRides, rideDetail,
    listUsers,
    userDetail,
    setUserStatus,
    setCustomerBookingRestriction,
    listBookings,
    bookingDetail,
    rideTrail,
    waiveFee,
    expiringDocuments,
    liveDrivers,
    dispatchQueue,
    assignDriver,
    dashboard,
  };
}
