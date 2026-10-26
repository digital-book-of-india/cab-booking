import type { Types } from 'mongoose';
import type { Logger } from 'pino';
import { Booking, type BookingStatus } from '../modules/bookings/booking.model';
import type { ActorType } from '../modules/bookings/transitions';
import type { DispatchConfig } from '../modules/dispatch/dispatch.config';
import { DriverProfile } from '../modules/drivers/driverProfile.model';
import type { NotificationsService } from '../modules/notifications/notifications.service';
import { LocationPing } from '../modules/tracking/locationPing.model';
import type { RealtimeBus } from './bus';
import { ServerEvents, type OfferClosedReason, type RideUpdateKind } from './events';

/** The rider may see the driver's position only in these states. Never before, never after. */
const TRACKING_STATUSES: BookingStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];
const TERMINAL: BookingStatus[] = ['COMPLETED', 'CANCELLED', 'NO_DRIVER_FOUND', 'NO_SHOW'];
const MAX_TRACKED = 5000;

const rupees = (paise: number | null | undefined) =>
  paise === null || paise === undefined ? '' : `₹${(paise / 100).toFixed(2).replace(/\.00$/, '')}`;

type PushPlan = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

export type BookingChange = {
  eventId: string;
  /** The timeline event type (e.g. DRIVER_CANCELLED_REDISPATCH) for cases the status alone can't tell. */
  type?: string;
  toStatus?: BookingStatus;
  actorType: ActorType;
};

/**
 * Turns "something changed in the database" into (a) live socket events and (b) notification
 * records for push. It is called AFTER the change is saved and it never throws, so a realtime or
 * push problem can never fail or slow a ride action.
 */
export function createNotifier(deps: {
  bus: RealtimeBus;
  notifications: Pick<NotificationsService, 'notify' | 'cancelPending'>;
  now: () => Date;
  logger: Logger;
  config: Pick<DispatchConfig, 'trackMinIntervalMs' | 'trailMinIntervalMs'>;
}) {
  const { bus, notifications, now, logger, config } = deps;
  const lastEmit = new Map<string, number>();
  const lastTrail = new Map<string, number>();

  const safe = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, `realtime ${what} failed`);
    }
  };

  function forget(bookingId: string) {
    lastEmit.delete(bookingId);
    lastTrail.delete(bookingId);
  }

  return {
    async bookingChanged(bookingId: Types.ObjectId, change: BookingChange): Promise<void> {
      if (!change.toStatus) return;
      const status = change.toStatus;
      await safe('booking change', async () => {
        const b = await Booking.findById(bookingId)
          .select(
            'publicId customerId assignedDriverId rideId paymentMethod finalFarePaise estimatedFarePaise cancellation fee rideType scheduledFor',
          )
          .lean();
        if (!b) return;
        const driverProfile = b.assignedDriverId
          ? await DriverProfile.findById(b.assignedDriverId).select('userId').lean()
          : null;
        const customerUser = b.customerId.toString();
        const driverUser = driverProfile?.userId.toString() ?? null;
        const base = { bookingId: b.publicId, rideId: b.rideId ?? null, status };

        bus.emitToUsers([customerUser], ServerEvents.BOOKING_STATUS, base);
        if (driverUser) bus.emitToUsers([driverUser], ServerEvents.RIDE_STATUS, base);
        bus.emitToOps(ServerEvents.OPS_BOOKING, { bookingId: b.publicId, status });
        if (TERMINAL.includes(status)) forget(bookingId.toString());

        const data = { bookingId: b.publicId, rideId: b.rideId ?? '', status };
        const fare = rupees(b.finalFarePaise ?? b.estimatedFarePaise);
        const plans: PushPlan[] = [];
        const toRider = (type: string, title: string, body: string) =>
          plans.push({ userId: customerUser, type, title, body, data });
        const toDriver = (type: string, title: string, body: string) => {
          if (driverUser) plans.push({ userId: driverUser, type, title, body, data });
        };

        switch (status) {
          case 'DRIVER_ASSIGNED':
            toRider('ride.assigned', 'Driver assigned', 'Your driver is on the way.');
            break;
          case 'DRIVER_ARRIVING':
            toRider('ride.arriving', 'Driver is on the way', 'Track your driver in the app.');
            break;
          case 'DRIVER_ARRIVED':
            toRider('ride.arrived', 'Your driver has arrived', 'Share your pickup code to start.');
            break;
          case 'IN_PROGRESS':
            toRider('ride.started', 'Ride started', 'Have a safe trip.');
            break;
          case 'COMPLETED':
            toRider('ride.completed', 'Ride completed', fare ? `Fare: ${fare}.` : 'Thank you.');
            toDriver(
              'ride.completed',
              'Ride completed',
              b.paymentMethod === 'CASH' && fare ? `Collect ${fare} in cash.` : `Fare: ${fare}.`,
            );
            break;
          case 'NO_SHOW': {
            const charge =
              b.fee && b.fee.status === 'DUE'
                ? ` A fee of ${rupees(b.fee.amountPaise)} applies.`
                : '';
            toRider(
              'ride.no_show',
              'Booking closed',
              `The driver waited at the pickup and could not find you.${charge}`,
            );
            toDriver(
              'ride.no_show',
              'Marked as no-show',
              'The ride was closed as a rider no-show.',
            );
            break;
          }
          case 'DISPATCHING':
            if (change.type === 'DRIVER_CANCELLED_REDISPATCH') {
              toRider(
                'ride.driver_cancelled',
                'Your driver cancelled',
                "We're finding you another driver.",
              );
            }
            break;
          case 'NO_DRIVER_FOUND':
            if (b.rideType === 'SCHEDULED' && b.scheduledFor) {
              // The pickup time has passed or is here: "try again in a moment" would be wrong.
              toRider(
                'booking.no_driver',
                'We could not find a driver',
                `We could not find a driver for your ride scheduled for ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(b.scheduledFor)}. You were not charged. Please book again.`,
              );
            } else {
              toRider('booking.no_driver', 'No drivers available', 'Please try again in a moment.');
            }
            break;
          case 'CANCELLED': {
            const by = b.cancellation?.actor;
            if (by === 'CUSTOMER') {
              toDriver('ride.cancelled', 'Ride cancelled', 'The rider cancelled this ride.');
            } else if (by === 'DRIVER') {
              toRider('ride.cancelled', 'Your driver cancelled', 'Please book again.');
            } else {
              toRider('ride.cancelled', 'Booking cancelled', 'This booking was cancelled.');
              toDriver('ride.cancelled', 'Ride cancelled', 'This ride was cancelled.');
            }
            break;
          }
          default:
            break; // REQUESTED / DISPATCHING: the app already shows "searching"
        }
        for (const p of plans) {
          await notifications.notify(p.userId, {
            type: p.type,
            title: p.title,
            body: p.body,
            data: p.data,
            dedupeKey: `ev:${change.eventId}:${p.userId}`,
          });
        }
      });
    },

    /**
     * A change to the ride that is not a status change (stop reached, destination change asked or
     * answered, fee waived). Tells the rider and/or the assigned driver, live and by push.
     */
    async rideUpdated(
      bookingId: Types.ObjectId,
      u: {
        eventId: string;
        kind: RideUpdateKind;
        data?: Record<string, unknown>;
        toRider?: boolean;
        toDriver?: boolean;
        /** For requests that expire (a destination change waits 30 s for the driver). */
        expiresAt?: Date;
      },
    ): Promise<void> {
      await safe('ride update', async () => {
        const b = await Booking.findById(bookingId)
          .select('publicId customerId assignedDriverId rideId')
          .lean();
        if (!b) return;
        const driverProfile = b.assignedDriverId
          ? await DriverProfile.findById(b.assignedDriverId).select('userId').lean()
          : null;
        const payload = {
          bookingId: b.publicId,
          rideId: b.rideId ?? null,
          kind: u.kind,
          ...(u.data ?? {}),
        };
        const rider = b.customerId.toString();
        const driver = driverProfile?.userId.toString() ?? null;
        const targets = [...(u.toRider ? [rider] : []), ...(u.toDriver && driver ? [driver] : [])];
        bus.emitToUsers(targets, ServerEvents.RIDE_UPDATE, payload);

        const push = (userId: string, type: string, title: string, body: string, high = false) =>
          notifications.notify(userId, {
            type,
            title,
            body,
            data: { bookingId: b.publicId, rideId: b.rideId ?? '', kind: u.kind },
            dedupeKey: `ev:${u.eventId}:${userId}`,
            ...(high ? { priority: 'high' as const } : {}),
            ...(u.expiresAt ? { expiresAt: u.expiresAt } : {}),
          });
        if (u.kind === 'DESTINATION_REQUESTED' && driver) {
          await push(
            driver,
            'ride.destination_requested',
            'Destination change requested',
            'The rider wants to change the drop-off. Answer within 30 seconds.',
            true,
          );
        } else if (u.kind === 'DESTINATION_ACCEPTED') {
          await push(
            rider,
            'ride.destination_accepted',
            'New destination confirmed',
            'Your driver accepted the new drop-off.',
          );
        } else if (u.kind === 'DESTINATION_DECLINED') {
          await push(
            rider,
            'ride.destination_declined',
            'Destination not changed',
            'Your driver could not take the new drop-off.',
          );
        } else if (u.kind === 'FEE_WAIVED') {
          await push(
            rider,
            'booking.fee_waived',
            'Fee waived',
            'The fee on your booking has been waived.',
          );
        }
      });
    },

    async offerCreated(o: {
      offerId: string;
      bookingId: string;
      driverUserId: string;
      expiresAt: Date;
      pickupLabel?: string | null;
      estimatedFarePaise: number;
    }): Promise<void> {
      await safe('offer', async () => {
        bus.emitToUsers([o.driverUserId], ServerEvents.OFFER_NEW, {
          offerId: o.offerId,
          bookingId: o.bookingId,
          expiresAt: o.expiresAt.toISOString(),
        });
        await notifications.notify(o.driverUserId, {
          type: 'offer.new',
          title: 'New ride request',
          body: `${o.pickupLabel || 'Pickup nearby'} · est. ${rupees(o.estimatedFarePaise)}`,
          data: { offerId: o.offerId, bookingId: o.bookingId },
          dedupeKey: `offer:${o.offerId}`,
          priority: 'high',
          expiresAt: o.expiresAt,
        });
      });
    },

    async offersClosed(
      offers: { publicId: string; driverId: Types.ObjectId }[],
      reason: OfferClosedReason,
    ): Promise<void> {
      if (offers.length === 0) return;
      await safe('offer close', async () => {
        const profiles = await DriverProfile.find({ _id: { $in: offers.map((o) => o.driverId) } })
          .select('userId')
          .lean();
        const userOf = new Map(profiles.map((p) => [p._id.toString(), p.userId.toString()]));
        for (const o of offers) {
          const user = userOf.get(o.driverId.toString());
          if (!user) continue;
          bus.emitToUsers([user], ServerEvents.OFFER_CLOSED, { offerId: o.publicId, reason });
          await notifications.cancelPending(user, `offer:${o.publicId}`);
        }
      });
    },

    /** The driver answered this offer themselves: their "new ride request" push must not arrive late. */
    async offerAnswered(driverUserId: string, offerPublicId: string): Promise<void> {
      await safe('offer answered', async () => {
        await notifications.cancelPending(driverUserId, `offer:${offerPublicId}`);
      });
    },

    /**
     * A driver on an active ride sent a position. Tell that ride's rider (throttled) and keep a
     * sampled trail. Does nothing unless the booking is in a tracking state.
     */
    async driverMoved(p: {
      driverId: Types.ObjectId;
      bookingId: Types.ObjectId;
      lat: number;
      lng: number;
      headingDegrees?: number;
      accuracyMeters?: number;
      recordedAt: Date;
    }): Promise<void> {
      const key = p.bookingId.toString();
      const t = now().getTime();
      const wantEmit = t - (lastEmit.get(key) ?? 0) >= config.trackMinIntervalMs;
      const wantTrail = t - (lastTrail.get(key) ?? 0) >= config.trailMinIntervalMs;
      if (!wantEmit && !wantTrail) return;
      await safe('tracking', async () => {
        const b = await Booking.findById(p.bookingId)
          .select('status customerId rideId publicId')
          .lean();
        if (!b || !TRACKING_STATUSES.includes(b.status)) return;
        if (lastEmit.size > MAX_TRACKED) lastEmit.clear();
        if (lastTrail.size > MAX_TRACKED) lastTrail.clear();
        if (wantEmit) {
          lastEmit.set(key, t);
          bus.emitToUsers([b.customerId.toString()], ServerEvents.DRIVER_LOCATION, {
            rideId: b.rideId ?? null,
            bookingId: b.publicId,
            lat: p.lat,
            lng: p.lng,
            ...(p.headingDegrees !== undefined ? { headingDegrees: p.headingDegrees } : {}),
            recordedAt: p.recordedAt.toISOString(),
          });
        }
        if (wantTrail) {
          lastTrail.set(key, t);
          await LocationPing.create({
            bookingId: b._id,
            ...(b.rideId ? { ridePublicId: b.rideId } : {}),
            driverId: p.driverId,
            location: { type: 'Point', coordinates: [p.lng, p.lat] },
            ...(p.accuracyMeters !== undefined ? { accuracyMeters: p.accuracyMeters } : {}),
            ...(p.headingDegrees !== undefined ? { headingDegrees: p.headingDegrees } : {}),
            recordedAt: p.recordedAt,
            bookingStatus: b.status,
          });
        }
      });
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
