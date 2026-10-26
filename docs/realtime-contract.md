# Realtime and push contract (v1.0, Phase 4)

For the customer app, driver app and admin panel developers. REST stays the **only** way to change anything (see `mobile-integration-guide.md`). Sockets and push only **announce** what already happened.

> **The golden rule:** treat every live event as a hint to refresh. If you miss one, reconnect, or the app was asleep, call the REST endpoint (`GET /bookings/{id}`, `GET /rides/{id}`, `GET /drivers/me/offers`). The REST answer is always correct. Live updates make the app feel instant; polling every 5 s remains a safe fallback.

## 1. Connecting

Socket.IO v4, same host and port as the REST API (`/socket.io`). Use the websocket transport.

```js
const socket = io(BASE_URL, {
  auth: { token: accessToken },        // or header: Authorization: Bearer <token>
  transports: ['websocket'],
});
socket.on('hello', (e) => { /* ready: you are subscribed to your events */ });
socket.on('connect_error', (err) => { /* err.message and err.data.code, see below */ });
```

- Wait for **`hello`** before assuming you are subscribed. After a reconnect, wait for it again, then **refresh state over REST** (events sent while you were away are not replayed).
- The handshake applies the **same checks as REST**: a bad, expired or logged-out token gives `connect_error` with `err.data.code = "UNAUTHENTICATED"`; a suspended account gives `"FORBIDDEN"`. On `UNAUTHENTICATED`, refresh the token over REST and reconnect.
- A user may hold at most 5 connections (several devices). A sixth drops the oldest.
- Reconnect with exponential backoff (1 s, 2 s, 4 s ... capped at 30 s). Don't hammer the server.

### Tokens expire (every 15 min)
Before expiry the server sends **`auth:expired`**. Respond within **30 s** by sending a fresh access token (obtained from `POST /auth/refresh`) on the open socket:

```js
socket.on('auth:expired', async () => {
  const { accessToken } = await refreshTokensOverRest();
  socket.emit('auth:refresh', { token: accessToken }, (ack) => { /* { ok: true } */ });
});
```

If you do nothing, the server disconnects you after the grace period. The token must belong to the same login session.

### Session ended
**`auth:revoked`** `{ reason }` arrives just before the server disconnects you (logout, suspension). Don't auto-reconnect; send the user to login.

## 2. Event envelope
Every event is wrapped so duplicates can be dropped (delivery is at-least-once):

```json
{ "id": "uuid", "type": "booking:status", "at": "2026-10-17T12:30:00.000Z", "data": { } }
```
Keep a short list of recent `id`s and ignore repeats. Ignore unknown event types and unknown fields.

## 3. Events you receive

| Event | Who | `data` |
|---|---|---|
| `hello` | everyone | `{ userId, role, serverTime }` |
| `offer:new` | the offered **driver** | `{ offerId, bookingId, expiresAt }`. Fetch details with `GET /drivers/me/offers`. Contains nothing about the rider. |
| `offer:closed` | the offered driver | `{ offerId, reason }`; `reason` = `EXPIRED` \| `TAKEN` (another driver accepted) \| `CANCELLED` (rider cancelled) \| `WITHDRAWN`. Remove it from the screen. Not sent to the driver who accepted. |
| `booking:status` | the **rider** | `{ bookingId, rideId \| null, status }` for every status change of their booking |
| `ride:status` | the **assigned driver** | `{ bookingId, rideId, status }`, from `DRIVER_ASSIGNED` onward, including `CANCELLED` by the rider |
| `ride:update` | rider and/or driver | `{ bookingId, rideId, kind, ... }` for things that are not a status change: `STOP_ARRIVED` / `STOP_DEPARTED` (`index`, to the rider), `DESTINATION_REQUESTED` (to the driver: `requestId`, `drop`, `estimatedTotalPaise`, `expiresAt`), `DESTINATION_ACCEPTED` / `DESTINATION_DECLINED` (to the rider; accepted also to the driver), `FEE_WAIVED` (to the rider) |
| `driver:location` | the **rider**, only while the ride is active | `{ bookingId, rideId, lat, lng, headingDegrees?, recordedAt }`, at most every 2 s |
| `ops:booking` | staff roles OPS, SUPPORT, SUPER_ADMIN | `{ bookingId, status }` for any booking |
| `ops:sos` | staff in the ops room (SAFETY_ADMIN, OPS, SUPER_ADMIN; SUPPORT also receives it but cannot open incidents) | `{ incidentId, bookingId, kind }`, `kind` = `TRIGGERED` \| `ESCALATED` (nobody acknowledged within 2 minutes; super admins get this one again). Then `GET /admin/incidents/{incidentId}`. |
| `auth:expired`, `auth:revoked` | everyone | see above. A staff member whose role is changed also gets `auth:revoked`: sign in again. |

Statuses are the values in `docs/enums.md`. Unknown future statuses: show "in progress" and refresh over REST.

**Privacy guarantees** (tested): a rider never receives another rider's events; a driver only receives offers made to them and events for their own ride; the driver's position goes to the rider **only from assignment until the ride ends**; no event contains a phone number or the pickup code.

## 4. Events you send

| Event | Who | Payload | Ack |
|---|---|---|---|
| `location:update` | **driver** | same body as `POST /drivers/me/location` (`lat`, `lng`, optional `accuracyMeters`, `headingDegrees`, `speedMetersPerSecond`, `recordedAt`) | `{ ok: true, data: { recordedAt } }` or `{ ok: false, error: { code, message } }` |
| `auth:refresh` | everyone | `{ token }` | `{ ok: true }` or `{ ok: false, error }` |

`location:update` follows exactly the REST rules: send about **every 5 s**; more than one per second returns `RATE_LIMITED`; a poor-accuracy, stale or impossible fix returns `LOCATION_REJECTED`; an offline driver gets `DRIVER_NOT_ELIGIBLE`. Always read the ack. REST and socket location updates are interchangeable; use REST when the socket is down.

The server stores a position only when the driver has moved about 25 m or 10 s have passed, so a parked driver is cheap. You don't need to do anything for this.

## 5. Push notifications (Firebase)

1. After login (and whenever Firebase gives you a new token) call **`POST /devices`** `{ token, platform: "android" | "ios", deviceId, appVersion }`. Send a stable `deviceId` so a rotated token replaces the old one.
2. On logout call **`DELETE /devices/{id}`** (the `id` from step 1), so the next person on this phone doesn't get your pushes.
3. Pushes are also stored: **`GET /notifications`** is the in-app inbox (`meta.unreadCount` is the badge), **`POST /notifications/read`** `{ ids: [...] }` or `{ all: true }` marks read.

Push `data` always contains `type` and `notificationId`, plus `bookingId` / `rideId` / `offerId` where relevant (all strings). Pushes **never** contain phone numbers or the pickup code.

| `type` | To | When |
|---|---|---|
| `offer.new` | driver | a ride request (high priority; dropped if it expires or is taken before it is sent) |
| `ride.assigned`, `ride.arriving`, `ride.arrived`, `ride.started` | rider | each step |
| `ride.completed` | rider and driver | fare; the driver's message says "Collect ₹X in cash" for cash rides |
| `ride.cancelled` | the other party | a driver cancel goes to the rider, a rider cancel to the assigned driver |
| `booking.no_driver` | rider | the search ended with no driver |
| `ride.no_show` | rider and driver | the driver closed the ride as a no-show (the rider's message mentions any fee) |
| `ride.driver_cancelled` | rider | the driver cancelled and we are finding another one (the booking is back to `DISPATCHING`) |
| `ride.destination_requested` | driver | the rider wants another drop-off; answer within 30 s (high priority) |
| `ride.destination_accepted` / `ride.destination_declined` | rider | the driver's answer |
| `booking.fee_waived` | rider | staff waived the fee |
| `document.expiring` / `document.expired` | driver | a required document is about to expire / has expired |

The message wording is a placeholder. Don't build logic on the text; use `type`.

If the app is in the foreground and connected, you will get both the socket event and the push: dedupe on `bookingId` + `status` (or `notificationId`).

## 6. Staff: route trail
`GET /admin/rides/{rideId}/trail` (OPS, SUPPORT, SUPER_ADMIN) returns the sampled route (about one point per 10 s) the driver took during the ride. It is location data, so each read is audited. Points are deleted after 30 days.

## 6b. Safety alerts (Phase 7)
A rider or driver raises `POST /rides/{rideId}/sos` during a live ride. The ride carries on. Staff get the `ops:sos` event and a push (`safety.sos`); the person's saved emergency contacts are texted a trip-follow link. An alert nobody acknowledges is raised again (`ESCALATED`) to super admins. The socket only announces: the alert itself, its status and the driver's live position come from REST (`/admin/incidents/...`, poll `/location`).

## 7. Known limits
- **One server instance.** Live events only reach sockets connected to the same instance. Running several instances needs the Redis adapter (not built yet; the code is ready for it).
- Real push delivery has **not been tested against Firebase** yet (no project). The adapter is covered by unit tests with a fake Firebase.
- Events are not replayed after a disconnect: refresh over REST on every reconnect.
- Emergency-contact texts use the SMS provider; until a real SMS provider is connected they are only logged.
