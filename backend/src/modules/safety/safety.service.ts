import { createHash, randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { SAFETY_ROLES, type Role } from '../../common/enums';
import { AppError } from '../../common/errors';
import { fromPoint } from '../../common/geo';
import { publicId } from '../../common/ids';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { normalizePhone } from '../../common/phone';
import type { SmsProvider } from '../../providers';
import { ServerEvents } from '../../realtime/events';
import type { RealtimeBus } from '../../realtime/bus';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import type { FlagsService } from '../flags/flags.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { Ride } from '../rides/ride.model';
import { User } from '../users/user.model';
import { Vehicle } from '../vehicles/vehicle.model';
import {
  EmergencyContact,
  IncidentOutcomes,
  IncidentStatuses,
  SafetyIncident,
  TripShare,
} from './safety.models';

const DUPLICATE_KEY = 11000;
const MAX_CONTACTS = 3;
const MAX_ACTIVE_SHARES = 5;
const SHARE_HARD_CAP_MS = 24 * 3_600_000;
/** The booking states in which a ride is live: SOS and trip sharing exist only then. */
const LIVE = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const sosSchema = z.object({ note: z.string().trim().max(300).optional() }).strict();
export const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(8).max(20),
    relationship: z.string().trim().max(40).optional(),
  })
  .strict();
export const incidentListQuerySchema = paginationSchema.extend({
  status: z.enum(IncidentStatuses).optional(),
});
export const noteSchema = z.object({ text: z.string().trim().min(1).max(500) }).strict();
export const resolveIncidentSchema = z
  .object({ outcome: z.enum(IncidentOutcomes), note: z.string().trim().max(500).optional() })
  .strict();

export type SosInput = z.infer<typeof sosSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;
export type ResolveIncidentInput = z.infer<typeof resolveIncidentSchema>;

type IncidentDoc = {
  publicId: string;
  bookingPublicId: string;
  ridePublicId: string;
  triggeredBy: { userId: Types.ObjectId; role: string };
  note?: string | null;
  status: string;
  snapshot?: unknown;
  contactsNotified?: number | null;
  notes?: { by: Types.ObjectId; text: string; at: Date }[];
  acknowledgedBy?: Types.ObjectId | null;
  acknowledgedAt?: Date | null;
  escalatedAt?: Date | null;
  resolvedAt?: Date | null;
  outcome?: string | null;
  outcomeNote?: string | null;
  createdAt: Date;
};

export function createSafetyService(deps: {
  flags: FlagsService;
  audit: AuditService;
  notifications: Pick<NotificationsService, 'notify'>;
  bus: Pick<RealtimeBus, 'emitToOps'>;
  sms: SmsProvider;
  now: () => Date;
  logger: Logger;
  /** An alert nobody has acknowledged after this long is escalated to a super admin. */
  ackWindowMs: number;
  /** Web page that shows a shared trip (no trailing slash). Without it the API path is used. */
  tripLinkBase?: string | undefined;
}) {
  const { flags, audit, notifications, bus, sms, now, logger, ackWindowMs } = deps;
  const tripLink = (token: string) =>
    deps.tripLinkBase ? `${deps.tripLinkBase}/${token}` : `/api/v1/public/trips/${token}`;

  /* ---------------- emergency contacts ---------------- */

  const contactView = (c: {
    _id: { toString(): string };
    name: string;
    phone: string;
    relationship?: string | null;
  }) => ({
    id: c._id.toString(),
    name: c.name,
    phone: c.phone,
    relationship: c.relationship ?? null,
  });

  /* ---------------- helpers ---------------- */

  /** The ride, if the caller is on it and it is live. Anyone else gets "not found". */
  async function liveRide(actor: Actor, ridePublicId: string) {
    const ride = await Ride.findOne({ publicId: ridePublicId });
    if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
    const booking = await Booking.findById(ride.bookingId);
    if (!booking) throw new AppError('NOT_FOUND', 'Ride not found.');
    const rider = actor.role === 'CUSTOMER' && ride.customerId.toString() === actor.userId;
    const driver =
      actor.role === 'DRIVER' &&
      ride.driverUserId.toString() === actor.userId &&
      Boolean(booking.assignedDriverId?.equals(ride.driverId));
    if (!rider && !driver) throw new AppError('NOT_FOUND', 'Ride not found.');
    if (!LIVE.includes(booking.status)) {
      throw new AppError('RIDE_INVALID_STATE', 'This is only available while a ride is under way.');
    }
    return { ride, booking };
  }

  async function newShare(bookingId: Types.ObjectId, userId: string) {
    const token = randomBytes(24).toString('base64url');
    await TripShare.create({
      tokenHash: sha(token),
      bookingId,
      createdBy: userId,
      expiresAt: new Date(now().getTime() + SHARE_HARD_CAP_MS),
    });
    return token;
  }

  async function snapshotOf(
    ride: { driverId: Types.ObjectId; vehicleId: Types.ObjectId; customerId: Types.ObjectId },
    booking: {
      status: string;
      pickup: { label?: string | null; location?: { coordinates: number[] } | null };
      drop: { label?: string | null; location?: { coordinates: number[] } | null };
    },
  ) {
    const [driverProfile, vehicle, rider] = await Promise.all([
      DriverProfile.findById(ride.driverId)
        .select('userId currentLocation locationUpdatedAt')
        .lean(),
      Vehicle.findById(ride.vehicleId).lean(),
      User.findById(ride.customerId).select('name phone').lean(),
    ]);
    const driverUser = driverProfile
      ? await User.findById(driverProfile.userId).select('name phone').lean()
      : null;
    const point = (p: { label?: string | null; location?: { coordinates: number[] } | null }) => ({
      ...(p.location ? fromPoint(p.location) : {}),
      label: p.label ?? undefined,
    });
    return {
      bookingStatus: booking.status,
      pickup: point(booking.pickup),
      drop: point(booking.drop),
      driverLocation: driverProfile?.currentLocation
        ? { ...fromPoint(driverProfile.currentLocation), at: driverProfile.locationUpdatedAt }
        : undefined,
      rider: { name: rider?.name ?? undefined, phone: rider?.phone },
      driver: { name: driverUser?.name ?? undefined, phone: driverUser?.phone },
      vehicle: vehicle
        ? {
            registrationNumber: vehicle.registrationNumber,
            make: vehicle.make ?? undefined,
            model: vehicle.model ?? undefined,
            color: vehicle.color ?? undefined,
          }
        : undefined,
    };
  }

  /** Tell staff, by live event and by push. Best effort: a failure is logged, never shown to the person in danger. */
  async function alertStaff(
    kind: 'TRIGGERED' | 'ESCALATED',
    incident: { publicId: string; bookingPublicId: string },
    roles: readonly Role[],
  ) {
    try {
      bus.emitToOps(ServerEvents.OPS_SOS, {
        incidentId: incident.publicId,
        bookingId: incident.bookingPublicId,
        kind,
      });
      const staff = await User.find({ role: { $in: roles }, accountStatus: 'ACTIVE' })
        .select('_id')
        .limit(50)
        .lean();
      for (const u of staff) {
        await notifications.notify(u._id.toString(), {
          type: kind === 'TRIGGERED' ? 'safety.sos' : 'safety.sos_escalated',
          title: kind === 'TRIGGERED' ? 'SOS alert' : 'SOS NOT ACKNOWLEDGED',
          body: `Emergency during booking ${incident.bookingPublicId}. Open the incident now.`,
          data: { incidentId: incident.publicId, bookingId: incident.bookingPublicId },
          dedupeKey: `sos:${kind}:${incident.publicId}:${u._id.toString()}`,
          priority: 'high',
        });
      }
    } catch (err) {
      logger.error({ err, incidentId: incident.publicId }, 'could not alert staff about an SOS');
    }
  }

  const incidentView = (i: IncidentDoc, forStaff: boolean) => ({
    incidentId: i.publicId,
    bookingId: i.bookingPublicId,
    rideId: i.ridePublicId,
    status: i.status,
    triggeredBy: forStaff
      ? { userId: i.triggeredBy.userId.toString(), role: i.triggeredBy.role }
      : { role: i.triggeredBy.role },
    note: i.note ?? null,
    createdAt: i.createdAt,
    acknowledgedAt: i.acknowledgedAt ?? null,
    escalatedAt: forStaff ? (i.escalatedAt ?? null) : undefined,
    resolvedAt: i.resolvedAt ?? null,
    outcome: i.outcome ?? null,
    ...(forStaff
      ? {
          contactsNotified: i.contactsNotified ?? 0,
          snapshot: i.snapshot,
          notes: (i.notes ?? []).map((n) => ({ by: n.by.toString(), text: n.text, at: n.at })),
          outcomeNote: i.outcomeNote ?? null,
        }
      : {}),
  });

  return {
    /* ---------------- emergency contacts ---------------- */

    async listContacts(userId: string) {
      return (await EmergencyContact.find({ userId }).sort({ createdAt: 1 }).lean()).map(
        contactView,
      );
    },

    async addContact(userId: string, input: ContactInput) {
      const phone = normalizePhone(input.phone);
      if (!phone) {
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'phone', message: 'Invalid phone number' },
        ]);
      }
      if ((await EmergencyContact.countDocuments({ userId })) >= MAX_CONTACTS) {
        throw new AppError(
          'UNPROCESSABLE',
          `You can save at most ${MAX_CONTACTS} emergency contacts.`,
        );
      }
      try {
        const c = await EmergencyContact.create({
          userId,
          name: input.name,
          phone,
          ...(input.relationship ? { relationship: input.relationship } : {}),
        });
        return contactView(c.toObject());
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          throw new AppError('CONFLICT', 'This contact is already saved.');
        }
        throw err;
      }
    },

    async removeContact(userId: string, contactId: string) {
      const res = await EmergencyContact.deleteOne({ _id: contactId, userId });
      if (res.deletedCount !== 1) throw new AppError('NOT_FOUND', 'Contact not found.');
    },

    /* ---------------- SOS (rider or driver) ---------------- */

    async trigger(actor: Actor, ridePublicId: string, input: SosInput) {
      await flags.assertEnabled('SOS', actor.role);
      const { ride, booking } = await liveRide(actor, ridePublicId);

      const existing = await SafetyIncident.findOne({
        bookingId: booking._id,
        'triggeredBy.userId': actor.userId,
        open: true,
      });
      if (existing)
        return { ...incidentView(existing as unknown as IncidentDoc, false), replayed: true };

      let incident;
      try {
        incident = await SafetyIncident.create({
          publicId: publicId('inc'),
          bookingId: booking._id,
          bookingPublicId: booking.publicId,
          ridePublicId: ride.publicId,
          triggeredBy: { userId: actor.userId, role: actor.role as 'CUSTOMER' | 'DRIVER' },
          ...(input.note ? { note: input.note } : {}),
          snapshot: await snapshotOf(ride, booking),
        });
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          const raced = await SafetyIncident.findOne({
            bookingId: booking._id,
            'triggeredBy.userId': actor.userId,
            open: true,
          });
          if (raced)
            return { ...incidentView(raced as unknown as IncidentDoc, false), replayed: true };
        }
        throw err;
      }

      // 1. Staff first: this is the part that gets help moving.
      await alertStaff('TRIGGERED', incident, SAFETY_ROLES);

      // 2. The person's saved contacts, with a link to follow the trip.
      try {
        const contacts = await EmergencyContact.find({ userId: actor.userId }).lean();
        if (contacts.length > 0) {
          const who = (await User.findById(actor.userId).select('name').lean())?.name ?? 'Someone';
          const token = await newShare(booking._id, actor.userId);
          let sent = 0;
          for (const c of contacts) {
            try {
              await sms.sendText(
                c.phone,
                `${who} has raised an emergency alert during a ride. Follow the trip: ${tripLink(token)}`,
              );
              sent += 1;
            } catch (err) {
              logger.error({ err }, 'emergency contact text failed');
            }
          }
          await SafetyIncident.updateOne({ _id: incident._id }, { contactsNotified: sent });
        }
      } catch (err) {
        logger.error({ err, incidentId: incident.publicId }, 'could not notify emergency contacts');
      }

      const fresh = (await SafetyIncident.findById(incident._id))!;
      return { ...incidentView(fresh as unknown as IncidentDoc, false), replayed: false };
    },

    /** The caller's own alerts on this ride (so the app can show "help is on the way"). */
    async mine(actor: Actor, ridePublicId: string) {
      const ride = await Ride.findOne({ publicId: ridePublicId }).select('_id').lean();
      if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
      const rows = await SafetyIncident.find({ ridePublicId, 'triggeredBy.userId': actor.userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      return rows.map((r) => incidentView(r as unknown as IncidentDoc, false));
    },

    /* ---------------- staff ---------------- */

    async list(query: IncidentListQuery) {
      const filter = query.status ? { status: query.status } : {};
      const [total, rows] = await Promise.all([
        SafetyIncident.countDocuments(filter),
        SafetyIncident.find(filter)
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return {
        items: rows.map((r) => ({
          ...incidentView(r as unknown as IncidentDoc, true),
          snapshot: undefined,
          notes: undefined,
        })),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    /** Opening an incident shows phone numbers and positions, so it is audited. */
    async detail(actor: Actor, incidentId: string) {
      const i = await SafetyIncident.findOne({ publicId: incidentId });
      if (!i) throw new AppError('NOT_FOUND');
      await audit.record(actor, {
        action: 'safety.incident.view',
        targetType: 'SafetyIncident',
        targetId: incidentId,
      });
      return incidentView(i as unknown as IncidentDoc, true);
    },

    async acknowledge(actor: Actor, incidentId: string) {
      const i = await SafetyIncident.findOneAndUpdate(
        { publicId: incidentId, status: 'OPEN' },
        { status: 'ACKNOWLEDGED', acknowledgedBy: actor.userId, acknowledgedAt: now() },
        { returnDocument: 'after' },
      );
      if (!i) {
        if (!(await SafetyIncident.exists({ publicId: incidentId })))
          throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'This alert has already been acknowledged.');
      }
      await audit.record(actor, {
        action: 'safety.incident.acknowledge',
        targetType: 'SafetyIncident',
        targetId: incidentId,
      });
      return incidentView(i as unknown as IncidentDoc, true);
    },

    async addNote(actor: Actor, incidentId: string, text: string) {
      const i = await SafetyIncident.findOneAndUpdate(
        { publicId: incidentId },
        { $push: { notes: { by: actor.userId, text, at: now() } } },
        { returnDocument: 'after' },
      );
      if (!i) throw new AppError('NOT_FOUND');
      await audit.record(actor, {
        action: 'safety.incident.note',
        targetType: 'SafetyIncident',
        targetId: incidentId,
      });
      return incidentView(i as unknown as IncidentDoc, true);
    },

    async resolve(actor: Actor, incidentId: string, input: ResolveIncidentInput) {
      const i = await SafetyIncident.findOneAndUpdate(
        { publicId: incidentId, status: { $in: ['OPEN', 'ACKNOWLEDGED'] } },
        {
          status: 'RESOLVED',
          open: false,
          resolvedBy: actor.userId,
          resolvedAt: now(),
          outcome: input.outcome,
          ...(input.note ? { outcomeNote: input.note } : {}),
        },
        { returnDocument: 'after' },
      );
      if (!i) {
        if (!(await SafetyIncident.exists({ publicId: incidentId })))
          throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'This alert is already resolved.');
      }
      await audit.record(actor, {
        action: 'safety.incident.resolve',
        targetType: 'SafetyIncident',
        targetId: incidentId,
        metadata: { outcome: input.outcome },
      });
      return incidentView(i as unknown as IncidentDoc, true);
    },

    /** Where the driver is right now (staff poll this while an alert is open). */
    async liveLocation(incidentId: string) {
      const i = await SafetyIncident.findOne({ publicId: incidentId }).lean();
      if (!i) throw new AppError('NOT_FOUND');
      const booking = await Booking.findById(i.bookingId).select('status assignedDriverId').lean();
      const live = Boolean(booking && LIVE.includes(booking.status));
      const driver =
        live && booking?.assignedDriverId
          ? await DriverProfile.findById(booking.assignedDriverId)
              .select('currentLocation locationUpdatedAt')
              .lean()
          : null;
      return {
        incidentId,
        rideLive: live,
        bookingStatus: booking?.status ?? null,
        location: driver?.currentLocation
          ? { ...fromPoint(driver.currentLocation), updatedAt: driver.locationUpdatedAt ?? null }
          : (i.snapshot?.driverLocation ?? null),
      };
    },

    /** Nobody has taken an alert for a while: raise it again to the super admins. Runs on a timer. */
    async escalate(): Promise<{ escalated: number }> {
      const cutoff = new Date(now().getTime() - ackWindowMs);
      const overdueFilter: Record<string, unknown> = {
        status: 'OPEN',
        escalatedAt: { $exists: false },
        createdAt: { $lte: cutoff },
      };
      const overdue = await SafetyIncident.find(overdueFilter).limit(50).lean();
      let escalated = 0;
      for (const i of overdue) {
        const marked = await SafetyIncident.updateOne(
          { _id: i._id, status: 'OPEN', escalatedAt: { $exists: false } },
          { escalatedAt: now() },
        );
        if (marked.modifiedCount !== 1) continue; // another instance did it
        escalated += 1;
        await alertStaff('ESCALATED', i, ['SUPER_ADMIN']);
      }
      return { escalated };
    },

    /* ---------------- trip sharing ---------------- */

    async share(actor: Actor, ridePublicId: string) {
      await flags.assertEnabled('TRIP_SHARING', actor.role);
      if (actor.role !== 'CUSTOMER') throw new AppError('FORBIDDEN');
      const { booking } = await liveRide(actor, ridePublicId);
      const active = await TripShare.countDocuments({
        bookingId: booking._id,
        revokedAt: { $exists: false },
      });
      if (active >= MAX_ACTIVE_SHARES) {
        throw new AppError(
          'UNPROCESSABLE',
          'Stop sharing first: too many live links for this ride.',
        );
      }
      const token = await newShare(booking._id, actor.userId);
      return { token, path: `/api/v1/public/trips/${token}` };
    },

    async stopSharing(actor: Actor, ridePublicId: string) {
      const ride = await Ride.findOne({ publicId: ridePublicId, customerId: actor.userId })
        .select('bookingId')
        .lean();
      if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
      const res = await TripShare.updateMany(
        { bookingId: ride.bookingId, revokedAt: { $exists: false } },
        { revokedAt: now() },
      );
      return { revoked: res.modifiedCount };
    },

    /** What someone with the link sees: no phone numbers, and nothing once the ride is over. */
    async publicTrip(token: string) {
      const share = await TripShare.findOne({
        tokenHash: sha(token),
        revokedAt: { $exists: false },
        expiresAt: { $gt: now() },
      }).lean();
      if (!share) throw new AppError('NOT_FOUND', 'This link is not valid.');
      const booking = await Booking.findById(share.bookingId).lean();
      if (!booking) throw new AppError('NOT_FOUND', 'This link is not valid.');
      if (!LIVE.includes(booking.status) || !booking.assignedDriverId) {
        return {
          live: false,
          status: booking.status === 'COMPLETED' ? 'ENDED' : 'NOT_STARTED_OR_ENDED',
        };
      }
      const [driver, ride] = await Promise.all([
        DriverProfile.findById(booking.assignedDriverId)
          .select('userId currentLocation locationUpdatedAt currentVehicleId')
          .lean(),
        Ride.findOne({ bookingId: booking._id }).select('vehicleId').lean(),
      ]);
      const [user, vehicle] = await Promise.all([
        driver ? User.findById(driver.userId).select('name').lean() : null,
        ride ? Vehicle.findById(ride.vehicleId).lean() : null,
      ]);
      return {
        live: true,
        status: booking.status,
        pickup: { ...fromPoint(booking.pickup.location!), label: booking.pickup.label ?? null },
        drop: { ...fromPoint(booking.drop.location!), label: booking.drop.label ?? null },
        driver: {
          firstName: user?.name?.trim().split(/\s+/)[0] ?? null,
          vehicle: vehicle
            ? {
                registrationNumber: vehicle.registrationNumber,
                make: vehicle.make ?? null,
                model: vehicle.model ?? null,
                color: vehicle.color ?? null,
              }
            : null,
          location: driver?.currentLocation
            ? { ...fromPoint(driver.currentLocation), updatedAt: driver.locationUpdatedAt ?? null }
            : null,
        },
      };
    },
  };
}

export type SafetyService = ReturnType<typeof createSafetyService>;
