import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { fromPoint } from '../../common/geo';
import { pageMeta } from '../../common/pagination';
import { escapeRegex } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { Session } from '../auth/session.model';
import { Booking, type BookingStatus } from '../bookings/booking.model';
import { BookingEvent } from '../bookings/bookingEvent.model';
import { CustomerProfile } from '../customers/customerProfile.model';
import { ServiceZone } from '../zones/serviceZone.model';
import { CabCategory } from '../categories/cabCategory.model';
import type { DispatchService } from '../dispatch/dispatch.service';
import { RideOffer } from '../dispatch/rideOffer.model';
import { DriverDocument } from '../drivers/driverDocument.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { Ride } from '../rides/ride.model';
import { rideView } from '../rides/rides.views';
import { User } from '../users/user.model';
import { Vehicle } from '../vehicles/vehicle.model';
import { LocationPing } from '../tracking/locationPing.model';
import type { RealtimeBus } from '../../realtime/bus';
import type { Notifier } from '../../realtime/notifier';
import type { LedgerService } from '../ledger/ledger.service';
import { recordEvent } from '../bookings/transitions';
import type {
  BookingListQuery,
  BookingRestrictionInput,
  DispatchQueueQuery,
  ExpiringDocumentsQuery,
  LiveDriversQuery,
  ManualAssignDriverInput,
  UserListQuery,
  UserStatusInput,
  WaiveFeeInput,
} from './admin.schemas';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  'SCHEDULED',
  'REQUESTED',
  'DISPATCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

type UserLean = {
  _id: { toString(): string };
  role: string;
  phone: string;
  name?: string | null;
  accountStatus: string;
  createdAt: Date;
};

const userRow = (u: UserLean) => ({
  userId: u._id.toString(),
  role: u.role,
  phone: u.phone,
  name: u.name ?? null,
  accountStatus: u.accountStatus,
  createdAt: u.createdAt,
});

export function createAdminService(deps: {
  audit: AuditService;
  now: () => Date;
  bus?: Pick<RealtimeBus, 'disconnectUser'>;
  notifier?: Pick<Notifier, 'rideUpdated'>;
  ledger?: Pick<LedgerService, 'waiveFeeSafe'>;
  dispatch?: Pick<DispatchService, 'manualAssign'>;
}) {
  const { audit, now, bus, notifier, ledger, dispatch } = deps;

  async function countBy(
    model: typeof Booking | typeof DriverProfile,
    field: string,
    match: Record<string, unknown> = {},
  ): Promise<Record<string, number>> {
    const rows = await model.aggregate<{ _id: string; n: number }>([
      { $match: match },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }

  return {
    /* ---------- Users ---------- */

    async listUsers(query: UserListQuery) {
      const { page, limit, role, accountStatus, q } = query;
      const filter: Record<string, unknown> = {};
      if (role) filter['role'] = role;
      if (accountStatus) filter['accountStatus'] = accountStatus;
      if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        filter['$or'] = [{ phone: rx }, { name: rx }];
      }
      const [total, rows] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const customerIds = rows.filter((r) => r.role === 'CUSTOMER').map((r) => r._id);
      const profiles =
        customerIds.length > 0
          ? await CustomerProfile.find({ userId: { $in: customerIds } }).lean()
          : [];
      const profileByUserId = new Map(profiles.map((p) => [p.userId.toString(), p]));

      return {
        items: rows.map((u) => {
          const row = userRow(u);
          const cp = profileByUserId.get(row.userId);
          return {
            ...row,
            bookingRestriction: cp?.bookingRestricted
              ? cp.bookingRestrictionReason || 'RESTRICTED'
              : null,
          };
        }),
        meta: pageMeta(page, limit, total),
      };
    },

    async userDetail(userId: string) {
      const user = await User.findById(userId).lean();
      if (!user) throw new AppError('NOT_FOUND');
      const [driverProfile, customerProfile, bookingCount, liveSessions, totalSpentAgg] =
        await Promise.all([
          user.role === 'DRIVER' ? DriverProfile.findOne({ userId: user._id }).lean() : null,
          user.role === 'CUSTOMER' ? CustomerProfile.findOne({ userId: user._id }).lean() : null,
          user.role === 'CUSTOMER' ? Booking.countDocuments({ customerId: user._id }) : null,
          Session.countDocuments({ userId: user._id, revokedAt: null, expiresAt: { $gt: now() } }),
          user.role === 'CUSTOMER'
            ? Booking.aggregate([
                { $match: { customerId: user._id, status: 'COMPLETED' } },
                { $group: { _id: null, totalSpentPaise: { $sum: '$finalFarePaise' } } },
              ])
            : null,
        ]);
      return {
        ...userRow(user),
        phoneVerifiedAt: user.phoneVerifiedAt ?? null,
        liveSessions,
        bookingCount,
        totalSpentPaise: totalSpentAgg?.[0]?.totalSpentPaise ?? 0,
        driver: driverProfile
          ? {
              driverId: driverProfile._id.toString(),
              approvalStatus: driverProfile.approvalStatus,
              onlineStatus: driverProfile.onlineStatus,
            }
          : null,
        customer: customerProfile
          ? {
              email: customerProfile.email ?? null,
              ratingAvg:
                customerProfile.ratingCount > 0
                  ? Number((customerProfile.ratingSum / customerProfile.ratingCount).toFixed(1))
                  : null,
              ratingCount: customerProfile.ratingCount ?? 0,
              bookingRestricted: Boolean(customerProfile.bookingRestricted),
              bookingRestrictionReason: customerProfile.bookingRestrictionReason ?? null,
              bookingRestrictedAt: customerProfile.bookingRestrictedAt ?? null,
            }
          : null,
      };
    },

    /**
     * Suspend or reactivate an account. Suspending ends every login session at once. Drivers are
     * handled by the driver-approval workflow instead, so their approval state stays consistent.
     */
    async setUserStatus(actor: Actor, userId: string, input: UserStatusInput) {
      if (userId === actor.userId) {
        throw new AppError('UNPROCESSABLE', 'You cannot change your own account status.');
      }
      const target = await User.findById(userId);
      if (!target) throw new AppError('NOT_FOUND');
      if (target.role === 'DRIVER') {
        throw new AppError('UNPROCESSABLE', 'Use the driver approval decision (SUSPEND/APPROVE).');
      }
      if (target.role !== 'CUSTOMER' && actor.role !== 'SUPER_ADMIN') {
        throw new AppError('FORBIDDEN', 'Only a super admin can change a staff account.');
      }
      if (target.accountStatus === 'DELETED') {
        throw new AppError('UNPROCESSABLE', 'This account has been deleted.');
      }
      if (target.accountStatus === input.status) {
        throw new AppError('CONFLICT', `Account is already ${input.status}.`);
      }
      const previous = target.accountStatus;
      // Conditional on the status we read, so two admins acting at once cannot both "win".
      const updated = await User.findOneAndUpdate(
        { _id: target._id, accountStatus: previous },
        { accountStatus: input.status },
        { returnDocument: 'after' },
      );
      if (!updated) throw new AppError('CONFLICT', 'Account changed; reload and retry.');
      if (input.status === 'SUSPENDED') {
        await Session.updateMany({ userId: target._id, revokedAt: null }, { revokedAt: now() });
        bus?.disconnectUser(userId, 'SUSPENDED'); // live connections end now, not at the next check
      }
      await audit.record(actor, {
        action: input.status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
        targetType: 'User',
        targetId: userId,
        metadata: { reason: input.reason, from: previous, to: input.status },
      });
      return userRow(updated);
    },

    /* ---------- Bookings ---------- */

    async listBookings(query: BookingListQuery) {
      const { page, limit, status, paymentStatus, customerId, driverId, q, from, to } = query;
      const filter: Record<string, unknown> = {};
      if (status) filter['status'] = status;
      if (paymentStatus) filter['paymentStatus'] = paymentStatus;
      if (customerId) filter['customerId'] = customerId;
      if (driverId) filter['assignedDriverId'] = driverId;
      if (q) filter['publicId'] = new RegExp(`^${escapeRegex(q)}`);
      if (from || to) {
        filter['requestedAt'] = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
      }
      const [total, rows] = await Promise.all([
        Booking.countDocuments(filter),
        Booking.find(filter)
          .sort({ requestedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const customers = await User.find({ _id: { $in: rows.map((b) => b.customerId) } })
        .select('name phone')
        .lean();
      const byId = new Map(customers.map((c) => [c._id.toString(), c]));
      return {
        items: rows.map((b) => {
          const c = byId.get(b.customerId.toString());
          return {
            bookingId: b.publicId,
            rideId: b.rideId ?? null,
            status: b.status,
            paymentStatus: b.paymentStatus ?? 'NOT_DUE',
            paymentMethod: b.paymentMethod,
            customer: {
              userId: b.customerId.toString(),
              name: c?.name ?? null,
              phone: c?.phone ?? null,
            },
            driverId: b.assignedDriverId?.toString() ?? null,
            pickupLabel: b.pickup.label ?? null,
            dropLabel: b.drop.label ?? null,
            estimatedFarePaise: b.estimatedFarePaise,
            finalFarePaise: b.finalFarePaise ?? null,
            requestedAt: b.requestedAt,
          };
        }),
        meta: pageMeta(page, limit, total),
      };
    },

    /** Everything ops needs to answer "what happened to this booking?". */
    async bookingDetail(actor: Actor, bookingPublicId: string) {
      const booking = await Booking.findOne({ publicId: bookingPublicId }).lean();
      if (!booking) throw new AppError('NOT_FOUND');
      const [customer, ride, events, offers] = await Promise.all([
        User.findById(booking.customerId).select('name phone').lean(),
        Ride.findOne({ bookingId: booking._id }).lean(),
        BookingEvent.find({ bookingId: booking._id }).sort({ at: 1 }).lean(),
        RideOffer.find({ bookingId: booking._id }).sort({ round: 1, rank: 1 }).lean(),
      ]);
      // Viewing a rider's contact details is a sensitive read, so it is audited.
      await audit.record(actor, {
        action: 'BOOKING_VIEWED',
        targetType: 'Booking',
        targetId: bookingPublicId,
      });
      return {
        bookingId: booking.publicId,
        status: booking.status,
        paymentStatus: booking.paymentStatus ?? 'NOT_DUE',
        paymentMethod: booking.paymentMethod,
        customer: {
          userId: booking.customerId.toString(),
          name: customer?.name ?? null,
          phone: customer?.phone ?? null,
        },
        categoryId: booking.categoryId.toString(),
        zoneId: booking.zoneId.toString(),
        pickup: { ...fromPoint(booking.pickup.location!), label: booking.pickup.label ?? null },
        drop: { ...fromPoint(booking.drop.location!), label: booking.drop.label ?? null },
        estimatedFarePaise: booking.estimatedFarePaise,
        finalFarePaise: booking.finalFarePaise ?? null,
        fareSnapshot: booking.fareSnapshot,
        finalFare: booking.finalFare ?? null,
        cancellation: booking.cancellation?.actor ? booking.cancellation : null,
        dispatchRound: booking.dispatch?.round ?? 1,
        stops: (booking.stops ?? []).map((st) => ({
          ...fromPoint(st.location!),
          label: st.label ?? null,
        })),
        fee: booking.fee ?? null,
        policy: booking.policy ?? null,
        receiptNumber: booking.receipt?.number ?? null,
        redispatchCount: booking.redispatchCount ?? 0,
        previousDrivers: (booking.previousDrivers ?? []).map((p) => ({
          driverId: p.driverId.toString(),
          cancelledAt: p.cancelledAt,
          reasonCode: p.reasonCode ?? null,
        })),
        fareAmendments: booking.fareAmendments ?? [],
        pendingDestinationChange: booking.destinationChange
          ? {
              requestId: booking.destinationChange.requestId,
              expiresAt: booking.destinationChange.expiresAt,
              estimatedTotalPaise: booking.destinationChange.estimatedTotalPaise,
            }
          : null,
        requestedAt: booking.requestedAt,
        ride: ride ? await rideView('ADMIN', booking, ride) : null,
        events: events.map((e) => ({
          type: e.type,
          fromStatus: e.fromStatus ?? null,
          toStatus: e.toStatus ?? null,
          actorType: e.actorType,
          actorId: e.actorId ?? null,
          metadata: e.metadata ?? null,
          at: e.at,
        })),
        offers: offers.map((o) => ({
          offerId: o.publicId,
          driverId: o.driverId.toString(),
          round: o.round,
          rank: o.rank ?? null,
          status: o.status,
          pickupDistanceMeters: o.pickupDistanceMeters ?? null,
          pickupEtaSeconds: o.pickupEtaSeconds ?? null,
          expiresAt: o.expiresAt,
          respondedAt: o.respondedAt ?? null,
          rejectReason: o.rejectReason ?? null,
        })),
      };
    },

    /** The sampled route a driver took during a ride, for disputes. Location data: every read is audited. */
    async rideTrail(actor: Actor, ridePublicId: string) {
      const ride = await Ride.findOne({ publicId: ridePublicId }).select('bookingId').lean();
      if (!ride) throw new AppError('NOT_FOUND');
      const pings = await LocationPing.find({ bookingId: ride.bookingId })
        .sort({ recordedAt: 1 })
        .limit(2000)
        .lean();
      await audit.record(actor, {
        action: 'RIDE_TRAIL_VIEWED',
        targetType: 'Ride',
        targetId: ridePublicId,
      });
      return {
        rideId: ridePublicId,
        count: pings.length,
        points: pings.map((p) => ({
          ...fromPoint(p.location!),
          recordedAt: p.recordedAt,
          bookingStatus: p.bookingStatus ?? null,
          accuracyMeters: p.accuracyMeters ?? null,
          headingDegrees: p.headingDegrees ?? null,
        })),
      };
    },

    /** Waive a cancellation or no-show fee (e.g. after a complaint). Audited, and the rider is told. */
    async waiveFee(actor: Actor, bookingPublicId: string, input: WaiveFeeInput) {
      const t = now();
      const updated = await Booking.findOneAndUpdate(
        { publicId: bookingPublicId, 'fee.status': 'DUE' },
        {
          'fee.status': 'WAIVED',
          'fee.waivedBy': actor.userId,
          'fee.waivedAt': t,
          'fee.waivedReason': input.reason,
          paymentStatus: 'NOT_DUE',
        },
        { returnDocument: 'after' },
      );
      if (!updated) {
        const b = await Booking.findOne({ publicId: bookingPublicId }).select('fee').lean();
        if (!b) throw new AppError('NOT_FOUND');
        throw new AppError(
          'CONFLICT',
          b.fee ? 'This fee has already been waived.' : 'This booking has no fee to waive.',
        );
      }
      await audit.record(actor, {
        action: 'booking.fee.waive',
        targetType: 'Booking',
        targetId: bookingPublicId,
        metadata: {
          amountPaise: updated.fee?.amountPaise,
          type: updated.fee?.type,
          reason: input.reason,
        },
      });
      const eventId = await recordEvent({
        bookingId: updated._id,
        type: 'FEE_WAIVED',
        actorType: 'ADMIN',
        actorId: actor.userId,
        at: t,
        metadata: { reason: input.reason },
      });
      await ledger?.waiveFeeSafe(updated._id);
      await notifier?.rideUpdated(updated._id, { eventId, kind: 'FEE_WAIVED', toRider: true });
      return {
        bookingId: bookingPublicId,
        fee: {
          type: updated.fee?.type,
          amountPaise: updated.fee?.amountPaise,
          status: updated.fee?.status,
        },
      };
    },

    /** Approved documents about to expire, and those that already have: who needs to renew. */
    async expiringDocuments(query: ExpiringDocumentsQuery) {
      const { page, limit, days } = query;
      const horizon = new Date(now().getTime() + days * 86_400_000);
      const filter: Record<string, unknown> = {
        $or: [
          { status: 'EXPIRED' },
          { status: 'APPROVED', expiresAt: { $ne: null, $lte: horizon } },
        ],
      };
      const [total, rows] = await Promise.all([
        DriverDocument.countDocuments(filter),
        DriverDocument.find(filter)
          .sort({ expiresAt: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const profiles = await DriverProfile.find({ _id: { $in: rows.map((d) => d.driverId) } })
        .select('userId')
        .lean();
      const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
        .select('name phone')
        .lean();
      const userOf = new Map(users.map((u) => [u._id.toString(), u]));
      const profileOf = new Map(profiles.map((p) => [p._id.toString(), p]));
      return {
        items: rows.map((d) => {
          const u = userOf.get(profileOf.get(d.driverId.toString())?.userId.toString() ?? '');
          return {
            documentId: d._id.toString(),
            driverId: d.driverId.toString(),
            driverName: u?.name ?? null,
            driverPhone: u?.phone ?? null,
            type: d.type,
            status: d.status,
            expiresAt: d.expiresAt ?? null,
          };
        }),
        meta: pageMeta(page, limit, total),
      };
    },

    /* ---------- Operations & Restrictions ---------- */

    async setCustomerBookingRestriction(
      actor: Actor,
      customerId: unknown,
      input: BookingRestrictionInput,
    ) {
      const { action, reason } = input;
      const user = await User.findById(customerId).lean();
      if (!user || user.role !== 'CUSTOMER') {
        throw new AppError('NOT_FOUND', 'Customer not found.');
      }
      const isRestricted = action === 'RESTRICT';
      const profile = await CustomerProfile.findOneAndUpdate(
        { userId: user._id },
        {
          $set: {
            bookingRestricted: isRestricted,
            bookingRestrictionReason: isRestricted ? reason : null,
            bookingRestrictedAt: isRestricted ? now() : null,
            bookingRestrictedBy: isRestricted ? actor.userId : null,
          },
        },
        { new: true, upsert: true },
      ).lean();

      await audit.record(actor, {
        action: isRestricted ? 'CUSTOMER_BOOKING_RESTRICTED' : 'CUSTOMER_BOOKING_RESTRICTION_LIFTED',
        targetType: 'Customer',
        targetId: user._id.toString(),
        metadata: { reason, previousRestriction: !isRestricted },
      });

      return {
        customerId: user._id.toString(),
        bookingRestricted: profile.bookingRestricted ?? isRestricted,
        reason: profile.bookingRestrictionReason ?? null,
        restrictedAt: profile.bookingRestrictedAt ?? null,
      };
    },

    async getLiveDrivers(actor: Actor, query: LiveDriversQuery) {
      const { page, limit, zoneId, minLat, maxLat, minLng, maxLng } = query;
      const filter: Record<string, unknown> = {
        approvalStatus: 'APPROVED',
        onlineStatus: 'ONLINE',
        currentLocation: { $exists: true, $ne: null },
      };

      if (zoneId) {
        const zone = await ServiceZone.findById(zoneId).lean();
        if (!zone) throw new AppError('NOT_FOUND', 'Zone not found.');
        filter['currentLocation'] = {
          $geoWithin: { $geometry: zone.polygon },
        };
      } else if (
        minLat !== undefined &&
        maxLat !== undefined &&
        minLng !== undefined &&
        maxLng !== undefined
      ) {
        filter['currentLocation'] = {
          $geoWithin: {
            $box: [
              [minLng, minLat],
              [maxLng, maxLat],
            ],
          },
        };
      }

      const [total, rows] = await Promise.all([
        DriverProfile.countDocuments(filter),
        DriverProfile.find(filter)
          .sort({ locationUpdatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      const userIds = rows.map((r) => r.userId);
      const vehicleIds = rows.map((r) => r.currentVehicleId).filter(Boolean);

      const [users, vehicles] = await Promise.all([
        User.find({ _id: { $in: userIds } }).select('name phone').lean(),
        Vehicle.find({ _id: { $in: vehicleIds } }).lean(),
      ]);

      const userOf = new Map(users.map((u) => [u._id.toString(), u]));
      const vehicleOf = new Map(vehicles.map((v) => [v._id.toString(), v]));

      await audit.record(actor, {
        action: 'ADMIN_VIEW_LIVE_DRIVERS',
        targetType: 'DriverFeed',
        targetId: zoneId ? String(zoneId) : 'BOUNDS',
        metadata: {
          zoneId: zoneId ? String(zoneId) : null,
          minLat: minLat ?? null,
          maxLat: maxLat ?? null,
          minLng: minLng ?? null,
          maxLng: maxLng ?? null,
          count: rows.length,
        },
      });

      return {
        items: rows.map((d) => {
          const u = userOf.get(d.userId.toString());
          const v = d.currentVehicleId ? vehicleOf.get(d.currentVehicleId.toString()) : null;
          return {
            driverId: d._id.toString(),
            userId: d.userId.toString(),
            name: u?.name ?? null,
            phone: u?.phone ?? null,
            onlineStatus: d.onlineStatus,
            activeRideId: d.activeRideId ? d.activeRideId.toString() : null,
            location: d.currentLocation ? fromPoint(d.currentLocation) : null,
            locationUpdatedAt: d.locationUpdatedAt ?? null,
            headingDegrees: d.headingDegrees ?? null,
            vehicle: v
              ? {
                  vehicleId: v._id.toString(),
                  make: v.make,
                  model: v.model,
                  registrationNumber: v.registrationNumber,
                  categoryId: v.categoryId.toString(),
                }
              : null,
          };
        }),
        meta: pageMeta(page, limit, total),
      };
    },

    async getDispatchQueue(actor: Actor, query: DispatchQueueQuery) {
      const { page, limit, zoneId, categoryId, includePhone } = query;
      if (includePhone && actor.role !== 'SUPER_ADMIN') {
        throw new AppError('FORBIDDEN', 'Only SUPER_ADMIN may access customer phone numbers.');
      }
      const filter: Record<string, unknown> = {
        status: { $in: ['REQUESTED', 'DISPATCHING'] },
      };
      if (zoneId) filter['zoneId'] = zoneId;
      if (categoryId) filter['categoryId'] = categoryId;

      const [total, rows] = await Promise.all([
        Booking.countDocuments(filter),
        Booking.find(filter)
          .sort({ requestedAt: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      const customerIds = rows.map((r) => r.customerId);
      const categoryIds = rows.map((r) => r.categoryId);
      const [customers, categories] = await Promise.all([
        User.find({ _id: { $in: customerIds } })
          .select(includePhone ? 'name phone' : 'name')
          .lean(),
        CabCategory.find({ _id: { $in: categoryIds } }).select('name code').lean(),
      ]);
      const customerById = new Map(customers.map((c) => [c._id.toString(), c]));
      const categoryById = new Map(categories.map((c) => [c._id.toString(), c]));

      if (includePhone && rows.length > 0) {
        await audit.record(actor, {
          action: 'DISPATCH_QUEUE_CUSTOMER_PII_VIEWED',
          targetType: 'DispatchQueue',
          targetId: 'queue',
          metadata: {
            count: rows.length,
            bookingIds: rows.map((b) => b.publicId),
          },
        });
      }

      return {
        items: rows.map((b) => {
          const waitingSeconds = Math.max(
            0,
            Math.floor((now().getTime() - new Date(b.requestedAt).getTime()) / 1000),
          );
          const c = customerById.get(b.customerId.toString());
          const cat = categoryById.get(b.categoryId.toString());
          return {
            bookingId: b.publicId,
            customerId: b.customerId.toString(),
            customerName: c?.name ?? null,
            customerPhone: includePhone ? (c?.phone ?? null) : null,
            categoryId: b.categoryId.toString(),
            categoryName: cat?.name ?? 'Standard Cab',
            zoneId: b.zoneId.toString(),
            status: b.status,
            rideType: b.rideType ?? 'INSTANT',
            tripKind: b.tripKind ?? 'CITY',
            pickup: {
              ...fromPoint(b.pickup.location!),
              label: b.pickup.label ?? null,
            },
            drop: {
              ...fromPoint(b.drop.location!),
              label: b.drop.label ?? null,
            },
            estimatedFarePaise: b.estimatedFarePaise,
            redispatchCount: b.redispatchCount ?? 0,
            requestedAt: b.requestedAt,
            waitingSeconds,
          };
        }),
        meta: pageMeta(page, limit, total),
      };
    },

    async manualAssignDriver(
      actor: Actor,
      bookingPublicId: string,
      input: ManualAssignDriverInput,
    ) {
      if (!dispatch) {
        throw new AppError('SERVICE_UNAVAILABLE', 'Dispatch service not available.');
      }
      const result = await dispatch.manualAssign(actor, bookingPublicId, input);
      await audit.record(actor, {
        action: 'ADMIN_MANUAL_ASSIGN_DRIVER',
        targetType: 'Booking',
        targetId: bookingPublicId,
        metadata: {
          bookingId: bookingPublicId,
          driverId: input.driverId,
          vehicleId: input.vehicleId,
          reason: input.reason,
          rideId: result.rideId,
        },
      });
      return result;
    },

    /* ---------- Dashboard ---------- */

    async dashboard() {
      const since = new Date(now().getTime() - 24 * 3600_000);
      const [
        activeBookings,
        last24h,
        driversByApproval,
        driversOnline,
        driversAwaitingReview,
        documentsAwaitingReview,
        vehiclesAwaitingVerification,
        customers,
        awaitingRetry,
        documentsExpiringSoon,
        documentsExpired,
      ] = await Promise.all([
        Booking.countDocuments({ status: { $in: ACTIVE_BOOKING_STATUSES } }),
        countBy(Booking, 'status', { requestedAt: { $gte: since } }),
        countBy(DriverProfile, 'approvalStatus'),
        DriverProfile.countDocuments({ approvalStatus: 'APPROVED', onlineStatus: 'ONLINE' }),
        DriverProfile.countDocuments({
          approvalStatus: 'PENDING',
          applicationSubmittedAt: { $ne: null },
        }),
        DriverDocument.countDocuments({ status: 'PENDING' }),
        Vehicle.countDocuments({ verificationStatus: 'PENDING' }),
        User.countDocuments({ role: 'CUSTOMER', accountStatus: 'ACTIVE' }),
        Booking.countDocuments({ status: 'NO_DRIVER_FOUND' }),
        DriverDocument.countDocuments({
          status: 'APPROVED',
          expiresAt: { $ne: null, $lte: new Date(now().getTime() + 30 * 86_400_000) },
        }),
        DriverDocument.countDocuments({ status: 'EXPIRED' }),
      ]);
      return {
        generatedAt: now(),
        bookings: { active: activeBookings, last24hByStatus: last24h, awaitingRetry },
        drivers: { byApprovalStatus: driversByApproval, onlineNow: driversOnline },
        reviewQueue: {
          driverApplications: driversAwaitingReview,
          documents: documentsAwaitingReview,
          vehicles: vehiclesAwaitingVerification,
          documentsExpiringSoon,
          documentsExpired,
        },
        customers: { active: customers },
      };
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
