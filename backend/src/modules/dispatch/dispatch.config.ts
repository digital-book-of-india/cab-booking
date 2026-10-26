/**
 * Tunable dispatch and ride-lifecycle parameters. These are PLACEHOLDER defaults pending the
 * product owner's numbers; tests override them through createApp({ dispatchConfig }).
 */
export type DispatchConfig = {
  /** How long a driver has to answer an offer. */
  offerTtlMs: number;
  /** Search radii tried in order, nearest first (metres). */
  radiusStagesMeters: number[];
  /** Offers sent at once per round. 1 = strictly sequential. */
  batchSize: number;
  /** Max drivers offered in total per search round before giving up. */
  maxOffersPerRound: number;
  /** How long to keep waiting for a driver to appear before NO_DRIVER_FOUND. */
  searchWindowMs: number;
  /** A driver whose last GPS update is older than this is not offered rides. */
  locationFreshMs: number;
  /** Minimum gap between a driver's location updates (throttle). */
  minLocationIntervalMs: number;
  /** Implied speed above this between two updates is treated as a GPS glitch/spoof. */
  maxSpeedMps: number;
  /** Updates less accurate than this are rejected. */
  maxAccuracyMeters: number;
  /** The driver must be this close to the pickup to mark arrival. */
  arrivalRadiusMeters: number;
  otpTtlMs: number;
  otpMaxAttempts: number;
  /** Billable duration is the measured trip time clamped to [min, max] x the quoted duration. */
  durationClampMin: number;
  durationClampMax: number;
  /** How many nearest drivers get a route-ETA lookup before ranking. */
  etaCandidates: number;
  /** Lease on a booking while a matching round runs. */
  lockMs: number;
  /** A ride lock / half-finished assignment must be this old before the reconciler touches it. */
  reconcileGraceMs: number;
  /** An ONLINE driver with no GPS update for this long is set OFFLINE (not while on a ride). */
  staleOnlineMs: number;
  /** A GPS fix is written to the database only if the driver moved this far... */
  persistMinDistanceMeters: number;
  /** ...or this long has passed (always well under locationFreshMs). */
  persistMinIntervalMs: number;
  /** The rider is sent the driver's position at most this often. */
  trackMinIntervalMs: number;
  /** One route-trail point is stored at most this often during an active ride. */
  trailMinIntervalMs: number;
  /** After a driver cancels before the trip starts, the booking is re-offered this many times. */
  maxRedispatches: number;
  /** The rider has this long to ask for another destination to be accepted by the driver. */
  destinationChangeTtlMs: number;
  /** Accepted destination changes allowed per booking. */
  maxDestinationChanges: number;
  /** At most this much waiting is ever billed (pickup plus stops). */
  waitingCapSeconds: number;
  /** Stops allowed on one booking. */
  maxStops: number;
  /** A scheduled ride must be booked at least this long before pickup... */
  scheduleMinLeadMs: number;
  /** ...and at most this far ahead. */
  scheduleMaxAheadMs: number;
  /** The search for a driver starts this long before the pickup time. */
  scheduleSearchLeadMs: number;
  /** The rider is reminded this long before pickup (only if booked earlier than that). */
  scheduleReminderLeadMs: number;
  /** A scheduled ride nobody started by this long after its time is cancelled by the system. */
  scheduleMissedGraceMs: number;
  /** Scheduled rides one rider may have waiting at a time. */
  maxScheduledPerRider: number;
  /** A ride for later keeps being searched until its pickup time plus this. */
  scheduleSearchGraceMs: number;
  /** One rider's scheduled rides must be at least this far apart. */
  scheduleOverlapMs: number;
  /** A rental may run this many minutes over its hours before extra time is charged... */
  rentalGraceMinutes: number;
  /** ...and this many km over its included distance. */
  rentalGraceKm: number;
  /** One-way outstation: the real distance is charged only if it is this much more than quoted (2000 = 20%). */
  oneWayDetourBp: number;
  /**
   * City rides: QUOTED bills the distance the rider was quoted (the measured trail is only recorded);
   * RECONCILED bills the measured trail when it is clearly longer or shorter. Placeholder policy.
   */
  cityDistanceBilling: 'QUOTED' | 'RECONCILED';
  /** RECONCILED: longer than quoted by more than this (2000 = 20%) is a detour. */
  cityDetourBp: number;
  /** RECONCILED: shorter than quoted by more than this is an early finish. */
  cityShortBp: number;
  /** RECONCILED: never bill below this share of the quoted distance (5000 = 50%). */
  cityFloorBp: number;
  /** RECONCILED: never bill above this share of the quoted distance (20000 = 2x). */
  cityCeilingBp: number;
  /** A trail with fewer recorded points than this is not trusted. */
  cityMinPings: number;
  /** A trail this far from the quote (either way) is logged as DISTANCE_MISMATCH for staff, in any mode. */
  cityFlagBp: number;
  /** The longest round trip that can be booked, in days. */
  outstationMaxDays: number;
  /** A ride still in progress after this many hours (rentals and outstation: beyond their booked time) is flagged. */
  tripOverrunHours: number;
};

export const defaultDispatchConfig: DispatchConfig = {
  offerTtlMs: 20_000,
  radiusStagesMeters: [3000, 6000],
  batchSize: 1,
  maxOffersPerRound: 5,
  searchWindowMs: 60_000,
  locationFreshMs: 60_000,
  minLocationIntervalMs: 1000,
  maxSpeedMps: 70,
  maxAccuracyMeters: 100,
  arrivalRadiusMeters: 300,
  otpTtlMs: 2 * 3_600_000,
  otpMaxAttempts: 5,
  durationClampMin: 0.5,
  durationClampMax: 3,
  etaCandidates: 5,
  lockMs: 5000,
  reconcileGraceMs: 30_000,
  staleOnlineMs: 5 * 60_000,
  persistMinDistanceMeters: 25,
  persistMinIntervalMs: 10_000,
  trackMinIntervalMs: 2000,
  trailMinIntervalMs: 10_000,
  maxRedispatches: 2,
  destinationChangeTtlMs: 30_000,
  maxDestinationChanges: 3,
  waitingCapSeconds: 30 * 60,
  maxStops: 3,
  scheduleMinLeadMs: 30 * 60_000,
  scheduleMaxAheadMs: 7 * 86_400_000,
  scheduleSearchLeadMs: 20 * 60_000,
  scheduleReminderLeadMs: 60 * 60_000,
  scheduleMissedGraceMs: 30 * 60_000,
  maxScheduledPerRider: 5,
  scheduleSearchGraceMs: 10 * 60_000,
  scheduleOverlapMs: 30 * 60_000,
  rentalGraceMinutes: 10,
  rentalGraceKm: 2,
  oneWayDetourBp: 2000,
  cityDistanceBilling: 'QUOTED',
  cityDetourBp: 2000,
  cityShortBp: 2000,
  cityFloorBp: 5000,
  cityCeilingBp: 20_000,
  cityMinPings: 5,
  cityFlagBp: 3000,
  outstationMaxDays: 30,
  tripOverrunHours: 6,
};
