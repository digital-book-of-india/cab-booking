import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import {
  arrivedSchema,
  bookingIdSchema,
  completeSchema,
  customerCancelSchema,
  destinationRequestSchema,
  destinationRespondSchema,
  driverCancelSchema,
  historyQuerySchema,
  rideIdSchema,
  startSchema,
  stopIndexSchema,
} from './rides.schemas';
import type { RidesService } from './rides.service';

export function createRidesController(service: RidesService) {
  const rideId = (req: Parameters<RequestHandler>[0]) => rideIdSchema.parse(req.params['rideId']);
  const uid = (req: Parameters<RequestHandler>[0]) => actorFrom(req).userId;

  const get: RequestHandler = async (req, res) => {
    ok(res, await service.get(actorFrom(req), rideId(req)));
  };
  const enRoute: RequestHandler = async (req, res) => {
    ok(res, await service.enRoute(uid(req), rideId(req)));
  };
  const arrived: RequestHandler = async (req, res) => {
    ok(res, await service.arrived(uid(req), rideId(req), arrivedSchema.parse(req.body ?? {})));
  };
  const start: RequestHandler = async (req, res) => {
    ok(res, await service.start(uid(req), rideId(req), startSchema.parse(req.body)));
  };
  const complete: RequestHandler = async (req, res) => {
    ok(res, await service.complete(uid(req), rideId(req), completeSchema.parse(req.body ?? {})));
  };
  const driverCancel: RequestHandler = async (req, res) => {
    ok(res, await service.driverCancel(uid(req), rideId(req), driverCancelSchema.parse(req.body)));
  };
  const customerCancel: RequestHandler = async (req, res) => {
    const bookingId = bookingIdSchema.parse(req.params['bookingId']);
    ok(
      res,
      await service.customerCancel(uid(req), bookingId, customerCancelSchema.parse(req.body)),
    );
  };
  const pickupOtp: RequestHandler = async (req, res) => {
    ok(res, await service.pickupOtp(uid(req), rideId(req)));
  };
  const resendOtp: RequestHandler = async (req, res) => {
    ok(res, await service.resendOtp(uid(req), rideId(req)), 201);
  };
  const track: RequestHandler = async (req, res) => {
    ok(res, await service.track(uid(req), rideId(req)));
  };
  const customerHistory: RequestHandler = async (req, res) => {
    const { items, meta } = await service.customerHistory(
      uid(req),
      historyQuerySchema.parse(req.query),
    );
    ok(res, items, 200, meta);
  };
  const driverHistory: RequestHandler = async (req, res) => {
    const { items, meta } = await service.driverHistory(
      uid(req),
      historyQuerySchema.parse(req.query),
    );
    ok(res, items, 200, meta);
  };

  const stopArrived: RequestHandler = async (req, res) => {
    const index = stopIndexSchema.parse(req.params['index']);
    ok(res, await service.stopArrived(uid(req), rideId(req), index));
  };
  const stopDeparted: RequestHandler = async (req, res) => {
    const index = stopIndexSchema.parse(req.params['index']);
    ok(res, await service.stopDeparted(uid(req), rideId(req), index));
  };
  const requestDestination: RequestHandler = async (req, res) => {
    const input = destinationRequestSchema.parse(req.body);
    ok(res, await service.requestDestination(uid(req), rideId(req), input), 201);
  };
  const respondDestination: RequestHandler = async (req, res) => {
    const { accept } = destinationRespondSchema.parse(req.body);
    ok(res, await service.respondDestination(uid(req), rideId(req), accept));
  };
  const noShow: RequestHandler = async (req, res) => {
    ok(res, await service.noShow(uid(req), rideId(req)));
  };
  const receipt: RequestHandler = async (req, res) => {
    ok(res, await service.receipt(actorFrom(req), rideId(req)));
  };
  const cancelPreview: RequestHandler = async (req, res) => {
    const bookingId = bookingIdSchema.parse(req.params['bookingId']);
    ok(res, await service.cancelPreview(uid(req), bookingId));
  };

  return {
    stopArrived,
    stopDeparted,
    requestDestination,
    respondDestination,
    noShow,
    receipt,
    cancelPreview,
    get,
    enRoute,
    arrived,
    start,
    complete,
    driverCancel,
    customerCancel,
    pickupOtp,
    resendOtp,
    track,
    customerHistory,
    driverHistory,
  };
}
