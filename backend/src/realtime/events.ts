/**
 * The realtime contract (documented for app developers in docs/realtime-contract.md).
 *
 * Sockets only ANNOUNCE what already happened. They never change anything: every action is a
 * normal REST call, and the REST API stays the source of truth. A client that missed an event, or
 * reconnects, simply re-reads over REST. Payloads are deliberately small (ids and a new status).
 */
export const ServerEvents = {
  /** Sent once after connecting, when the socket is fully set up and subscribed. */
  HELLO: 'hello',
  /** A ride request for this driver. */
  OFFER_NEW: 'offer:new',
  /** That offer is no longer open (expired, taken by someone else, or the rider cancelled). */
  OFFER_CLOSED: 'offer:closed',
  /** The rider's booking moved to a new status. */
  BOOKING_STATUS: 'booking:status',
  /** The assigned driver's ride moved to a new status. */
  RIDE_STATUS: 'ride:status',
  /**
   * Something about the ride changed that is not a status: a stop reached or left, a destination
   * change asked for / answered, a fee waived. `kind` says which. Sent to rider and/or driver.
   */
  RIDE_UPDATE: 'ride:update',
  /** The assigned driver's position, to the rider only, only while the ride is active. */
  DRIVER_LOCATION: 'driver:location',
  /** Staff only: any booking changed. */
  OPS_BOOKING: 'ops:booking',
  /** Staff only: someone triggered an emergency alert, or one was escalated. */
  OPS_SOS: 'ops:sos',
  /** The access token is about to stop working: send `auth:refresh` with a new one. */
  AUTH_EXPIRED: 'auth:expired',
  /** The session was ended (logout, suspension). The server disconnects right after. */
  AUTH_REVOKED: 'auth:revoked',
} as const;

export const ClientEvents = {
  /** Driver: send a GPS fix. Same rules and limits as `POST /drivers/me/location`. */
  LOCATION_UPDATE: 'location:update',
  /** Replace the access token on a live socket before it expires. */
  AUTH_REFRESH: 'auth:refresh',
} as const;

export type ServerEventName = (typeof ServerEvents)[keyof typeof ServerEvents];

/** Every message is wrapped so a client can drop duplicates by `id` (delivery is at-least-once). */
export type Envelope<T = unknown> = {
  id: string;
  type: ServerEventName;
  at: string;
  data: T;
};

export type RideUpdateKind =
  | 'STOP_ARRIVED'
  | 'STOP_DEPARTED'
  | 'DESTINATION_REQUESTED'
  | 'DESTINATION_ACCEPTED'
  | 'DESTINATION_DECLINED'
  | 'FEE_WAIVED';

export type OfferClosedReason = 'EXPIRED' | 'TAKEN' | 'CANCELLED' | 'WITHDRAWN';
