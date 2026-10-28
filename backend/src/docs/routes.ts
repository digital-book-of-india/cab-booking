/**
 * Single source of truth for the documented HTTP surface. Both the OpenAPI spec and the Postman
 * collection are generated from this list, so they cannot drift apart. Add every new endpoint here.
 */
export type RouteDoc = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  tag: string;
  summary: string;
  /** public = no token. Otherwise the roles allowed (token always required). */
  auth: 'public' | string[];
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  /** Required request headers other than Authorization / Content-Type. */
  headers?: Record<string, string>;
  /** Postman test script snippet to run after the request. */
  postmanTest?: string;
};

const DEVICE = { platform: 'android', deviceId: 'device-123', appVersion: '1.0.0' };
const ANY = ['ANY AUTHENTICATED'];
const REVIEW = ['OPS', 'SUPER_ADMIN'];
const CONFIG = ['CONFIG_ADMIN', 'SUPER_ADMIN'];
import { platformRoutes } from './routes/platform';
import { productRoutes } from './routes/product';

export const routes: RouteDoc[] = [
  ...productRoutes,
  ...platformRoutes,
  { method: 'get', path: '/health/live', tag: 'Health', summary: 'Liveness probe', auth: 'public' },
  {
    method: 'get',
    path: '/health/ready',
    tag: 'Health',
    summary: 'Readiness probe (MongoDB, Redis)',
    auth: 'public',
  },

  {
    method: 'post',
    path: '/auth/otp/request',
    tag: 'Auth',
    summary: 'Request a login OTP (rate limited per phone and IP)',
    auth: 'public',
    body: { phone: '+919876543210', purpose: 'login' },
    postmanTest: "pm.collectionVariables.set('challengeId', pm.response.json().data.challengeId);",
  },
  {
    method: 'post',
    path: '/auth/otp/verify',
    tag: 'Auth',
    summary: 'Verify OTP; creates the account on first login (role CUSTOMER or DRIVER only)',
    auth: 'public',
    body: {
      challengeId: '{{challengeId}}',
      phone: '+919876543210',
      otp: '123456',
      role: 'CUSTOMER',
      device: DEVICE,
    },
    postmanTest:
      "const d = pm.response.json().data; pm.collectionVariables.set('accessToken', d.accessToken); pm.collectionVariables.set('refreshToken', d.refreshToken);",
  },
  {
    method: 'post',
    path: '/auth/refresh',
    tag: 'Auth',
    summary: 'Rotate tokens. Reusing an old refresh token revokes the session.',
    auth: 'public',
    body: { refreshToken: '{{refreshToken}}', device: DEVICE },
    postmanTest:
      "const d = pm.response.json().data; pm.collectionVariables.set('accessToken', d.accessToken); pm.collectionVariables.set('refreshToken', d.refreshToken);",
  },
  {
    method: 'post',
    path: '/auth/logout',
    tag: 'Auth',
    summary: 'Revoke current session',
    auth: ANY,
  },
  { method: 'get', path: '/auth/me', tag: 'Auth', summary: 'Current user', auth: ANY },
  {
    method: 'get',
    path: '/auth/sessions',
    tag: 'Auth',
    summary: 'List active sessions',
    auth: ANY,
  },
  {
    method: 'delete',
    path: '/auth/sessions/{sessionId}',
    tag: 'Auth',
    summary: 'Revoke one of your own sessions',
    auth: ANY,
  },

  {
    method: 'get',
    path: '/customers/me',
    tag: 'Customers',
    summary: 'Get own profile',
    auth: ['CUSTOMER'],
  },
  {
    method: 'patch',
    path: '/customers/me',
    tag: 'Customers',
    summary: 'Update own profile',
    auth: ['CUSTOMER'],
    body: { name: 'Asha Verma', email: 'asha@example.com' },
  },

  {
    method: 'get',
    path: '/cab-categories',
    tag: 'Catalog',
    summary: 'List active cab categories',
    auth: 'public',
  },
  {
    method: 'get',
    path: '/admin/cab-categories',
    tag: 'Catalog',
    summary: 'List all categories incl. inactive',
    auth: CONFIG,
  },
  {
    method: 'post',
    path: '/admin/cab-categories',
    tag: 'Catalog',
    summary: 'Create category',
    auth: CONFIG,
    body: { code: 'LUXURY', name: 'Luxury', capacity: 4, displayOrder: 4, active: true },
  },
  {
    method: 'patch',
    path: '/admin/cab-categories/{categoryId}',
    tag: 'Catalog',
    summary: 'Update category (code is immutable)',
    auth: CONFIG,
    body: { name: 'Luxury Plus', active: false },
  },

  {
    method: 'post',
    path: '/drivers/applications',
    tag: 'Drivers',
    summary: 'Submit (or resubmit) onboarding application',
    auth: ['DRIVER'],
    body: { fullName: 'Ravi Kumar', city: 'Delhi' },
  },
  {
    method: 'get',
    path: '/drivers/me/application',
    tag: 'Drivers',
    summary: 'Application status, documents, decision reason',
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/drivers/me/documents',
    tag: 'Drivers',
    summary:
      'Register a KYC document; returns a signed upload URL. Upload the file to that URL with an HTTP PUT whose Content-Type header is exactly the contentType you declared (max 10 MB), then call the "uploaded" endpoint',
    auth: ['DRIVER'],
    body: {
      type: 'DRIVING_LICENCE',
      documentNumberLast4: '1234',
      expiresAt: '2028-05-31T00:00:00.000Z',
      contentType: 'image/jpeg',
    },
  },
  {
    method: 'get',
    path: '/drivers/me/documents',
    tag: 'Drivers',
    summary: 'List own documents',
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/drivers/me/vehicles',
    tag: 'Vehicles',
    summary: 'Register a vehicle',
    auth: ['DRIVER'],
    body: {
      categoryId: '{{categoryId}}',
      registrationNumber: 'DL 01 AB 1234',
      make: 'Maruti',
      model: 'Dzire',
      color: 'White',
      seats: 4,
    },
  },
  {
    method: 'get',
    path: '/drivers/me/vehicles',
    tag: 'Vehicles',
    summary: 'List own vehicles',
    auth: ['DRIVER'],
  },
  {
    method: 'patch',
    path: '/drivers/me/vehicles/{vehicleId}',
    tag: 'Vehicles',
    summary: 'Edit make/model/color/seats',
    auth: ['DRIVER'],
    body: { color: 'Black' },
  },

  {
    method: 'get',
    path: '/admin/drivers',
    tag: 'Admin',
    summary: 'Search/filter drivers',
    auth: REVIEW,
    query: { approvalStatus: 'PENDING', q: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/drivers/{driverId}',
    tag: 'Admin',
    summary: 'Driver detail (audited; includes document download URLs)',
    auth: REVIEW,
  },
  {
    method: 'patch',
    path: '/admin/drivers/{driverId}/approval',
    tag: 'Admin',
    summary: 'APPROVE | REJECT | REQUEST_RESUBMISSION | SUSPEND (reason required except APPROVE)',
    auth: REVIEW,
    body: { decision: 'REJECT', reason: 'Licence photo unreadable' },
  },
  {
    method: 'patch',
    path: '/admin/drivers/{driverId}/documents/{documentId}',
    tag: 'Admin',
    summary: 'Approve or reject a document',
    auth: REVIEW,
    body: { status: 'APPROVED' },
  },
  {
    method: 'patch',
    path: '/admin/vehicles/{vehicleId}/verification',
    tag: 'Admin',
    summary: 'Verify or reject a vehicle',
    auth: REVIEW,
    body: { status: 'VERIFIED' },
  },
  {
    method: 'get',
    path: '/admin/vehicles',
    tag: 'Admin',
    summary: 'List all vehicles for fleet verification',
    auth: REVIEW,
  },
  {
    method: 'get',
    path: '/admin/audit-logs',
    tag: 'Admin',
    summary: 'Search audit log',
    auth: ['SUPER_ADMIN'],
    query: { action: '', targetType: '', page: '1', limit: '20' },
  },

  {
    method: 'get',
    path: '/admin/zones',
    tag: 'Zones & Pricing',
    summary: 'List service zones',
    auth: CONFIG,
  },
  {
    method: 'post',
    path: '/admin/zones',
    tag: 'Zones & Pricing',
    summary: 'Create a service zone (GeoJSON Polygon, [lng, lat], closed ring)',
    auth: CONFIG,
    body: {
      code: 'GURGAON',
      name: 'Gurgaon',
      cityCode: 'GGN',
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [77.0, 28.4],
            [77.1, 28.4],
            [77.1, 28.5],
            [77.0, 28.5],
            [77.0, 28.4],
          ],
        ],
      },
      active: true,
      operatingHours: { start: '05:00', end: '23:30' },
    },
  },
  {
    method: 'patch',
    path: '/admin/zones/{zoneId}',
    tag: 'Zones & Pricing',
    summary: 'Update a zone (code immutable; operatingHours null = open 24h)',
    auth: CONFIG,
    body: { active: false },
  },
  {
    method: 'post',
    path: '/admin/pricing/configs',
    tag: 'Zones & Pricing',
    summary: 'Create a NEW fare config version (configs are immutable, no edits)',
    auth: CONFIG,
    body: {
      zoneId: '{{zoneId}}',
      categoryId: '{{categoryId}}',
      baseFarePaise: 4000,
      perKmPaise: 1400,
      perMinutePaise: 150,
      minimumFarePaise: 10000,
      freeWaitingSeconds: 180,
      waitingPerMinutePaise: 200,
      roundingMode: 'NEAREST_RUPEE',
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      changeReason: 'Launch pricing',
    },
  },
  {
    method: 'get',
    path: '/admin/pricing/configs',
    tag: 'Zones & Pricing',
    summary: 'List fare config versions',
    auth: CONFIG,
    query: { zoneId: '', categoryId: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/pricing/configs/active',
    tag: 'Zones & Pricing',
    summary: 'Config currently in force for a zone + category',
    auth: CONFIG,
    query: { zoneId: '{{zoneId}}', categoryId: '{{categoryId}}' },
  },

  {
    method: 'get',
    path: '/serviceability',
    tag: 'Booking',
    summary: 'Is this pickup/drop inside an open service zone, and which categories are available?',
    auth: 'public',
    query: { pickupLat: '28.6315', pickupLng: '77.2167', dropLat: '28.5562', dropLng: '77.1' },
  },
  {
    method: 'post',
    path: '/fare-quotes',
    tag: 'Booking',
    summary:
      'Server-calculated, expiring (10 min), single-use fare quote. Add scheduledFor (a pickup time between 30 minutes and 7 days from now) to price a ride for later; the zone must be open at that time',
    auth: ['CUSTOMER'],
    body: {
      pickup: { lat: 28.6315, lng: 77.2167, label: 'Connaught Place, New Delhi' },
      drop: { lat: 28.5562, lng: 77.1, label: 'IGI Airport Terminal 3' },
      stops: [],
      // stops: up to 3, e.g. [{ lat: 28.62, lng: 77.2, label: 'Stop 1' }]
      categoryId: '{{categoryId}}',
      paymentPreference: 'CASH',
    },
    postmanTest: "pm.collectionVariables.set('quoteId', pm.response.json().data.quoteId);",
  },
  {
    method: 'get',
    path: '/fare-quotes/{quoteId}',
    tag: 'Booking',
    summary: 'Read your own quote (status ACTIVE | USED | EXPIRED)',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/fare-quotes/{quoteId}/refresh',
    tag: 'Booking',
    summary: 'Re-price the same trip as a new quote',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/bookings',
    tag: 'Booking',
    summary:
      'Create a booking from a valid quote. Requires Idempotency-Key; same key + same body returns the same booking (200, Idempotent-Replayed: true). For a ride for later send rideType SCHEDULED and the same scheduledFor as the quote: the booking waits as SCHEDULED, the search for a driver starts about 20 minutes before pickup, and cancelling before then is free. At most 5 waiting at a time.',
    auth: ['CUSTOMER'],
    headers: { 'Idempotency-Key': 'booking-{{$guid}}' },
    body: {
      quoteId: '{{quoteId}}',
      paymentMethod: 'CASH',
      rideType: 'INSTANT',
      notes: 'Pickup near main gate',
      pickup: {
        lat: 28.6315,
        lng: 77.2167,
        contactName: 'Passenger',
        contactPhone: '+919876543210',
      },
    },
    postmanTest: "pm.collectionVariables.set('bookingId', pm.response.json().data.bookingId);",
  },
  {
    method: 'get',
    path: '/bookings/{bookingId}',
    tag: 'Booking',
    summary: 'Read a booking (owner customer, or OPS/SUPPORT/SUPER_ADMIN)',
    auth: ['CUSTOMER', 'OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/bookings/{bookingId}/events',
    tag: 'Booking',
    summary: 'Status timeline (who changed what, when)',
    auth: ['CUSTOMER', 'OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },

  {
    method: 'post',
    path: '/drivers/me/presence',
    tag: 'Driver presence',
    summary:
      'Go ONLINE (needs APPROVED driver + VERIFIED vehicle + location) or OFFLINE (blocked during a ride)',
    auth: ['DRIVER'],
    body: {
      status: 'ONLINE',
      vehicleId: '{{vehicleId}}',
      location: { lat: 28.6139, lng: 77.209 },
      headingDegrees: 90,
    },
  },
  {
    method: 'get',
    path: '/drivers/me/presence',
    tag: 'Driver presence',
    summary: 'Current presence, GPS freshness and eligibility issues',
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/drivers/me/location',
    tag: 'Driver presence',
    summary:
      'GPS heartbeat (throttled; stale, inaccurate or impossible-jump updates are rejected with LOCATION_REJECTED)',
    auth: ['DRIVER'],
    body: {
      lat: 28.6302,
      lng: 77.2108,
      accuracyMeters: 8,
      headingDegrees: 91,
      speedMetersPerSecond: 5.4,
      recordedAt: '2026-10-16T12:41:00.000Z',
    },
  },

  {
    method: 'get',
    path: '/drivers/me/offers',
    tag: 'Dispatch',
    summary: 'Live (unexpired) ride offers for this driver',
    auth: ['DRIVER'],
    postmanTest:
      "const o = pm.response.json().data[0]; if (o) pm.collectionVariables.set('offerId', o.offerId);",
  },
  {
    method: 'post',
    path: '/ride-offers/{offerId}/accept',
    tag: 'Dispatch',
    summary:
      'Accept an offer. Atomic: exactly one driver wins; others get 409 RIDE_ALREADY_ASSIGNED / OFFER_UNAVAILABLE. Retrying your own accept returns the same ride.',
    auth: ['DRIVER'],
    postmanTest: "pm.collectionVariables.set('rideId', pm.response.json().data.rideId);",
  },
  {
    method: 'post',
    path: '/ride-offers/{offerId}/reject',
    tag: 'Dispatch',
    summary: 'Decline an offer; dispatch moves on to the next driver',
    auth: ['DRIVER'],
    body: { reason: 'Too far' },
  },
  {
    method: 'post',
    path: '/bookings/{bookingId}/dispatch/retry',
    tag: 'Dispatch',
    summary: 'Search again for a booking in NO_DRIVER_FOUND (fresh round)',
    auth: ['OPS', 'SUPER_ADMIN'],
  },

  {
    method: 'get',
    path: '/rides/{rideId}',
    tag: 'Rides',
    summary:
      'Ride detail, shaped for the caller (customer sees driver card, driver sees rider contact; OTP never included)',
    auth: ['CUSTOMER', 'DRIVER', 'OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/rides/{rideId}/en-route',
    tag: 'Rides',
    summary: 'Assigned driver starts heading to pickup (DRIVER_ASSIGNED -> DRIVER_ARRIVING)',
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/rides/{rideId}/arrived',
    tag: 'Rides',
    summary:
      'Mark arrival (DRIVER_ARRIVING -> DRIVER_ARRIVED). Judged from the server-held driver location; NOT_AT_PICKUP if too far.',
    auth: ['DRIVER'],
    body: { location: { lat: 28.6314, lng: 77.2166 } },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/start',
    tag: 'Rides',
    summary:
      "Start the ride with the rider's 6-digit pickup OTP (max 5 attempts, expires). Odometer/location are evidence only.",
    auth: ['DRIVER'],
    body: {
      pickupOtp: '482913',
      location: { lat: 28.6315, lng: 77.2167 },
      odometerStartMeters: 125400,
    },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/complete',
    tag: 'Rides',
    summary:
      'Complete the ride. The server computes the final fare (quoted distance, measured time); payment becomes DUE, never PAID.',
    auth: ['DRIVER'],
    body: {
      endLocation: { lat: 28.5562, lng: 77.1 },
      odometerEndMeters: 143900,
      driverNote: null,
    },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/cancel',
    tag: 'Rides',
    summary: 'Assigned driver cancels before the ride starts (reason required; no fee yet)',
    auth: ['DRIVER'],
    body: { reasonCode: 'CUSTOMER_NOT_REACHABLE', note: 'Called twice, no answer' },
  },
  {
    method: 'post',
    path: '/bookings/{bookingId}/cancel',
    tag: 'Rides',
    summary: 'Customer cancels before the ride starts (reason required; no fee yet)',
    auth: ['CUSTOMER'],
    body: { reasonCode: 'CHANGED_MIND' },
  },
  {
    method: 'get',
    path: '/rides/{rideId}/pickup-otp',
    tag: 'Rides',
    summary: 'The rider reads their pickup OTP to the driver (derived, never stored)',
    auth: ['CUSTOMER'],
    postmanTest: "pm.collectionVariables.set('pickupOtp', pm.response.json().data.pickupOtp);",
  },
  {
    method: 'post',
    path: '/rides/{rideId}/otp/resend',
    tag: 'Rides',
    summary: 'Issue a fresh pickup OTP (resets attempts; 30 s cooldown)',
    auth: ['CUSTOMER'],
  },
  {
    method: 'get',
    path: '/rides/{rideId}/track',
    tag: 'Rides',
    summary: "Driver's last position and ETA, only for the rider on an active ride",
    auth: ['CUSTOMER'],
  },
  {
    method: 'get',
    path: '/customers/me/rides',
    tag: 'Rides',
    summary: 'Customer booking/ride history',
    auth: ['CUSTOMER'],
    query: { status: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/drivers/me/rides',
    tag: 'Rides',
    summary: 'Driver ride history',
    auth: ['DRIVER'],
    query: { status: '', page: '1', limit: '20' },
  },

  {
    method: 'get',
    path: '/admin/dashboard',
    tag: 'Admin',
    summary: 'Ops counters: active bookings, last 24 h by status, drivers online, review queues',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/admin/users',
    tag: 'Admin',
    summary: 'Search users by role, account status, phone or name',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
    query: { role: 'CUSTOMER', accountStatus: 'ACTIVE', q: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/users/{userId}',
    tag: 'Admin',
    summary: 'User detail (role, status, live sessions, driver/booking summary)',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },
  {
    method: 'patch',
    path: '/admin/users/{userId}/status',
    tag: 'Admin',
    summary:
      'Suspend or reactivate a customer (suspending ends all sessions). Staff accounts need SUPER_ADMIN; drivers use the approval decision',
    auth: ['OPS', 'SUPER_ADMIN'],
    body: { status: 'SUSPENDED', reason: 'Repeated abusive behaviour reported' },
  },
  {
    method: 'get',
    path: '/admin/bookings',
    tag: 'Admin',
    summary: 'Search bookings by status, payment status, customer, driver, id prefix, date range',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
    query: { status: '', paymentStatus: '', q: '', from: '', to: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/bookings/{bookingId}',
    tag: 'Admin',
    summary: 'Full booking: fare snapshot, ride, event timeline, dispatch offers (audited)',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },

  {
    method: 'post',
    path: '/devices',
    tag: 'Notifications',
    summary:
      'Register this phone for push. The push token belongs to one user: registering it on another account moves it. Call again whenever the token changes; send deviceId so the old token is replaced',
    auth: ANY,
    body: {
      token: 'fcm-device-token-from-firebase-sdk',
      platform: 'android',
      deviceId: 'device-123',
      appVersion: '1.0.0',
    },
  },
  {
    method: 'delete',
    path: '/devices/{deviceId}',
    tag: 'Notifications',
    summary: 'Stop push to this device (call on logout). Only your own devices',
    auth: ANY,
  },
  {
    method: 'get',
    path: '/notifications',
    tag: 'Notifications',
    summary: 'In-app inbox, newest first. meta.unreadCount is the badge number',
    auth: ANY,
    query: { unread: '', page: '1', limit: '20' },
  },
  {
    method: 'post',
    path: '/notifications/read',
    tag: 'Notifications',
    summary: 'Mark notifications read: send { ids: [...] } or { all: true }',
    auth: ANY,
    body: { all: true },
  },
  {
    method: 'get',
    path: '/admin/rides/{rideId}/trail',
    tag: 'Admin',
    summary:
      'The sampled route the driver took during the ride (disputes and support). Location data, so every read is audited. Points are kept 30 days',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },

  {
    method: 'get',
    path: '/bookings/{bookingId}/cancel-preview',
    tag: 'Rides',
    summary:
      'What cancelling would cost right now (feePaise, and until when it is free). The same rule the real cancel applies, from the cancellation rules frozen onto the booking',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/rides/{rideId}/no-show',
    tag: 'Rides',
    summary:
      "Driver closes the ride because the rider did not appear. Only after the policy's waiting time at the pickup (NO_SHOW_TOO_EARLY before that) and only at the pickup (NOT_AT_PICKUP). Charges the no-show fee",
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/rides/{rideId}/stops/{index}/arrived',
    tag: 'Rides',
    summary:
      'Driver reached intermediate stop number {index} (0 = first). In order, during the trip, within range of the stop (NOT_AT_STOP). Starts the stop waiting clock',
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/rides/{rideId}/stops/{index}/departed',
    tag: 'Rides',
    summary: 'Driver left that stop; the waiting at it ends',
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/rides/{rideId}/destination',
    tag: 'Rides',
    summary:
      'Rider asks for a different drop-off. The server prices the new route; the driver has 30 s to answer. Nothing changes until they accept',
    auth: ['CUSTOMER'],
    body: { drop: { lat: 28.5562, lng: 77.1, label: 'IGI Airport Terminal 3' } },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/destination/respond',
    tag: 'Rides',
    summary:
      'Driver accepts or declines the pending destination change. Accepting updates the drop-off and the fare estimate (the old fare is kept in the amendment history)',
    auth: ['DRIVER'],
    body: { accept: true },
  },
  {
    method: 'get',
    path: '/rides/{rideId}/receipt',
    tag: 'Rides',
    summary:
      'Receipt for a completed ride (or a ride that ended with a cancellation / no-show fee): fixed receipt number, itemised fare, waiting, fees, payment status',
    auth: ['CUSTOMER', 'DRIVER', 'OPS', 'SUPPORT', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/pricing/cancellation-policies',
    tag: 'Zones & Pricing',
    summary:
      'Create a NEW cancellation / no-show policy version for a zone (append-only). Bookings keep the rules in force when they were made',
    auth: CONFIG,
    body: {
      zoneId: '{{zoneId}}',
      freeCancelWindowSeconds: 120,
      cancelFeePaise: 3000,
      noShowWaitSeconds: 300,
      noShowFeePaise: 5000,
      changeReason: 'Launch policy',
    },
  },
  {
    method: 'get',
    path: '/admin/pricing/cancellation-policies',
    tag: 'Zones & Pricing',
    summary: 'List cancellation policy versions',
    auth: CONFIG,
    query: { zoneId: '', page: '1', limit: '20' },
  },
  {
    method: 'post',
    path: '/admin/bookings/{bookingId}/fee/waive',
    tag: 'Admin',
    summary: 'Waive a cancellation or no-show fee (audited; the rider is told)',
    auth: ['OPS', 'SUPER_ADMIN'],
    body: { reason: 'Driver confirmed the rider was waiting at the wrong gate' },
  },
  {
    method: 'get',
    path: '/admin/documents/expiring',
    tag: 'Admin',
    summary: 'Driver documents expiring within N days (default 30) plus those already expired',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
    query: { days: '30', page: '1', limit: '20' },
  },

  {
    method: 'post',
    path: '/bookings/{bookingId}/payments',
    tag: 'Payments',
    summary:
      'Start paying a completed ride (or a late-cancel / no-show fee) online. The server sets the amount. Same Idempotency-Key, or a payment already under way, returns the same order. Pass checkout.key and checkout.orderId to the Razorpay screen',
    auth: ['CUSTOMER'],
    headers: { 'Idempotency-Key': 'pay-{{$guid}}' },
    postmanTest: "pm.collectionVariables.set('paymentId', pm.response.json().data.paymentId);",
  },
  {
    method: 'post',
    path: '/payments/verify',
    tag: 'Payments',
    summary:
      'After the Razorpay screen succeeds, send its orderId, paymentId and signature. Only a valid signature marks the booking paid (PAYMENT_SIGNATURE_INVALID otherwise). The webhook is the backup',
    auth: ['CUSTOMER'],
    body: { orderId: 'order_xxx', paymentId: 'pay_xxx', signature: 'hex-from-razorpay' },
  },
  {
    method: 'get',
    path: '/payments/{paymentId}',
    tag: 'Payments',
    summary: 'A payment attempt: status CREATED | PAID | FAILED | EXPIRED, amount, refunded amount',
    auth: ['CUSTOMER', 'SUPPORT', 'OPS', 'FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/customers/me/balance',
    tag: 'Payments',
    summary:
      'What the rider owes, per booking, whether each is overdue and payable, and whether new bookings are blocked (UNPAID_BALANCE)',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/dev/payments/{paymentId}/complete',
    tag: 'Payments',
    summary:
      'DEVELOPMENT ONLY (mock payments, never in production): pretend the rider paid, through the same path as a real capture. Not present when real payments are on',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/webhooks/razorpay',
    tag: 'Payments',
    summary:
      'Razorpay calls this (not the apps). Signature checked on the raw body; each event id is processed once. payment.captured / order.paid, payment.failed, refund.processed, refund.failed',
    auth: 'public',
    headers: { 'X-Razorpay-Signature': 'hex hmac of the raw body' },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/cash-collected',
    tag: 'Payments',
    summary:
      'Driver confirms the rider paid the exact fare in cash (CASH bookings only). The cash is added to what the driver holds; too much cash takes them offline until they hand some in',
    auth: ['DRIVER'],
    body: { amountPaise: 25000 },
  },
  {
    method: 'get',
    path: '/drivers/me/balance',
    tag: 'Payments',
    summary:
      'Cash held, what the platform owes the driver, the net (positive = driver owes the platform), the cash limit, and any open settlement',
    auth: ['DRIVER'],
  },
  {
    method: 'get',
    path: '/drivers/me/earnings',
    tag: 'Payments',
    summary:
      'Per ride: charged, platform commission, and what the driver earned; plus totals for the period',
    auth: ['DRIVER'],
    query: { from: '', to: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/drivers/me/settlements',
    tag: 'Payments',
    summary: "The driver's own settlements",
    auth: ['DRIVER'],
    query: { status: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/payments',
    tag: 'Finance',
    summary: 'Search payment attempts by status or booking',
    auth: ['FINANCE', 'SUPER_ADMIN', 'OPS', 'SUPPORT'],
    query: { status: '', bookingId: '', page: '1', limit: '20' },
  },
  {
    method: 'post',
    path: '/admin/bookings/{bookingId}/refund',
    tag: 'Finance',
    summary:
      'Refund (part of) a payment. destination ORIGINAL (default) sends it back through Razorpay and completes when the refund webhook arrives; WALLET credits the rider’s wallet at once (the only choice for a ride paid from the wallet). Needs an Idempotency-Key. Never more than was paid in total. The platform bears the cost; the driver keeps their share',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    headers: { 'Idempotency-Key': 'refund-{{$guid}}' },
    body: { amountPaise: 5000, reason: 'Driver took a longer route', destination: 'ORIGINAL' },
  },
  {
    method: 'post',
    path: '/admin/bookings/{bookingId}/write-off',
    tag: 'Finance',
    summary:
      'Give up on money a rider will not pay (SUPER_ADMIN only). The driver is still paid; the platform takes the loss',
    auth: ['SUPER_ADMIN'],
    body: { reason: 'Rider unreachable after 3 reminders' },
  },
  {
    method: 'patch',
    path: '/admin/bookings/{bookingId}/payment-dispute',
    tag: 'Finance',
    summary:
      'Open or close a payment dispute on an unpaid booking (a disputed booking does not block the rider)',
    auth: ['FINANCE', 'SUPER_ADMIN', 'OPS', 'SUPPORT'],
    body: { disputed: true, reason: 'Rider says the ride never happened' },
  },
  {
    method: 'get',
    path: '/admin/ledger',
    tag: 'Finance',
    summary:
      'The append-only ledger: transactions with their entries, filterable by account, booking, driver or kind',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    query: { account: '', bookingId: '', driverId: '', kind: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/balances/drivers',
    tag: 'Finance',
    summary:
      "Every driver's cash held, earnings owed and net, worst first; filter to those over the cash limit",
    auth: ['FINANCE', 'SUPER_ADMIN'],
    query: { overLimit: '', q: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/finance/consistency',
    tag: 'Finance',
    summary:
      'Do the books balance? Ledger total, unbalanced transactions, rides not yet recorded, payments not yet recorded, and the gateway balance against captured minus refunded',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/drivers/{driverId}/cash-deposits',
    tag: 'Finance',
    summary:
      'Record that a driver handed cash over. Needs an Idempotency-Key; cannot exceed the cash they hold',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    headers: { 'Idempotency-Key': 'deposit-{{$guid}}' },
    body: { amountPaise: 150000, reference: 'Bank slip 88213' },
  },
  {
    method: 'post',
    path: '/admin/settlements',
    tag: 'Finance',
    summary:
      'Draft a settlement for one driver ({ driverId }) or everyone with a balance ({ all: true }): earnings netted against cash held, leaving a payout or a deposit still due',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    body: { driverId: '{{driverId}}' },
  },
  {
    method: 'get',
    path: '/admin/settlements',
    tag: 'Finance',
    summary: 'List settlements',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    query: { status: '', driverId: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/settlements/{settlementId}',
    tag: 'Finance',
    summary: 'One settlement',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/settlements/{settlementId}/approve',
    tag: 'Finance',
    summary:
      "Approve a draft: nets the driver's cash against their earnings in the ledger. Refused if the balances have changed since the draft",
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/settlements/{settlementId}/mark-paid',
    tag: 'Finance',
    summary:
      'Record that the payout was sent (bank transfer made outside the system), with its reference',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    body: { payoutReference: 'NEFT UTR 1234567890' },
  },
  {
    method: 'post',
    path: '/admin/settlements/{settlementId}/cancel',
    tag: 'Finance',
    summary: 'Cancel a draft settlement (an approved one cannot be cancelled)',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/pricing/commission',
    tag: 'Zones & Pricing',
    summary:
      'Create a NEW commission rate version for a zone (basis points, 2000 = 20%, at most 5000). Append-only; each booking keeps the rate in force when it was made',
    auth: CONFIG,
    body: { zoneId: '{{zoneId}}', rateBp: 2000, changeReason: 'Launch commission' },
  },
  {
    method: 'get',
    path: '/admin/pricing/commission',
    tag: 'Zones & Pricing',
    summary: 'List commission rate versions',
    auth: CONFIG,
    query: { zoneId: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/config/flags',
    tag: 'Config',
    summary:
      "Which features are on for the caller's role (SOS, trip sharing, support tickets, ratings, coupons). Apps read this at start-up and hide what is off",
    auth: ANY,
  },
  {
    method: 'get',
    path: '/admin/feature-flags',
    tag: 'Config',
    summary: 'Every feature switch with its current value and whether staff or the default set it',
    auth: ['CONFIG_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'put',
    path: '/admin/feature-flags/{key}',
    tag: 'Config',
    summary:
      'Switch a feature on or off, optionally only for some roles. Keys: SOS, TRIP_SHARING, SUPPORT_TICKETS, RATINGS, COUPONS. Audited',
    auth: ['CONFIG_ADMIN', 'SUPER_ADMIN'],
    body: { enabled: true, roles: [], description: 'Safety desk is staffed' },
  },
  {
    method: 'get',
    path: '/admin/staff',
    tag: 'Staff',
    summary: 'List staff accounts',
    auth: ['SUPER_ADMIN'],
    query: { role: '', accountStatus: '', page: '1', limit: '20' },
  },
  {
    method: 'post',
    path: '/admin/staff',
    tag: 'Staff',
    summary:
      'Create a staff account by phone number and role. With an email the person gets a setup link (password + authenticator); without one they sign in with a phone code, which is refused in production',
    auth: ['SUPER_ADMIN'],
    body: { phone: '+919876500001', name: 'Meera Nair', role: 'SUPPORT' },
  },
  {
    method: 'patch',
    path: '/admin/staff/{userId}/role',
    tag: 'Staff',
    summary:
      "Change a staff member's role (never your own). Their sessions are ended so the new role applies at once. Suspend or reactivate staff with PATCH /admin/users/{id}/status",
    auth: ['SUPER_ADMIN'],
    body: { role: 'OPS', reason: 'Moved to the operations desk' },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/sos',
    tag: 'Safety',
    summary:
      "Raise an emergency alert during a live ride (rider or the assigned driver). The ride carries on; staff are alerted at once and the person's saved contacts are texted. Repeating it returns the same alert. Needs the SOS feature on",
    auth: ['CUSTOMER', 'DRIVER'],
    body: { note: 'Driver is taking a different route' },
  },
  {
    method: 'get',
    path: '/rides/{rideId}/sos',
    tag: 'Safety',
    summary: 'Your own alerts on this ride and their status',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'get',
    path: '/me/emergency-contacts',
    tag: 'Safety',
    summary: 'Your saved emergency contacts (at most 3)',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'post',
    path: '/me/emergency-contacts',
    tag: 'Safety',
    summary: 'Save an emergency contact',
    auth: ['CUSTOMER', 'DRIVER'],
    body: { name: 'Asha', phone: '+919812300000', relationship: 'Sister' },
  },
  {
    method: 'delete',
    path: '/me/emergency-contacts/{contactId}',
    tag: 'Safety',
    summary: 'Remove a saved contact',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'post',
    path: '/rides/{rideId}/share',
    tag: 'Safety',
    summary:
      'Rider creates a link so others can follow the live trip. Returns the token; the link works only while the ride is live and can be stopped',
    auth: ['CUSTOMER'],
  },
  {
    method: 'delete',
    path: '/rides/{rideId}/share',
    tag: 'Safety',
    summary: 'Stop sharing: every link for this ride stops working',
    auth: ['CUSTOMER'],
  },
  {
    method: 'get',
    path: '/public/trips/{token}',
    tag: 'Safety',
    summary:
      'What someone holding a trip-share link sees: driver first name, vehicle, live position, no phone numbers. Nothing once the ride ends. No login; rate limited',
    auth: 'public',
  },
  {
    method: 'get',
    path: '/admin/incidents',
    tag: 'Safety desk',
    summary: 'Emergency alerts, newest first',
    auth: ['SAFETY_ADMIN', 'OPS', 'SUPER_ADMIN'],
    query: { status: 'OPEN', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/incidents/{incidentId}',
    tag: 'Safety desk',
    summary:
      'One alert with the rider and driver contact details and the ride snapshot. Viewing is audited',
    auth: ['SAFETY_ADMIN', 'OPS', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/admin/incidents/{incidentId}/location',
    tag: 'Safety desk',
    summary: 'Where the driver is right now (poll while an alert is open)',
    auth: ['SAFETY_ADMIN', 'OPS', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/incidents/{incidentId}/acknowledge',
    tag: 'Safety desk',
    summary: 'Take an alert. Alerts nobody takes within 2 minutes are escalated to a super admin',
    auth: ['SAFETY_ADMIN', 'OPS', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/incidents/{incidentId}/notes',
    tag: 'Safety desk',
    summary: 'Add a note to an alert',
    auth: ['SAFETY_ADMIN', 'OPS', 'SUPER_ADMIN'],
    body: { text: 'Called the driver, no answer' },
  },
  {
    method: 'post',
    path: '/admin/incidents/{incidentId}/resolve',
    tag: 'Safety desk',
    summary: 'Close an alert with its outcome: FALSE_ALARM | ASSISTED | POLICE_INFORMED | OTHER',
    auth: ['SAFETY_ADMIN', 'OPS', 'SUPER_ADMIN'],
    body: { outcome: 'ASSISTED', note: 'Rider reached safely' },
  },
  {
    method: 'post',
    path: '/support/tickets',
    tag: 'Support',
    summary:
      'Raise a help request, optionally about one of your rides (category FARE_DISPUTE, PAYMENT_ISSUE, DRIVER_BEHAVIOUR, RIDER_BEHAVIOUR, LOST_ITEM, SAFETY_CONCERN, APP_PROBLEM, OTHER). A safety concern is high priority',
    auth: ['CUSTOMER', 'DRIVER'],
    body: {
      category: 'FARE_DISPUTE',
      subject: 'Charged more than the estimate',
      message: 'The fare was higher than the quote.',
      bookingId: '{{bookingId}}',
    },
  },
  {
    method: 'get',
    path: '/support/tickets',
    tag: 'Support',
    summary: 'Your tickets, most recently active first',
    auth: ['CUSTOMER', 'DRIVER'],
    query: { status: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/support/tickets/{ticketId}',
    tag: 'Support',
    summary: 'A ticket with its conversation (staff-only notes are never shown)',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'post',
    path: '/support/tickets/{ticketId}/messages',
    tag: 'Support',
    summary: 'Reply on your ticket (a resolved ticket reopens)',
    auth: ['CUSTOMER', 'DRIVER'],
    body: { text: 'Here is the screenshot.' },
  },
  {
    method: 'post',
    path: '/support/tickets/{ticketId}/close',
    tag: 'Support',
    summary: 'Close your ticket',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'get',
    path: '/admin/support/tickets',
    tag: 'Support desk',
    summary:
      'The queue: filter by status, category, priority, assignee, unassigned or a search; overdue = no reply after 24 hours',
    auth: ['SUPPORT', 'OPS', 'SUPER_ADMIN'],
    query: {
      status: '',
      category: '',
      priority: '',
      assignedTo: '',
      q: '',
      page: '1',
      limit: '20',
    },
  },
  {
    method: 'get',
    path: '/admin/support/tickets/{ticketId}',
    tag: 'Support desk',
    summary: 'A ticket with the whole conversation including internal notes',
    auth: ['SUPPORT', 'OPS', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/support/tickets/{ticketId}/assign',
    tag: 'Support desk',
    summary: 'Assign to a staff member (default: yourself)',
    auth: ['SUPPORT', 'OPS', 'SUPER_ADMIN'],
    body: {},
  },
  {
    method: 'post',
    path: '/admin/support/tickets/{ticketId}/messages',
    tag: 'Support desk',
    summary: 'Reply to the user, or add an internal note ({ internal: true })',
    auth: ['SUPPORT', 'OPS', 'SUPER_ADMIN'],
    body: { text: 'We have checked the fare.', internal: false },
  },
  {
    method: 'patch',
    path: '/admin/support/tickets/{ticketId}',
    tag: 'Support desk',
    summary: 'Change status (IN_PROGRESS | WAITING_USER) or priority',
    auth: ['SUPPORT', 'OPS', 'SUPER_ADMIN'],
    body: { priority: 'HIGH' },
  },
  {
    method: 'post',
    path: '/admin/support/tickets/{ticketId}/resolve',
    tag: 'Support desk',
    summary:
      'Resolve with an outcome (REFUNDED | FEE_WAIVED | WARNING_ISSUED | NO_ACTION | ESCALATED | OTHER) and a note the user sees. The refund / fee waiver itself is done with the finance endpoints',
    auth: ['SUPPORT', 'OPS', 'SUPER_ADMIN'],
    body: { outcome: 'FEE_WAIVED', note: 'We waived the late-cancellation fee.' },
  },
  {
    method: 'post',
    path: '/rides/{rideId}/rating',
    tag: 'Ratings',
    summary:
      'Rate the other person 1-5 once the ride is completed (within 7 days; once per ride per side). Tags depend on who is rating',
    auth: ['CUSTOMER', 'DRIVER'],
    body: { stars: 5, tags: ['POLITE', 'SAFE_DRIVING'], comment: 'Smooth ride' },
  },
  {
    method: 'get',
    path: '/rides/{rideId}/rating',
    tag: 'Ratings',
    summary:
      'Whether you have rated this ride, your rating, whether you still can, and the tags you may use',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'get',
    path: '/drivers/me/ratings',
    tag: 'Ratings',
    summary:
      'Your average, how many ratings, the spread, and your recent ratings (riders are never named)',
    auth: ['DRIVER'],
  },
  {
    method: 'get',
    path: '/admin/ratings',
    tag: 'Ratings',
    summary: 'Low ratings for review (default 2 stars or fewer)',
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
    query: { maxStars: '2', hidden: '', page: '1', limit: '20' },
  },
  {
    method: 'patch',
    path: '/admin/ratings/{ratingId}',
    tag: 'Ratings',
    summary: 'Hide (or unhide) an abusive comment; the stars still count',
    auth: ['OPS', 'SUPER_ADMIN'],
    body: { hidden: true, reason: 'Abusive language' },
  },
  {
    method: 'get',
    path: '/admin/reports/summary',
    tag: 'Reports',
    summary:
      'Operations numbers for a period (default last 7 days, at most 92): bookings by status, completion/cancel/no-driver rates, fares, discounts, commission, time to find a driver, offer acceptance, active drivers, a per-day series (India time)',
    auth: ['OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { from: '', to: '', zoneId: '' },
  },
  {
    method: 'get',
    path: '/admin/exports/{kind}',
    tag: 'Reports',
    summary:
      'Download a CSV (kind: rides, payments, settlements, ledger; add .csv). Rides are for OPS, FINANCE and SUPER_ADMIN; payments, settlements and the ledger for FINANCE and SUPER_ADMIN. At most 50,000 rows; ids only, no phone numbers; every download is audited',
    auth: ['OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { from: '', to: '' },
  },
  {
    method: 'post',
    path: '/admin/coupons',
    tag: 'Coupons',
    summary:
      'Create a promotion code: PERCENT (value in basis points, 1000 = 10%) or FLAT (paise), optional cap, minimum fare, dates, total and per-rider limits, zones, cab types. The platform pays for the discount; the driver is paid on the full fare',
    auth: ['CONFIG_ADMIN', 'SUPER_ADMIN'],
    body: {
      code: 'WELCOME50',
      type: 'FLAT',
      value: 5000,
      minFarePaise: 10000,
      validFrom: '2026-11-01T00:00:00.000Z',
      validTo: '2026-12-31T00:00:00.000Z',
      perUserLimit: 1,
    },
  },
  {
    method: 'get',
    path: '/admin/coupons',
    tag: 'Coupons',
    summary: 'List coupons with how many times each has been used',
    auth: ['CONFIG_ADMIN', 'SUPER_ADMIN'],
    query: { active: '', page: '1', limit: '20' },
  },
  {
    method: 'patch',
    path: '/admin/coupons/{couponId}',
    tag: 'Coupons',
    summary:
      'Switch a coupon off, extend its end date, or raise its limit (never below what was used)',
    auth: ['CONFIG_ADMIN', 'SUPER_ADMIN'],
    body: { active: false },
  },
  {
    method: 'get',
    path: '/admin/system/health',
    tag: 'Operations',
    summary:
      'What the monitor sees right now: ledger balanced, stuck searches, unanswered SOS, push backlog, unfinished webhooks, payments missing from the ledger, dead background jobs. Each check says OK or what to do',
    auth: ['OPS', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/admin/system/metrics',
    tag: 'Operations',
    summary:
      'Request counts and speed per route (average and 95th percentile), status classes, server errors in the last 5 minutes, memory and event-loop lag for this server',
    auth: ['OPS', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/metrics',
    tag: 'Operations',
    summary:
      'The same numbers as Prometheus text for a metrics tool. Not a staff login: send Authorization: Bearer <METRICS_TOKEN>. Returns 404 when no token is configured',
    auth: 'public',
  },
  {
    method: 'post',
    path: '/rides/{rideId}/tip',
    tag: 'Tips',
    summary:
      'Rider tips the driver after a completed ride (within 24 hours, Rs 10 to Rs 2,000, one tip per ride). source ONLINE returns a checkout to pay through Razorpay; WALLET pays at once from the wallet balance. The driver receives all of it (no commission). Needs an Idempotency-Key. Needs the TIPS feature on',
    auth: ['CUSTOMER'],
    headers: { 'Idempotency-Key': 'tip-{{$guid}}' },
    body: { amountPaise: 5000, source: 'ONLINE' },
  },
  {
    method: 'get',
    path: '/rides/{rideId}/tip',
    tag: 'Tips',
    summary:
      'The tip on this ride, or { tip: null }. The rider also gets the payment details to finish paying; the driver sees it once it is paid',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'get',
    path: '/wallet',
    tag: 'Wallet',
    summary:
      'The rider’s wallet: balance, the limits, and the latest entries (money in positive, money out negative). Needs the WALLET feature on for changes, not for looking',
    auth: ['CUSTOMER'],
    query: { limit: '20' },
  },
  {
    method: 'post',
    path: '/wallet/topups',
    tag: 'Wallet',
    summary:
      'Add money: starts an online payment (Rs 50 to Rs 5,000 each; the wallet holds at most Rs 10,000). Finish it with the usual checkout and /payments/verify; the wallet is credited when the payment is confirmed. Needs an Idempotency-Key',
    auth: ['CUSTOMER'],
    headers: { 'Idempotency-Key': 'topup-{{$guid}}' },
    body: { amountPaise: 50000 },
  },
  {
    method: 'post',
    path: '/bookings/{bookingId}/pay-from-wallet',
    tag: 'Wallet',
    summary:
      'Pay what a booking owes (fare or fee) from the wallet balance, at once. 402 INSUFFICIENT_WALLET_BALANCE if there is not enough. Needs an Idempotency-Key',
    auth: ['CUSTOMER'],
    headers: { 'Idempotency-Key': 'wallet-{{$guid}}' },
  },
  {
    method: 'get',
    path: '/admin/wallets/{customerId}',
    tag: 'Wallet',
    summary: 'A rider’s wallet balance and latest entries, for support and finance',
    auth: ['SUPPORT', 'OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { limit: '20' },
  },
  {
    method: 'get',
    path: '/drivers/me/payout-account',
    tag: 'Payouts',
    summary:
      'Where the driver’s earnings are sent: type, holder name, hidden number, and review status (PENDING until finance checks it, then ACTIVE or REJECTED), or { account: null }',
    auth: ['DRIVER'],
  },
  {
    method: 'put',
    path: '/drivers/me/payout-account',
    tag: 'Payouts',
    summary:
      'Save (or replace) the bank account or UPI id for payouts. The full number goes to the payout service only; we keep the last 4 digits. A new or changed account is PENDING until finance verifies it',
    auth: ['DRIVER'],
    body: {
      type: 'BANK',
      holderName: 'Ravi Kumar',
      accountNumber: '123456789012',
      ifsc: 'HDFC0001234',
    },
  },
  {
    method: 'get',
    path: '/admin/drivers/{driverId}/payout-account',
    tag: 'Payouts',
    summary: 'A driver’s payout account (numbers hidden) and its review status',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/drivers/{driverId}/payout-account/review',
    tag: 'Payouts',
    summary:
      'Approve or reject a new or changed payout account (confirm the holder name matches the driver first). No money is sent to an account that is not ACTIVE',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    body: { decision: 'APPROVE' },
  },
  {
    method: 'post',
    path: '/admin/settlements/{settlementId}/payout',
    tag: 'Payouts',
    summary:
      'Send an APPROVED settlement’s payout to the driver’s verified account through the payout service. Safe to repeat: a payout already on its way is returned, never sent twice. The settlement becomes PAID when the service confirms (webhook). Not used if AUTO_PAYOUTS is on',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/admin/settlements/{settlementId}/payouts',
    tag: 'Payouts',
    summary:
      'Every payout attempt for a settlement (status CREATED | PROCESSING | PAID | FAILED | REVERSED, bank reference, failure reason)',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/admin/payouts',
    tag: 'Payouts',
    summary: 'Payout attempts, newest first, filtered by status or driver',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    query: { status: '', driverId: '', page: '1', limit: '20' },
  },
  {
    method: 'post',
    path: '/dev/payouts/{payoutId}/complete',
    tag: 'Payouts',
    summary:
      'DEVELOPMENT ONLY (mock payouts): pretend the bank confirmed the transfer. Not available when real payouts are on',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/webhooks/razorpayx',
    tag: 'Payouts',
    summary:
      'The payout service (RazorpayX) calls this, not the apps. Signature checked on the raw body; each event id is processed once. payout.processed, payout.failed / rejected, payout.reversed',
    auth: 'public',
    headers: { 'X-Razorpay-Signature': 'hex hmac of the raw body' },
  },
  {
    method: 'get',
    path: '/admin/analytics/demand',
    tag: 'Analytics',
    summary:
      'When people ask for rides: a Monday-to-Sunday by hour (India time) grid of requests and completed rides, plus the split by zone. Period default last 28 days, at most 92',
    auth: ['OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { from: '', to: '', zoneId: '' },
  },
  {
    method: 'get',
    path: '/admin/analytics/fulfilment',
    tag: 'Analytics',
    summary:
      'How well demand is served, hour by hour (India time): requests, completed, no driver found, cancelled, rates, and average seconds to find a driver',
    auth: ['OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { from: '', to: '', zoneId: '' },
  },
  {
    method: 'get',
    path: '/admin/analytics/cancellations',
    tag: 'Analytics',
    summary:
      'Why rides are lost: share by who cancelled, by reason (with how many minutes after the request), and the cancellation / no-show fees due or waived',
    auth: ['OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { from: '', to: '', zoneId: '' },
  },
  {
    method: 'get',
    path: '/admin/analytics/drivers',
    tag: 'Analytics',
    summary:
      'Drivers ranked by completed rides: earnings, tips, how often they accept offers, rating. Staff only',
    auth: ['OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { from: '', to: '', zoneId: '', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/analytics/retention',
    tag: 'Analytics',
    summary:
      'Active riders and drivers in the last 24 hours / 7 / 30 days, and weekly groups of new riders with the share who rode again in each following week',
    auth: ['OPS', 'FINANCE', 'SUPER_ADMIN'],
    query: { weeks: '8' },
  },
  {
    method: 'get',
    path: '/admin/analytics/revenue',
    tag: 'Analytics',
    summary:
      'Money by day (India time): fares, discounts, commission, driver earnings, tips, refunds, and what was collected by method (card or wallet) and purpose',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    query: { from: '', to: '', zoneId: '' },
  },
  {
    method: 'patch',
    path: '/bookings/{bookingId}/schedule',
    tag: 'Booking',
    summary:
      'Move a ride that is still waiting (SCHEDULED) to another pickup time (same limits as booking; the zone must be open then). 409 RIDE_INVALID_STATE once the search has started',
    auth: ['CUSTOMER'],
    body: { scheduledFor: '2026-11-01T09:30:00.000Z' },
  },
  {
    method: 'get',
    path: '/bookings',
    tag: 'Booking',
    summary:
      "The rider's own bookings, newest first. With status=SCHEDULED: the rides waiting for later, soonest first. Paged",
    auth: ['CUSTOMER'],
    query: { status: '', page: '1', limit: '20' },
  },
  {
    method: 'post',
    path: '/admin/bookings/{bookingId}/scheduled/cancel',
    tag: 'Booking',
    summary:
      "Cancel a ride that is still waiting for its time (SCHEDULED) on the rider's behalf. Free; the rider is told. 409 once the search has started",
    auth: ['OPS', 'SUPPORT', 'SUPER_ADMIN'],
    body: { reason: 'Rider asked us to cancel by phone' },
  },
  {
    method: 'post',
    path: '/admin/bookings/{bookingId}/scheduled/start-now',
    tag: 'Booking',
    summary:
      'Start the search for a waiting scheduled ride now (for example when the scheduled-rides job was down). Same as the automatic start',
    auth: ['OPS', 'SUPER_ADMIN'],
  },
  {
    method: 'get',
    path: '/corporate/me',
    tag: 'Corporate',
    summary:
      'Your company account: the company, your limits and what you have used this month, and any invitations waiting for you (matched by your phone number)',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/corporate/invitations/{membershipId}/accept',
    tag: 'Corporate',
    summary: 'Accept an invitation to a company account. You can be in one company at a time',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/corporate/me/leave',
    tag: 'Corporate',
    summary: 'Leave your company account (the only admin cannot leave)',
    auth: ['CUSTOMER'],
  },
  {
    method: 'get',
    path: '/corporate/employees',
    tag: 'Corporate',
    summary:
      "Company admin: the company's people with their monthly limit and what each has used this month",
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/corporate/employees',
    tag: 'Corporate',
    summary:
      'Company admin: invite an employee by phone number (they accept in the app). Optional own monthly limit and role',
    auth: ['CUSTOMER'],
    body: { phone: '+919812300000', name: 'Asha Rao', role: 'EMPLOYEE', monthlyLimitPaise: 500000 },
  },
  {
    method: 'patch',
    path: '/corporate/employees/{membershipId}',
    tag: 'Corporate',
    summary:
      "Company admin: change an employee's monthly limit or role, or remove them. You cannot remove or demote yourself",
    auth: ['CUSTOMER'],
    body: { monthlyLimitPaise: 800000 },
  },
  {
    method: 'get',
    path: '/corporate/rides',
    tag: 'Corporate',
    summary:
      'Company admin: every ride billed to the company, newest first, with the rider, route, company reference and whether it is invoiced',
    auth: ['CUSTOMER'],
    query: { from: '', to: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/corporate/invoices',
    tag: 'Corporate',
    summary: "Company admin: the company's issued and paid invoices",
    auth: ['CUSTOMER'],
    query: { status: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/corporate/invoices/{invoiceId}',
    tag: 'Corporate',
    summary: 'Company admin: one invoice with all its lines',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/admin/corporate',
    tag: 'Corporate',
    summary:
      'Create a company account with its first admin (invited by phone). Defaults: credit limit Rs 50,000, payment terms 15 days, Rs 10,000 per employee per month',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    body: {
      name: 'Acme Travels Pvt Ltd',
      billingEmail: 'accounts@acme.example',
      adminPhone: '+919812300000',
      adminName: 'Asha Rao',
      creditLimitPaise: 5000000,
      paymentTermsDays: 15,
      defaultEmployeeMonthlyLimitPaise: 1000000,
      perRideCapPaise: 300000,
    },
  },
  {
    method: 'get',
    path: '/admin/corporate',
    tag: 'Corporate',
    summary: 'Company accounts, by name',
    auth: ['OPS', 'SUPPORT', 'FINANCE', 'SUPER_ADMIN'],
    query: { status: '', q: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/corporate/accounts',
    tag: 'Corporate',
    summary: 'Company accounts, by name',
    auth: ['OPS', 'SUPPORT', 'FINANCE', 'SUPER_ADMIN'],
    query: { status: '', q: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/corporate/{companyId}',
    tag: 'Corporate',
    summary:
      'One company with its admins, how much it owes, rides not yet billed, credit still available and invoiced-unpaid',
    auth: ['OPS', 'SUPPORT', 'FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'patch',
    path: '/admin/corporate/{companyId}',
    tag: 'Corporate',
    summary:
      "Change a company's limits, terms or status (SUSPENDED stops new rides on the account at once)",
    auth: ['FINANCE', 'SUPER_ADMIN'],
    body: { creditLimitPaise: 8000000 },
  },
  {
    method: 'post',
    path: '/admin/corporate/{companyId}/invoices',
    tag: 'Corporate',
    summary:
      "Gather the company's billed rides and fees accrued in a period into a DRAFT invoice. Each ride is on one invoice only. Tax is not calculated by the system",
    auth: ['FINANCE', 'SUPER_ADMIN'],
    body: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
  },
  {
    method: 'get',
    path: '/admin/corporate-invoices',
    tag: 'Corporate',
    summary:
      'Invoices across companies, newest first; overdue=true for issued invoices past their due date',
    auth: ['OPS', 'SUPPORT', 'FINANCE', 'SUPER_ADMIN'],
    query: { companyId: '', status: '', overdue: '', page: '1', limit: '20' },
  },
  {
    method: 'get',
    path: '/admin/corporate-invoices/{invoiceId}',
    tag: 'Corporate',
    summary: 'One invoice with its lines and payments',
    auth: ['OPS', 'SUPPORT', 'FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/corporate-invoices/{invoiceId}/issue',
    tag: 'Corporate',
    summary:
      "Issue a draft: gives it its number (CI-year-sequence) and a due date from the company's terms",
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/corporate-invoices/{invoiceId}/void',
    tag: 'Corporate',
    summary: 'Cancel a draft or an unpaid issued invoice; its rides can go on a new invoice',
    auth: ['FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'post',
    path: '/admin/corporate-invoices/{invoiceId}/payments',
    tag: 'Corporate',
    summary:
      'Record a bank payment from the company (part or all). Needs an Idempotency-Key; a repeat returns the same result. Never more than is left to pay',
    auth: ['FINANCE', 'SUPER_ADMIN'],
    headers: { 'Idempotency-Key': 'corp-pay-{{$guid}}' },
    body: { amountPaise: 1500000, reference: 'NEFT UTR123456789' },
  },
  {
    method: 'post',
    path: '/admin/corporate-bookings/{bookingId}/credit',
    tag: 'Corporate',
    summary:
      "Take (part of) a company ride's charge off what the company owes, before it is invoiced. The platform bears the cost; the driver keeps their share",
    auth: ['FINANCE', 'SUPER_ADMIN'],
    body: { amountPaise: 5000, reason: 'Driver took a longer route' },
  },
  {
    method: 'post',
    path: '/auth/staff/setup',
    tag: 'Staff login',
    summary:
      'Step 1 of a new staff account (from the emailed link, valid 3 days, single use): choose a password (12+ characters, not common, not your name or email). Returns the authenticator secret to scan and a short-lived setupSession',
    auth: 'public',
    body: { inviteToken: '<from the email link>', password: 'a long unusual password' },
  },
  {
    method: 'post',
    path: '/auth/staff/setup/confirm',
    tag: 'Staff login',
    summary:
      'Step 2: enter the first 6-digit code from the authenticator app. Turns two-step sign-in on, signs the person in, and returns 8 one-time recovery codes (shown only now)',
    auth: 'public',
    body: { setupSession: '<from step 1>', code: '123456' },
  },
  {
    method: 'post',
    path: '/auth/staff/login',
    tag: 'Staff login',
    summary:
      'Staff sign-in step 1: email and password. Answers { mfaRequired, mfaToken } (valid 5 minutes). Wrong details always give the same answer; 5 wrong attempts lock the account for 15 minutes',
    auth: 'public',
    body: { email: 'meera@example.com', password: '...' },
  },
  {
    method: 'post',
    path: '/auth/staff/mfa',
    tag: 'Staff login',
    summary:
      'Staff sign-in step 2: the 6-digit authenticator code (each code works once) or a recovery code. Returns the session tokens. Staff sessions last 12 hours',
    auth: 'public',
    body: { mfaToken: '<from step 1>', code: '123456' },
  },
  {
    method: 'post',
    path: '/auth/staff/password/forgot',
    tag: 'Staff login',
    summary:
      'Email a reset link (valid 1 hour). Always answers the same, so nobody can find out who has an account',
    auth: 'public',
    body: { email: 'meera@example.com' },
  },
  {
    method: 'post',
    path: '/auth/staff/password/reset',
    tag: 'Staff login',
    summary:
      'Choose a new password with the emailed link AND a code from the authenticator (or a recovery code). Signs out every old login',
    auth: 'public',
    body: { resetToken: '<from the email link>', password: 'a new long password', code: '123456' },
  },
  {
    method: 'post',
    path: '/auth/staff/password/change',
    tag: 'Staff login',
    summary:
      'Change your own password (needs the current password and a fresh authenticator code). Your other logins end; this one stays',
    auth: ['OPS', 'SUPPORT', 'FINANCE', 'SAFETY_ADMIN', 'CONFIG_ADMIN', 'SUPER_ADMIN'],
    body: { currentPassword: '...', newPassword: '...', code: '123456' },
  },
  {
    method: 'post',
    path: '/admin/staff/{userId}/credentials',
    tag: 'Staff',
    summary:
      'Give a staff member an email login, or reset a lost password / authenticator: emails a new setup link and ends their old logins. Super admin only',
    auth: ['SUPER_ADMIN'],
    body: { email: 'meera@example.com' },
  },
  {
    method: 'get',
    path: '/me/data-export',
    tag: 'Privacy',
    summary:
      'A copy of your data as JSON: account, bookings, payments, wallet, tips, ratings you gave, support tickets, emergency contacts, devices, and (drivers) vehicles and document status. Once every 5 minutes. Money records are kept by law even after deletion',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'get',
    path: '/me/deletion',
    tag: 'Privacy',
    summary:
      'Whether you have asked to delete your account, when it will happen, and anything that must be sorted out first (an unfinished ride, an unpaid amount, wallet money, a driver settlement)',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'post',
    path: '/me/deletion',
    tag: 'Privacy',
    summary:
      'Ask to delete your account. It happens after 7 days (cancel any time before); refused while something is unresolved. Your name and phone are removed and the phone number can be used again; money records stay, anonymised',
    auth: ['CUSTOMER', 'DRIVER'],
    body: { confirm: true },
  },
  {
    method: 'delete',
    path: '/me/deletion',
    tag: 'Privacy',
    summary: 'Cancel a deletion request while it is waiting',
    auth: ['CUSTOMER', 'DRIVER'],
  },
  {
    method: 'post',
    path: '/admin/users/{userId}/delete',
    tag: 'Privacy',
    summary:
      'Delete an account now (for example a legal request), under the same conditions. Recorded in the audit log',
    auth: ['SUPER_ADMIN'],
    body: { reason: 'Erasure request received by email', confirm: true },
  },
  {
    method: 'post',
    path: '/drivers/me/documents/{documentId}/uploaded',
    tag: 'Drivers',
    summary:
      'Tell the server the file is uploaded. It looks in storage: the file must be there, under 10 MB and of the declared type. A bad file is deleted. Staff can approve a document only when its file is really there',
    auth: ['DRIVER'],
  },
  {
    method: 'post',
    path: '/admin/rental-packages',
    tag: 'Trips',
    summary: 'Create an hourly rental package for a zone and cab type',
    auth: CONFIG,
    body: {
      zoneId: '<zoneId>',
      categoryId: '<categoryId>',
      name: '4 hours / 40 km',
      hours: 4,
      includedKm: 40,
      pricePaise: 120000,
      extraKmPaise: 1800,
      extraHourPaise: 24000,
    },
  },
  {
    method: 'get',
    path: '/admin/rental-packages',
    tag: 'Trips',
    summary: 'List rental packages',
    auth: ['CONFIG_ADMIN', 'OPS', 'FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'patch',
    path: '/admin/rental-packages/{packageId}',
    tag: 'Trips',
    summary:
      'Change a package price or switch it off (hours and km cannot change: make a new package)',
    auth: CONFIG,
    body: { active: false },
  },
  {
    method: 'post',
    path: '/admin/outstation-rates',
    tag: 'Trips',
    summary: 'Set outstation rates for a zone and cab type',
    auth: CONFIG,
    body: {
      zoneId: '<zoneId>',
      categoryId: '<categoryId>',
      oneWayPerKmPaise: 1800,
      roundTripPerKmPaise: 1400,
      minKmPerDay: 250,
      driverAllowancePerNightPaise: 30000,
    },
  },
  {
    method: 'get',
    path: '/admin/outstation-rates',
    tag: 'Trips',
    summary: 'List outstation rates',
    auth: ['CONFIG_ADMIN', 'OPS', 'FINANCE', 'SUPER_ADMIN'],
  },
  {
    method: 'patch',
    path: '/admin/outstation-rates/{rateId}',
    tag: 'Trips',
    summary: 'Change outstation rates or switch them off',
    auth: CONFIG,
    body: { oneWayPerKmPaise: 1900 },
  },
  {
    method: 'get',
    path: '/rental-packages',
    tag: 'Trips',
    summary: 'Rental packages available at a location (then quote with rentalPackageId)',
    auth: ['CUSTOMER'],
    query: { lat: '12.97', lng: '77.59' },
  },
  {
    method: 'get',
    path: '/outstation/options',
    tag: 'Trips',
    summary:
      'Cab types and per-km rates for outstation trips from a location (then quote with outstation)',
    auth: ['CUSTOMER'],
    query: { lat: '12.97', lng: '77.59' },
  },
  {
    method: 'get',
    path: '/drivers/me/preferences',
    tag: 'Trips',
    summary: 'Which long trips the driver accepts (rentals, outstation)',
    auth: ['DRIVER'],
  },
  {
    method: 'patch',
    path: '/drivers/me/preferences',
    tag: 'Trips',
    summary: 'Choose whether to be offered rentals and outstation trips',
    auth: ['DRIVER'],
    body: { acceptsOutstation: true },
  },
];
