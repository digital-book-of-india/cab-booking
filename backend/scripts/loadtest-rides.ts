/**
 * Full-ride load test for a running STAGING server: approved drivers send locations and answer
 * offers, riders book, and every ride is driven to completion. It measures what the rider-only
 * script cannot: time to find a driver, offer acceptance, location-update load, and rides finished.
 *
 *   BASE_URL=https://staging.example.com FIXED_OTP=123456 ADMIN_PHONE=+91XXXXXXXXXX \
 *   DRIVERS=20 RIDERS=30 DURATION_SECONDS=120 npm run loadtest:rides
 *
 * Needs: the server running with STAGING_FIXED_OTP=FIXED_OTP and raised rate limits for this machine,
 * seeded zones/categories, and a staff account (SUPER_ADMIN or OPS) at ADMIN_PHONE that can sign in
 * with the fixed OTP (create it with the seed). Never run against production.
 */
import { io as connectClient } from 'socket.io-client';
import { createClient, distribution, sleep } from './loadkit';
import { loadPhone } from './loadtest';

export type RideLoadOptions = {
  baseUrl: string;
  fixedOtp: string;
  adminPhone: string;
  drivers: number;
  riders: number;
  durationSeconds: number;
  /** Time between a driver's location updates. */
  locationIntervalMs: number;
  /** Time between a driver's checks for new offers (a real app gets a socket event instead). */
  offerPollMs: number;
};

export type RideLoadReport = {
  durationMs: number;
  drivers: { requested: number; online: number };
  rides: { booked: number; assigned: number; completed: number; noDriver: number };
  secondsToAssign: ReturnType<typeof distribution>;
  locationUpdates: number;
  requests: number;
  errors: number;
  errorRate: number;
  byEndpoint: ReturnType<ReturnType<typeof createClient>['summary']>;
};

const CP = { lat: 28.6315, lng: 77.2167 };
const IGI = { lat: 28.5562, lng: 77.1 };

export async function runRideLoad(opts: RideLoadOptions): Promise<RideLoadReport> {
  const c = createClient(opts.baseUrl);
  const started = Date.now();
  const deadline = started + opts.durationSeconds * 1000;
  const stamp = Date.now();
  const uniquePhone = (kind: number, n: number) => loadPhone(stamp, kind, n);

  const staffLogin = await c.login(opts.adminPhone, opts.fixedOtp);
  if (!staffLogin)
    throw new Error('Could not sign in the staff account (ADMIN_PHONE / FIXED_OTP).');
  const adminToken: string = staffLogin;

  const cats = await c.timed('GET /cab-categories', '/cab-categories');
  const categoryId = (cats.body?.data as { id?: string }[] | undefined)?.[0]?.id;
  if (!categoryId) throw new Error('No cab category found: is the server seeded?');

  /* ---------- 1. set up approved, online drivers through the real staff API ---------- */
  type Driver = { token: string; vehicleId: string; userId: string };
  const drivers: Driver[] = [];
  async function setupDriver(n: number) {
    const token = await c.login(uniquePhone(7, n), opts.fixedOtp, 'DRIVER');
    if (!token) return;
    const me = await c.timed('GET /auth/me', '/auth/me', c.get(token));
    const userId = (me.body?.data as Record<string, unknown> | undefined)?.['id'] as string;
    await c.timed(
      'POST /drivers/applications',
      '/drivers/applications',
      c.post({ fullName: `Load Driver ${n}`, city: 'Delhi' }, token),
    );
    // The staff list finds the driver profile id for this user.
    const found = await c.timed(
      'GET /admin/drivers',
      `/admin/drivers?q=Load%20Driver%20${n}&limit=5`,
      c.get(adminToken),
    );
    const profile = (
      found.body?.data as { id?: string; driverId?: string; userId?: string }[] | undefined
    )?.find((d) => d.userId === userId || d.userId === undefined);
    const driverId = profile?.id ?? profile?.driverId;
    if (!driverId) return;
    for (const type of ['DRIVING_LICENCE', 'VEHICLE_RC', 'INSURANCE', 'ID_PROOF']) {
      const doc = await c.timed(
        'POST /drivers/me/documents',
        '/drivers/me/documents',
        c.post(
          {
            type,
            documentNumberLast4: '1234',
            expiresAt: '2030-01-01T00:00:00.000Z',
            contentType: 'image/jpeg',
          },
          token,
        ),
      );
      const documentId = (
        (doc.body?.data as Record<string, unknown> | undefined)?.['document'] as
          Record<string, unknown> | undefined
      )?.['id'];
      if (documentId) {
        await c.timed(
          'PATCH /admin/drivers/{id}/documents/{id}',
          `/admin/drivers/${driverId}/documents/${documentId}`,
          c.patch({ status: 'APPROVED' }, adminToken),
        );
      }
    }
    await c.timed(
      'PATCH /admin/drivers/{id}/approval',
      `/admin/drivers/${driverId}/approval`,
      c.patch({ decision: 'APPROVE' }, adminToken),
    );
    const vehicle = await c.timed(
      'POST /drivers/me/vehicles',
      '/drivers/me/vehicles',
      c.post(
        {
          categoryId,
          registrationNumber: `DL${String(stamp).slice(-4)}LD${String(n).padStart(4, '0')}`,
          make: 'Maruti',
          model: 'Dzire',
          color: 'White',
          seats: 4,
        },
        token,
      ),
    );
    const vehicleId = (vehicle.body?.data as Record<string, unknown> | undefined)?.['id'] as
      string | undefined;
    if (!vehicleId) return;
    await c.timed(
      'PATCH /admin/vehicles/{id}/verification',
      `/admin/vehicles/${vehicleId}/verification`,
      c.patch({ status: 'VERIFIED' }, adminToken),
    );
    const online = await c.timed(
      'POST /drivers/me/presence',
      '/drivers/me/presence',
      c.post(
        { status: 'ONLINE', vehicleId, location: { lat: CP.lat + (n % 5) * 0.001, lng: CP.lng } },
        token,
      ),
    );
    if (online.status === 200) drivers.push({ token, vehicleId, userId });
  }
  const setupQueue = Array.from({ length: opts.drivers }, (_, n) => n);
  await Promise.all(
    Array.from({ length: Math.min(5, opts.drivers) }, async () => {
      for (let n = setupQueue.shift(); n !== undefined; n = setupQueue.shift())
        await setupDriver(n);
    }),
  );

  /* ---------- 2. the run ---------- */
  const otps = new Map<string, string>(); // rideId -> pickup code, handed from rider to driver
  const toAssign: number[] = [];
  const stats = { booked: 0, assigned: 0, completed: 0, noDriver: 0, locations: 0 };
  const sockets: ReturnType<typeof connectClient>[] = [];

  async function driverLoop(d: Driver, index: number) {
    let lastLocation = 0;
    const at = { lat: CP.lat + (index % 5) * 0.001, lng: CP.lng };
    while (Date.now() < deadline) {
      if (Date.now() - lastLocation >= opts.locationIntervalMs) {
        lastLocation = Date.now();
        const r = await c.timed(
          'POST /drivers/me/location',
          '/drivers/me/location',
          c.post({ ...at, accuracyMeters: 8 }, d.token),
        );
        if (r.status === 200) stats.locations += 1;
      }
      const offers = await c.timed('GET /drivers/me/offers', '/drivers/me/offers', c.get(d.token));
      const offer = (offers.body?.data as { offerId: string }[] | undefined)?.[0];
      if (offer) {
        const accepted = await c.timed(
          'POST /ride-offers/{id}/accept',
          `/ride-offers/${offer.offerId}/accept`,
          c.post({}, d.token),
        );
        const rideId = (accepted.body?.data as Record<string, unknown> | undefined)?.['rideId'] as
          string | undefined;
        if (accepted.status === 200 && rideId) {
          await c.timed(
            'POST /rides/{id}/en-route',
            `/rides/${rideId}/en-route`,
            c.post({}, d.token),
          );
          await c.timed(
            'POST /drivers/me/location',
            '/drivers/me/location',
            c.post({ ...CP, accuracyMeters: 5 }, d.token),
          );
          await c.timed(
            'POST /rides/{id}/arrived',
            `/rides/${rideId}/arrived`,
            c.post({}, d.token),
          );
          for (let i = 0; i < 100 && !otps.has(rideId) && Date.now() < deadline + 20_000; i += 1)
            await sleep(100);
          const otp = otps.get(rideId);
          if (otp) {
            const start = await c.timed(
              'POST /rides/{id}/start',
              `/rides/${rideId}/start`,
              c.post({ pickupOtp: otp }, d.token),
            );
            if (start.status === 200) {
              const done = await c.timed(
                'POST /rides/{id}/complete',
                `/rides/${rideId}/complete`,
                c.post({}, d.token),
              );
              if (done.status === 200) stats.completed += 1;
            }
          }
        }
      }
      await sleep(opts.offerPollMs);
    }
  }

  async function riderLoop(n: number) {
    const token = await c.login(uniquePhone(5, n), opts.fixedOtp, 'CUSTOMER');
    if (!token) return;
    const s = connectClient(opts.baseUrl, {
      auth: { token },
      reconnection: false,
      transports: ['websocket'],
    });
    s.on('connect_error', () => undefined);
    sockets.push(s);
    while (Date.now() < deadline - 5000) {
      const q = await c.timed(
        'POST /fare-quotes',
        '/fare-quotes',
        c.post({ pickup: CP, drop: IGI, categoryId }, token),
      );
      const quoteId = (q.body?.data as Record<string, unknown> | undefined)?.['quoteId'];
      if (!quoteId) break;
      const b = await c.timed(
        'POST /bookings',
        '/bookings',
        c.post({ quoteId, paymentMethod: 'CASH' }, token, `ride-${stamp}-${n}-${Date.now()}`),
      );
      const bookingId = (b.body?.data as Record<string, unknown> | undefined)?.['bookingId'] as
        string | undefined;
      if (!bookingId) break;
      stats.booked += 1;
      const t0 = Date.now();
      let rideId: string | undefined;
      let settled = false;
      while (!settled && Date.now() < deadline + 20_000) {
        await sleep(500);
        const view = await c.timed('GET /bookings/{id}', `/bookings/${bookingId}`, c.get(token));
        const data = view.body?.data as Record<string, unknown> | undefined;
        const status = data?.['status'] as string | undefined;
        if (status === 'NO_DRIVER_FOUND') {
          stats.noDriver += 1;
          settled = true;
        } else if (
          status &&
          status !== 'REQUESTED' &&
          status !== 'DISPATCHING' &&
          data?.['rideId']
        ) {
          rideId = data['rideId'] as string;
          settled = true;
        }
      }
      if (!rideId) continue;
      stats.assigned += 1;
      toAssign.push((Date.now() - t0) / 1000);
      const code = await c.timed(
        'GET /rides/{id}/pickup-otp',
        `/rides/${rideId}/pickup-otp`,
        c.get(token),
      );
      const otp = (code.body?.data as Record<string, unknown> | undefined)?.['pickupOtp'] as
        string | undefined;
      if (otp) otps.set(rideId, otp);
      // wait for the driver to finish before the next booking
      for (let i = 0; i < 200 && Date.now() < deadline + 20_000; i += 1) {
        await sleep(500);
        const view = await c.timed('GET /rides/{id}', `/rides/${rideId}`, c.get(token));
        const status = (view.body?.data as Record<string, unknown> | undefined)?.['status'];
        if (status === 'COMPLETED' || status === 'CANCELLED') break;
      }
    }
  }

  await Promise.all([
    ...drivers.map((d, i) => driverLoop(d, i)),
    ...Array.from({ length: opts.riders }, (_, n) => riderLoop(n)),
  ]);
  sockets.forEach((s) => s.close());

  return {
    durationMs: Date.now() - started,
    drivers: { requested: opts.drivers, online: drivers.length },
    rides: {
      booked: stats.booked,
      assigned: stats.assigned,
      completed: stats.completed,
      noDriver: stats.noDriver,
    },
    secondsToAssign: distribution(toAssign),
    locationUpdates: stats.locations,
    requests: c.samples.length,
    errors: c.errors(),
    errorRate: c.samples.length ? c.errors() / c.samples.length : 0,
    byEndpoint: c.summary(),
  };
}

if (process.argv[1] && /loadtest-rides\.(ts|js)$/.test(process.argv[1])) {
  const { BASE_URL, FIXED_OTP, ADMIN_PHONE } = process.env;
  if (!BASE_URL || !FIXED_OTP || !ADMIN_PHONE) {
    console.error(
      'Set BASE_URL, FIXED_OTP and ADMIN_PHONE (see the comment at the top of this file).',
    );
    process.exit(1);
  }
  runRideLoad({
    baseUrl: BASE_URL.replace(/\/$/, ''),
    fixedOtp: FIXED_OTP,
    adminPhone: ADMIN_PHONE,
    drivers: Number(process.env['DRIVERS'] ?? 10),
    riders: Number(process.env['RIDERS'] ?? 10),
    durationSeconds: Number(process.env['DURATION_SECONDS'] ?? 60),
    locationIntervalMs: Number(process.env['LOCATION_INTERVAL_MS'] ?? 3000),
    offerPollMs: Number(process.env['OFFER_POLL_MS'] ?? 1500),
  })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.errorRate > 0.01 ? 2 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
