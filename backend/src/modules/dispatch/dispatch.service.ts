import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { fromPoint } from '../../common/geo';
import { publicId } from '../../common/ids';
import type { MapsProvider } from '../../providers';
import { Booking, type BookingStatus } from '../bookings/booking.model';
import type { ManualAssignDriverInput } from '../admin/admin.schemas';
import { recordEvent, transitionBooking } from '../bookings/transitions';
import type { Notifier } from '../../realtime/notifier';
import type { OfferClosedReason } from '../../realtime/events';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import { Ride } from '../rides/ride.model';
import { User } from '../users/user.model';
import { Vehicle } from '../vehicles/vehicle.model';
import type { DispatchConfig } from './dispatch.config';
import { RideOffer } from './rideOffer.model';

/** Booking states in which the assigned driver legitimately holds the ride lock. */
const HOLDING_STATUSES = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'INCIDENT_REVIEW',
] as const;

type Candidate = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  currentVehicleId: Types.ObjectId;
  distanceMeters: number;
  etaSeconds: number;
};

const DUPLICATE_KEY = 11000;
const FALLBACK_SPEED_MPS = 30_000 / 3600;

export function createDispatchService(deps: {
  maps: MapsProvider;
  now: () => Date;
  config: DispatchConfig;
  logger: Logger;
  notifier: Pick<Notifier, 'bookingChanged' | 'offerCreated' | 'offersClosed' | 'offerAnswered'>;
}) {
  const { maps, now, config, logger, notifier } = deps;

  /** Write the timeline entry, then tell the people involved (live and by push). */
  const record = async (entry: Parameters<typeof recordEvent>[0]) => {
    const eventId = await recordEvent(entry);
    await notifier.bookingChanged(entry.bookingId, {
      eventId,
      type: entry.type,
      toStatus: entry.toStatus,
      actorType: entry.actorType,
    });
  };

  /* ---------------- matching ---------------- */

  /** Eligible, nearby drivers for this booking, best first. Empty when nobody qualifies. */
  async function findCandidates(
    booking: {
      categoryId: Types.ObjectId;
      pickup: { location?: { coordinates: number[] } | null };
      tripKind?: string | null;
    },
    excludeDriverIds: Types.ObjectId[],
  ): Promise<Candidate[]> {
    const pickup = booking.pickup.location!;
    const freshSince = new Date(now().getTime() - config.locationFreshMs);
    // A driver already holding a live offer for another ride is not offered this one too: they can
    // take only one, and this rider would wait out the whole offer window for nothing.
    const holdingOffer = await RideOffer.distinct('driverId', {
      status: 'PENDING',
      expiresAt: { $gt: now() },
    });
    const skip = [...excludeDriverIds, ...(holdingOffer as Types.ObjectId[])];

    for (const radius of config.radiusStagesMeters) {
      // $geoNear must be the first stage; aggregation does not cast, so ids/dates are passed typed.
      const rows = await DriverProfile.aggregate<{
        _id: Types.ObjectId;
        userId: Types.ObjectId;
        currentVehicleId: Types.ObjectId;
        currentLocation: { coordinates: number[] };
        distanceMeters: number;
      }>([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: pickup.coordinates as [number, number] },
            distanceField: 'distanceMeters',
            maxDistance: radius,
            spherical: true,
            key: 'currentLocation',
            query: {
              approvalStatus: 'APPROVED',
              onlineStatus: 'ONLINE',
              activeRideId: null,
              // Long trips only go to drivers who said they take them.
              ...(booking.tripKind === 'RENTAL' ? { acceptsRentals: { $ne: false } } : {}),
              ...(booking.tripKind === 'OUTSTATION' ? { acceptsOutstation: true } : {}),
              locationUpdatedAt: { $gte: freshSince },
              currentVehicleId: { $ne: null },
              _id: { $nin: skip },
            },
          },
        },
        { $limit: 25 },
      ]);
      if (rows.length === 0) continue;

      const [vehicles, users] = await Promise.all([
        Vehicle.find({
          _id: { $in: rows.map((r) => r.currentVehicleId) },
          categoryId: booking.categoryId,
          verificationStatus: 'VERIFIED',
          active: true,
        })
          .select('_id driverId')
          .lean(),
        User.find({ _id: { $in: rows.map((r) => r.userId) }, accountStatus: 'ACTIVE' })
          .select('_id')
          .lean(),
      ]);
      const okVehicle = new Map(vehicles.map((v) => [v._id.toString(), v.driverId.toString()]));
      const okUser = new Set(users.map((u) => u._id.toString()));
      const eligible = rows.filter(
        (r) =>
          okVehicle.get(r.currentVehicleId.toString()) === r._id.toString() &&
          okUser.has(r.userId.toString()),
      );
      if (eligible.length === 0) continue;

      // Straight-line distance is only a first pass; rank the nearest few by routed ETA.
      const head = eligible.slice(0, config.etaCandidates);
      const ranked = await Promise.all(
        head.map(async (r) => {
          let etaSeconds = Math.round(r.distanceMeters / FALLBACK_SPEED_MPS);
          try {
            const route = await maps.route(fromPoint(r.currentLocation), fromPoint(pickup));
            etaSeconds = route.durationSeconds;
          } catch (err) {
            logger.warn({ err }, 'eta lookup failed, using straight-line estimate');
          }
          return {
            _id: r._id,
            userId: r.userId,
            currentVehicleId: r.currentVehicleId,
            distanceMeters: Math.round(r.distanceMeters),
            etaSeconds,
          };
        }),
      );
      ranked.sort((a, b) => a.etaSeconds - b.etaSeconds || a.distanceMeters - b.distanceMeters);
      const tail = eligible.slice(config.etaCandidates).map((r) => ({
        _id: r._id,
        userId: r.userId,
        currentVehicleId: r.currentVehicleId,
        distanceMeters: Math.round(r.distanceMeters),
        etaSeconds: Math.round(r.distanceMeters / FALLBACK_SPEED_MPS),
      }));
      return [...ranked, ...tail];
    }
    return [];
  }

  async function acquireLock(bookingId: Types.ObjectId) {
    const t = now();
    return Booking.findOneAndUpdate(
      {
        _id: bookingId,
        status: 'DISPATCHING',
        $or: [{ 'dispatch.lockUntil': null }, { 'dispatch.lockUntil': { $lt: t } }],
      },
      { $set: { 'dispatch.lockUntil': new Date(t.getTime() + config.lockMs) } },
      { returnDocument: 'after' },
    );
  }

  const releaseLock = (bookingId: Types.ObjectId) =>
    Booking.updateOne({ _id: bookingId }, { $set: { 'dispatch.lockUntil': new Date(0) } });

  async function giveUp(bookingId: Types.ObjectId) {
    const updated = await transitionBooking({ _id: bookingId }, ['DISPATCHING'], 'NO_DRIVER_FOUND');
    if (updated) {
      await record({
        bookingId,
        type: 'NO_DRIVER_FOUND',
        fromStatus: 'DISPATCHING',
        toStatus: 'NO_DRIVER_FOUND',
        actorType: 'SYSTEM',
        at: now(),
      });
    }
  }

  /**
   * One matching round: if nobody currently holds a live offer, offer the ride to the best
   * eligible driver(s). Safe to call from anywhere, any number of times: a lease on the booking
   * stops concurrent rounds and the offers' unique index stops duplicates.
   */
  async function runRound(bookingId: Types.ObjectId): Promise<void> {
    const booking = await acquireLock(bookingId);
    if (!booking) return;
    try {
      const t = now();
      const round = booking.dispatch?.round ?? 1;
      const live = await RideOffer.countDocuments({
        bookingId,
        round,
        status: 'PENDING',
        expiresAt: { $gt: t },
      });
      if (live > 0) return;

      const previous = await RideOffer.find({ bookingId, round }).select('driverId').lean();
      if (previous.length >= config.maxOffersPerRound) {
        await giveUp(bookingId);
        return;
      }

      const candidates = await findCandidates(booking, [
        ...previous.map((o) => o.driverId),
        ...(booking.excludedDriverIds ?? []),
      ]);
      if (candidates.length === 0) {
        // Keep waiting for drivers to come online until the search window closes.
        const started = booking.dispatch?.startedAt?.getTime() ?? t.getTime();
        // A ride booked for later is searched for until its pickup time (plus a little), not just
        // for a minute: the search starts early on purpose, and drivers come online meanwhile.
        const window = booking.scheduledFor
          ? Math.max(
              config.searchWindowMs,
              booking.scheduledFor.getTime() + config.scheduleSearchGraceMs - started,
            )
          : config.searchWindowMs;
        if (t.getTime() - started >= window) await giveUp(bookingId);
        return;
      }

      const room = config.maxOffersPerRound - previous.length;
      const chosen = candidates.slice(0, Math.min(config.batchSize, room));
      for (const [i, c] of chosen.entries()) {
        try {
          const created = await RideOffer.create({
            publicId: publicId('ofr'),
            bookingId,
            driverId: c._id,
            vehicleId: c.currentVehicleId,
            round,
            status: 'PENDING',
            expiresAt: new Date(t.getTime() + config.offerTtlMs),
            pickupDistanceMeters: c.distanceMeters,
            pickupEtaSeconds: c.etaSeconds,
            rank: previous.length + i + 1,
          });
          await notifier.offerCreated({
            offerId: created.publicId,
            bookingId: booking.publicId,
            driverUserId: c.userId.toString(),
            expiresAt: created.expiresAt,
            pickupLabel: booking.pickup.label ?? null,
            estimatedFarePaise: booking.estimatedFarePaise,
          });
        } catch (err) {
          if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
        }
      }
    } finally {
      await releaseLock(bookingId);
    }
  }

  async function withdrawOffers(
    bookingId: Types.ObjectId,
    exceptOfferId?: Types.ObjectId,
    reason: OfferClosedReason = 'WITHDRAWN',
  ) {
    const filter = {
      bookingId,
      status: 'PENDING' as const,
      ...(exceptOfferId ? { _id: { $ne: exceptOfferId } } : {}),
    };
    const open = await RideOffer.find(filter).select('_id publicId driverId').lean();
    if (open.length === 0) return;
    await RideOffer.updateMany(
      { _id: { $in: open.map((o) => o._id) }, status: 'PENDING' },
      { status: 'WITHDRAWN', respondedAt: now() },
    );
    await notifier.offersClosed(open, reason);
  }

  /**
   * A driver who has taken a ride can take no other: close their remaining offers at once, so those
   * riders are offered to someone else now instead of after the offer window runs out.
   */
  async function withdrawDriverOffers(driverId: Types.ObjectId, exceptOfferId?: Types.ObjectId) {
    const open = await RideOffer.find({
      driverId,
      status: 'PENDING',
      ...(exceptOfferId ? { _id: { $ne: exceptOfferId } } : {}),
    })
      .select('_id publicId driverId')
      .lean();
    if (open.length === 0) return;
    await RideOffer.updateMany(
      { _id: { $in: open.map((o) => o._id) }, status: 'PENDING' },
      { status: 'WITHDRAWN', respondedAt: now() },
    );
    await notifier.offersClosed(open, 'WITHDRAWN');
  }

  /** Free a driver's active-ride lock, but only if it is still held for this booking. */
  const releaseDriver = (driverId: Types.ObjectId, bookingId: Types.ObjectId) =>
    DriverProfile.updateOne(
      { _id: driverId, activeRideId: bookingId },
      { $set: { activeRideId: null }, $unset: { activeRideSince: 1 } },
    );

  /** Move a REQUESTED booking into DISPATCHING and run the first round. */
  async function start(bookingPublicId: string): Promise<void> {
    const t = now();
    const booking = await transitionBooking(
      { publicId: bookingPublicId },
      ['REQUESTED'],
      'DISPATCHING',
      {
        set: { 'dispatch.startedAt': t, 'dispatch.lockUntil': null },
      },
    );
    if (!booking) return; // already started (a retry or the sweeper got there first)
    await record({
      bookingId: booking._id,
      type: 'DISPATCH_STARTED',
      fromStatus: 'REQUESTED',
      toStatus: 'DISPATCHING',
      actorType: 'SYSTEM',
      at: t,
    });
    await runRound(booking._id);
  }

  /* ---------------- public API ---------------- */

  return {
    runRound,
    withdrawOffers,
    releaseDriver,

    start,

    /** Admin: search again after NO_DRIVER_FOUND, as a fresh round. */
    async retry(actor: Actor, bookingPublicId: string) {
      const t = now();
      const booking = await transitionBooking(
        { publicId: bookingPublicId },
        ['NO_DRIVER_FOUND'],
        'DISPATCHING',
        {
          set: { 'dispatch.startedAt': t, 'dispatch.lockUntil': null },
          inc: { 'dispatch.round': 1 },
        },
      );
      if (!booking) {
        const exists = await Booking.exists({ publicId: bookingPublicId });
        if (!exists) throw new AppError('NOT_FOUND', 'Booking not found.');
        throw new AppError(
          'RIDE_INVALID_STATE',
          'Only a booking with no driver found can be retried.',
        );
      }
      await record({
        bookingId: booking._id,
        type: 'DISPATCH_RETRIED',
        fromStatus: 'NO_DRIVER_FOUND',
        toStatus: 'DISPATCHING',
        actorType: 'ADMIN',
        actorId: actor.userId,
        at: t,
      });
      await runRound(booking._id);
      return { bookingId: booking.publicId, status: 'DISPATCHING' as const };
    },

    /**
     * Housekeeping, run every couple of seconds (and callable directly in tests):
     * expire stale offers, then advance every booking that needs its next round.
     */
    async sweep(): Promise<void> {
      const t = now();
      const due = await RideOffer.find({ status: 'PENDING', expiresAt: { $lte: t } })
        .select('_id bookingId publicId driverId')
        .lean();
      if (due.length > 0) {
        await RideOffer.updateMany(
          { _id: { $in: due.map((o) => o._id) }, status: 'PENDING' },
          { status: 'EXPIRED', respondedAt: t },
        );
        await notifier.offersClosed(due, 'EXPIRED');
      }

      // Bookings whose creation request died before dispatch started.
      const stuck = await Booking.find({
        status: 'REQUESTED',
        requestedAt: { $lte: new Date(t.getTime() - 5000) },
      })
        .select('publicId')
        .lean();
      for (const b of stuck) await start(b.publicId);

      // Every DISPATCHING booking: runRound is a no-op while a live offer is outstanding.
      const searching = await Booking.find({ status: 'DISPATCHING' }).select('_id').lean();
      for (const b of searching) {
        try {
          await runRound(b._id);
        } catch (err) {
          logger.error({ err, bookingId: b._id.toString() }, 'dispatch round failed');
        }
      }
    },

    /**
     * Repairs what a crash or timeout can leave half-done. Every write above is a conditional
     * update, so a failure between two steps never corrupts a booking, but it can leave a driver
     * locked to a ride that never started, or a booking assigned with no ride behind it. Anything
     * younger than `reconcileGraceMs` is skipped so a request still in flight is never undone.
     * Safe to run on several instances at once and to run repeatedly.
     */
    async reconcile(): Promise<{
      bookingsHealed: number;
      bookingsRolledBack: number;
      driversReleased: number;
      driversSetOffline: number;
    }> {
      const t = now();
      const cutoff = new Date(t.getTime() - config.reconcileGraceMs);
      const result = {
        bookingsHealed: 0,
        bookingsRolledBack: 0,
        driversReleased: 0,
        driversSetOffline: 0,
      };

      // 1. Assigned bookings with no ride id: either the ride exists (link it) or the accept died
      //    before creating it (put the booking back in the search and free the driver).
      const unlinked = await Booking.find({
        status: 'DRIVER_ASSIGNED',
        rideId: null,
        assignedAt: { $lte: cutoff },
      })
        .select('_id publicId assignedDriverId')
        .limit(100)
        .lean();
      for (const b of unlinked) {
        const ride = await Ride.findOne({ bookingId: b._id, driverId: b.assignedDriverId })
          .select('publicId')
          .lean();
        if (ride) {
          const linked = await Booking.updateOne(
            { _id: b._id, rideId: null },
            { rideId: ride.publicId },
          );
          result.bookingsHealed += linked.modifiedCount;
          continue;
        }
        const rolled = await Booking.updateOne(
          { _id: b._id, status: 'DRIVER_ASSIGNED', rideId: null },
          {
            $set: { status: 'DISPATCHING', assignedDriverId: null, 'dispatch.lockUntil': null },
            $unset: { assignedAt: 1 },
          },
        );
        if (rolled.modifiedCount === 1) {
          result.bookingsRolledBack += 1;
          if (b.assignedDriverId) await releaseDriver(b.assignedDriverId, b._id);
          await record({
            bookingId: b._id,
            type: 'ASSIGNMENT_ROLLED_BACK',
            fromStatus: 'DRIVER_ASSIGNED',
            toStatus: 'DISPATCHING',
            actorType: 'SYSTEM',
            at: t,
            metadata: { reason: 'no ride was created for the assignment' },
          });
          logger.warn({ bookingId: b.publicId }, 'rolled back an assignment that has no ride');
        }
      }

      // 2. Drivers locked to a ride that is over, or that never became theirs.
      const locked = await DriverProfile.find({
        activeRideId: { $type: 'objectId' },
        $or: [{ activeRideSince: { $lte: cutoff } }, { activeRideSince: null }],
      })
        .select('_id activeRideId')
        .limit(200)
        .lean();
      for (const d of locked) {
        const booking = await Booking.findById(d.activeRideId)
          .select('status assignedDriverId')
          .lean();
        const holds =
          booking?.assignedDriverId?.equals(d._id) &&
          HOLDING_STATUSES.includes(booking.status as (typeof HOLDING_STATUSES)[number]);
        if (holds) continue;
        const freed = await DriverProfile.updateOne(
          { _id: d._id, activeRideId: d.activeRideId },
          { $set: { activeRideId: null }, $unset: { activeRideSince: 1 } },
        );
        result.driversReleased += freed.modifiedCount;
        if (freed.modifiedCount) {
          logger.warn({ driverId: d._id.toString() }, 'released an orphaned ride lock');
        }
      }

      // 3. ONLINE drivers whose app went quiet (killed, no signal). Not while they are on a ride.
      const staleBefore = new Date(t.getTime() - config.staleOnlineMs);
      const staleFilter = {
        onlineStatus: 'ONLINE' as const,
        activeRideId: null,
        $or: [{ locationUpdatedAt: { $lt: staleBefore } }, { locationUpdatedAt: null }],
      };
      const stale = await DriverProfile.find(staleFilter).select('_id').limit(500).lean();
      if (stale.length > 0) {
        const ids = stale.map((d) => d._id);
        const off = await DriverProfile.updateMany(
          { ...staleFilter, _id: { $in: ids } },
          { onlineStatus: 'OFFLINE', $unset: { currentLocation: 1, currentVehicleId: 1 } },
        );
        result.driversSetOffline = off.modifiedCount;
        await RideOffer.updateMany(
          { driverId: { $in: ids }, status: 'PENDING' },
          { status: 'WITHDRAWN', respondedAt: t },
        );
      }
      return result;
    },

    /* ----- driver-facing ----- */

    async listOffers(userId: string) {
      const profile = await requireDriverProfile(userId);
      const offers = await RideOffer.find({
        driverId: profile._id,
        status: 'PENDING',
        expiresAt: { $gt: now() },
      })
        .sort({ createdAt: 1 })
        .lean();
      const bookings = await Booking.find({ _id: { $in: offers.map((o) => o.bookingId) } }).lean();
      const byId = new Map(bookings.map((b) => [b._id.toString(), b]));
      return offers.flatMap((o) => {
        const b = byId.get(o.bookingId.toString());
        if (!b) return [];
        // Deliberately no customer name/phone: an offer is only a candidate until accepted.
        return [
          {
            offerId: o.publicId,
            bookingId: b.publicId,
            expiresAt: o.expiresAt,
            pickup: { ...fromPoint(b.pickup.location!), label: b.pickup.label ?? null },
            drop: { ...fromPoint(b.drop.location!), label: b.drop.label ?? null },
            pickupDistanceMeters: o.pickupDistanceMeters ?? null,
            pickupEtaSeconds: o.pickupEtaSeconds ?? null,
            estimatedFarePaise: b.estimatedFarePaise,
            scheduledFor: b.scheduledFor ?? null,
            tripKind: b.tripKind ?? 'CITY',
            rental: b.rental
              ? { name: b.rental.name, hours: b.rental.hours, includedKm: b.rental.includedKm }
              : null,
            outstation: b.outstation
              ? {
                  tripType: b.outstation.tripType,
                  days: b.outstation.days,
                  estimatedKm: b.outstation.estimatedKm,
                }
              : null,
            paymentMethod: b.paymentMethod,
            currency: 'INR',
          },
        ];
      });
    },

    async reject(userId: string, offerPublicId: string, reason?: string) {
      const profile = await requireDriverProfile(userId);
      const offer = await RideOffer.findOneAndUpdate(
        { publicId: offerPublicId, driverId: profile._id, status: 'PENDING' },
        { status: 'REJECTED', respondedAt: now(), ...(reason ? { rejectReason: reason } : {}) },
        { returnDocument: 'after' },
      );
      if (!offer) {
        const mine = await RideOffer.exists({ publicId: offerPublicId, driverId: profile._id });
        if (!mine) throw new AppError('NOT_FOUND', 'Offer not found.');
        throw new AppError('OFFER_UNAVAILABLE');
      }
      await notifier.offerAnswered(userId, offer.publicId);
      await runRound(offer.bookingId);
      return { offerId: offer.publicId, status: 'REJECTED' as const };
    },

    /**
     * The race that matters. Three conditional updates, each of which only one caller can win:
     *   1. the offer (PENDING and unexpired -> ACCEPTED),
     *   2. the driver (not already on a ride),
     *   3. the booking (DISPATCHING and unassigned -> DRIVER_ASSIGNED).
     * If a later step fails, the earlier ones are undone.
     */
    async accept(userId: string, offerPublicId: string) {
      const t = now();
      const profile = await requireDriverProfile(userId);
      if (profile.approvalStatus !== 'APPROVED' || profile.onlineStatus !== 'ONLINE') {
        throw new AppError(
          'DRIVER_NOT_ELIGIBLE',
          'Go online as an approved driver to accept rides.',
        );
      }

      const offer = await RideOffer.findOneAndUpdate(
        {
          publicId: offerPublicId,
          driverId: profile._id,
          status: 'PENDING',
          expiresAt: { $gt: t },
        },
        { status: 'ACCEPTED', respondedAt: t },
        { returnDocument: 'after' },
      );
      if (!offer) {
        const mine = await RideOffer.findOne({
          publicId: offerPublicId,
          driverId: profile._id,
        }).lean();
        if (!mine) throw new AppError('NOT_FOUND', 'Offer not found.');
        if (mine.status === 'ACCEPTED') {
          // Retry of an accept that already succeeded: return the same assignment.
          const existing = await Ride.findOne({
            bookingId: mine.bookingId,
            driverId: profile._id,
          }).lean();
          if (existing) {
            return {
              bookingId: existing.bookingPublicId,
              rideId: existing.publicId,
              status: 'DRIVER_ASSIGNED' as const,
              pickupEtaSeconds: mine.pickupEtaSeconds ?? null,
            };
          }
        }
        // The winner withdraws every other offer, so a loser may find theirs already closed.
        const taken = await Booking.findById(mine.bookingId).select('assignedDriverId').lean();
        if (taken?.assignedDriverId && !taken.assignedDriverId.equals(profile._id)) {
          throw new AppError('RIDE_ALREADY_ASSIGNED');
        }
        throw new AppError('OFFER_UNAVAILABLE');
      }
      const undoOffer = (status: 'WITHDRAWN' | 'PENDING') =>
        RideOffer.updateOne({ _id: offer._id }, { status });

      // The vehicle must still be verified and in the right category.
      const booking0 = await Booking.findById(offer.bookingId).lean();
      const vehicle = await Vehicle.findOne({
        _id: offer.vehicleId,
        driverId: profile._id,
        categoryId: booking0?.categoryId,
        verificationStatus: 'VERIFIED',
        active: true,
      }).lean();
      if (!booking0 || !vehicle) {
        await undoOffer('WITHDRAWN');
        throw new AppError('DRIVER_NOT_ELIGIBLE', 'Your vehicle is not eligible for this ride.');
      }

      // 2. claim the driver: a driver can be on only one ride at a time.
      const driver = await DriverProfile.findOneAndUpdate(
        {
          _id: profile._id,
          approvalStatus: 'APPROVED',
          onlineStatus: 'ONLINE',
          activeRideId: null,
        },
        { activeRideId: offer.bookingId, activeRideSince: t },
        { returnDocument: 'after' },
      );
      if (!driver) {
        await undoOffer('WITHDRAWN');
        throw new AppError('DRIVER_NOT_ELIGIBLE', 'You already have an active ride.');
      }

      // 3. claim the booking.
      const booking = await transitionBooking(
        { _id: offer.bookingId, assignedDriverId: null },
        ['DISPATCHING'],
        'DRIVER_ASSIGNED',
        { set: { assignedDriverId: profile._id, assignedAt: t } },
      );
      if (!booking) {
        await releaseDriver(profile._id, offer.bookingId);
        await undoOffer('WITHDRAWN');
        const current = await Booking.findById(offer.bookingId).select('status').lean();
        // Cancelled (or otherwise closed) while the offer was open: not a lost race.
        if (current && current.status !== 'DRIVER_ASSIGNED')
          throw new AppError('OFFER_UNAVAILABLE');
        throw new AppError('RIDE_ALREADY_ASSIGNED');
      }

      await withdrawDriverOffers(profile._id, offer._id);

      // The pickup OTP is derived from this nonce + a server secret and is never stored.
      const nonce = randomBytes(8).toString('hex');
      let ride;
      try {
        const otp = {
          nonce,
          attempts: 0,
          issuedAt: t,
          expiresAt: new Date(t.getTime() + config.otpTtlMs),
        };
        // After a driver cancelled and the booking was re-offered, the booking already owns a ride
        // record (one per booking). The new driver takes it over with a clean slate.
        const previousRide = await Ride.findOne({ bookingId: booking._id }).select('_id').lean();
        ride = previousRide
          ? await Ride.findOneAndUpdate(
              { _id: previousRide._id },
              {
                $set: {
                  driverId: profile._id,
                  driverUserId: profile.userId,
                  vehicleId: offer.vehicleId,
                  assignedAt: t,
                  otp,
                  stopLog: [],
                },
                $unset: {
                  enRouteAt: 1,
                  arrivedAt: 1,
                  arrivalLocation: 1,
                  startedAt: 1,
                  startLocation: 1,
                  cancelledAt: 1,
                },
              },
              { returnDocument: 'after' },
            )
          : await Ride.create({
              publicId: publicId('ride'),
              bookingId: booking._id,
              bookingPublicId: booking.publicId,
              customerId: booking.customerId,
              driverId: profile._id,
              driverUserId: profile.userId,
              vehicleId: offer.vehicleId,
              assignedAt: t,
              otp,
            });
        if (!ride) throw new Error('ride record vanished during assignment');
      } catch (err) {
        // Undo everything so the booking can be offered to someone else.
        await Booking.updateOne(
          { _id: booking._id, status: 'DRIVER_ASSIGNED' },
          { $set: { status: 'DISPATCHING', assignedDriverId: null }, $unset: { assignedAt: 1 } },
        );
        await releaseDriver(profile._id, booking._id);
        await undoOffer('WITHDRAWN');
        throw err;
      }

      await Booking.updateOne({ _id: booking._id }, { rideId: ride.publicId });
      await notifier.offerAnswered(userId, offer.publicId);
      await withdrawOffers(booking._id, offer._id, 'TAKEN');
      await record({
        bookingId: booking._id,
        type: 'DRIVER_ASSIGNED',
        fromStatus: 'DISPATCHING',
        toStatus: 'DRIVER_ASSIGNED',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
        metadata: { rideId: ride.publicId },
      });
      return {
        bookingId: booking.publicId,
        rideId: ride.publicId,
        status: 'DRIVER_ASSIGNED' as const,
        pickupEtaSeconds: offer.pickupEtaSeconds ?? null,
      };
    },

    /**
     * Admin manual driver assignment or reassignment (audited, concurrency-safe).
     */
    async manualAssign(actor: Actor, bookingPublicId: string, input: ManualAssignDriverInput) {
      const t = now();
      const booking = await Booking.findOne({ publicId: bookingPublicId });
      if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');

      const assignableStatuses: BookingStatus[] = ['REQUESTED', 'DISPATCHING', 'DRIVER_ASSIGNED'];
      if (!assignableStatuses.includes(booking.status)) {
        throw new AppError(
          'RIDE_INVALID_STATE',
          `Cannot assign driver to a booking in status ${booking.status}.`,
        );
      }

      const driver = await DriverProfile.findById(input.driverId);
      if (!driver) throw new AppError('NOT_FOUND', 'Driver not found.');
      if (driver.approvalStatus !== 'APPROVED') {
        throw new AppError('DRIVER_NOT_ELIGIBLE', 'Driver is not approved.');
      }
      if (driver.onlineStatus !== 'ONLINE') {
        throw new AppError('DRIVER_NOT_ELIGIBLE', 'Driver is not online.');
      }

      if (booking.assignedDriverId && booking.assignedDriverId.equals(driver._id)) {
        const existingRide = await Ride.findOne({ bookingId: booking._id, driverId: driver._id }).lean();
        return {
          bookingId: booking.publicId,
          rideId: existingRide?.publicId ?? booking.rideId ?? '',
          driverId: driver._id.toString(),
          vehicleId: driver.currentVehicleId?.toString() ?? '',
          status: 'DRIVER_ASSIGNED' as const,
        };
      }

      const vehicleFilter: Record<string, unknown> = {
        driverId: driver._id,
        categoryId: booking.categoryId,
        verificationStatus: 'VERIFIED',
        active: true,
      };
      if (input.vehicleId) {
        vehicleFilter['_id'] = input.vehicleId;
      }
      const vehicle = await Vehicle.findOne(vehicleFilter).lean();
      if (!vehicle) {
        throw new AppError(
          'DRIVER_NOT_ELIGIBLE',
          'Driver has no active, verified vehicle in the required category.',
        );
      }

      const claimed = await DriverProfile.findOneAndUpdate(
        {
          _id: driver._id,
          approvalStatus: 'APPROVED',
          onlineStatus: 'ONLINE',
          activeRideId: null,
        },
        { activeRideId: booking._id, activeRideSince: t },
        { returnDocument: 'after' },
      );
      if (!claimed) {
        throw new AppError('CONFLICT', 'Driver is busy or no longer available.');
      }

      const previousDriverId = booking.assignedDriverId;
      if (previousDriverId && !previousDriverId.equals(driver._id)) {
        await DriverProfile.updateOne(
          { _id: previousDriverId, activeRideId: booking._id },
          { $set: { activeRideId: null }, $unset: { activeRideSince: 1 } },
        );
        await Booking.updateOne(
          { _id: booking._id },
          {
            $push: {
              previousDrivers: {
                driverId: previousDriverId,
                cancelledAt: t,
                reasonCode: 'ADMIN_REASSIGNMENT',
              },
            },
          },
        );
        const oldDriver = await DriverProfile.findById(previousDriverId).select('userId').lean();
        if (oldDriver) {
          await notifier.offerAnswered(oldDriver.userId.toString(), booking.publicId);
        }
      }

      const updatedBooking = await Booking.findOneAndUpdate(
        {
          _id: booking._id,
          status: { $in: assignableStatuses },
        },
        {
          $set: {
            assignedDriverId: driver._id,
            assignedAt: t,
            status: 'DRIVER_ASSIGNED',
          },
        },
        { returnDocument: 'after' },
      );

      if (!updatedBooking) {
        await releaseDriver(driver._id, booking._id);
        throw new AppError('CONFLICT', 'Booking status changed concurrently.');
      }

      await withdrawOffers(booking._id, undefined, 'TAKEN');
      await withdrawDriverOffers(driver._id);

      const nonce = randomBytes(8).toString('hex');
      const otp = {
        nonce,
        attempts: 0,
        issuedAt: t,
        expiresAt: new Date(t.getTime() + config.otpTtlMs),
      };

      const previousRide = await Ride.findOne({ bookingId: booking._id }).select('_id').lean();
      const ride = previousRide
        ? await Ride.findOneAndUpdate(
            { _id: previousRide._id },
            {
              $set: {
                driverId: driver._id,
                driverUserId: driver.userId,
                vehicleId: vehicle._id,
                assignedAt: t,
                otp,
                stopLog: [],
              },
              $unset: {
                enRouteAt: 1,
                arrivedAt: 1,
                arrivalLocation: 1,
                startedAt: 1,
                startLocation: 1,
                cancelledAt: 1,
              },
            },
            { returnDocument: 'after' },
          )
        : await Ride.create({
            publicId: publicId('ride'),
            bookingId: booking._id,
            bookingPublicId: booking.publicId,
            customerId: booking.customerId,
            driverId: driver._id,
            driverUserId: driver.userId,
            vehicleId: vehicle._id,
            assignedAt: t,
            otp,
          });

      if (!ride) throw new Error('Failed to create or update ride record');

      await Booking.updateOne({ _id: booking._id }, { rideId: ride.publicId });

      await record({
        bookingId: booking._id,
        type: 'DRIVER_ASSIGNED',
        fromStatus: booking.status,
        toStatus: 'DRIVER_ASSIGNED',
        actorType: 'ADMIN',
        actorId: actor.userId,
        at: t,
        metadata: {
          rideId: ride.publicId,
          reason: input.reason,
          reassignedFrom: previousDriverId ? previousDriverId.toString() : null,
        },
      });

      return {
        bookingId: booking.publicId,
        rideId: ride.publicId,
        driverId: driver._id.toString(),
        vehicleId: vehicle._id.toString(),
        status: 'DRIVER_ASSIGNED' as const,
      };
    },
  };
}

export type DispatchService = ReturnType<typeof createDispatchService>;
