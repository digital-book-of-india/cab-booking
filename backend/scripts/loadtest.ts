/**
 * Load test for a running server (staging, never production data): many riders sign in, get quotes,
 * book, and hold a live connection at the same time. It measures how the API and the database cope
 * and prints latency percentiles and error counts.
 *
 *   BASE_URL=https://staging.example.com FIXED_OTP=123456 RIDERS=200 npm run loadtest
 *
 * The server must run with STAGING_FIXED_OTP set to FIXED_OTP (so no SMS is needed) and raised rate
 * limits for the test address, otherwise the limits themselves are what gets measured.
 *
 * NOT covered here: drivers. Rides are never accepted, so bookings end in "no driver found". The
 * full-ride version with drivers is `npm run loadtest:rides`.
 */
import { io as connectClient } from 'socket.io-client';
import { createClient } from './loadkit';

export type LoadOptions = {
  baseUrl: string;
  fixedOtp: string;
  riders: number;
  /** Quotes and bookings each rider makes after signing in. */
  roundsPerRider: number;
  /** How many riders are doing things at the same moment. */
  concurrency: number;
  /** Open a live connection for each rider and keep it for the whole run. */
  sockets: boolean;
};

export type LoadReport = {
  durationMs: number;
  riders: number;
  requests: number;
  errors: number;
  errorRate: number;
  byEndpoint: ReturnType<ReturnType<typeof createClient>['summary']>;
  sockets: { opened: number; failed: number };
};

/** A valid, unique-per-run Indian mobile number for person `n` (up to 999 per kind per run). */
export const loadPhone = (stamp: number, kind: number, n: number) =>
  `+919${kind}${String(stamp % 100_000).padStart(5, '0')}${String(n).padStart(3, '0')}`;

export async function runLoad(opts: LoadOptions): Promise<LoadReport> {
  const c = createClient(opts.baseUrl);
  const started = Date.now();
  const sockets: ReturnType<typeof connectClient>[] = [];
  let socketsFailed = 0;

  const cats = await c.timed('GET /cab-categories', '/cab-categories');
  const categoryId = (cats.body?.data as { id?: string }[] | undefined)?.[0]?.id;
  if (!categoryId) throw new Error('No cab category found: is the server seeded?');

  const stamp = Date.now();
  async function rider(n: number) {
    const token = await c.login(loadPhone(stamp, 3, n), opts.fixedOtp, 'CUSTOMER');
    if (!token) return;

    if (opts.sockets) {
      await new Promise<void>((resolve) => {
        const s = connectClient(opts.baseUrl, {
          auth: { token },
          reconnection: false,
          transports: ['websocket'],
        });
        s.once('hello', () => {
          sockets.push(s);
          resolve();
        });
        s.once('connect_error', () => {
          socketsFailed += 1;
          resolve();
        });
      });
    }

    for (let round = 0; round < opts.roundsPerRider; round += 1) {
      const quote = await c.timed(
        'POST /fare-quotes',
        '/fare-quotes',
        c.post(
          {
            pickup: { lat: 28.6315, lng: 77.2167 },
            drop: { lat: 28.5562, lng: 77.1 },
            categoryId,
          },
          token,
        ),
      );
      const quoteId = (quote.body?.data as Record<string, unknown> | undefined)?.['quoteId'];
      if (!quoteId) continue;
      const booking = await c.timed(
        'POST /bookings',
        '/bookings',
        c.post({ quoteId, paymentMethod: 'CASH' }, token, `load-${stamp}-${n}-${round}`),
      );
      const bookingId = (booking.body?.data as Record<string, unknown> | undefined)?.[
        'bookingId'
      ] as string | undefined;
      if (bookingId) {
        await c.timed('GET /bookings/{id}', `/bookings/${bookingId}`, c.get(token));
        await c.timed(
          'POST /bookings/{id}/cancel',
          `/bookings/${bookingId}/cancel`,
          c.post({ reasonCode: 'CHANGED_MIND' }, token),
        );
      }
    }
  }

  // A simple worker pool: `concurrency` riders at a time.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, opts.riders) }, async () => {
      while (next < opts.riders) {
        const n = next;
        next += 1;
        await rider(n);
      }
    }),
  );
  sockets.forEach((s) => s.close());

  return {
    durationMs: Date.now() - started,
    riders: opts.riders,
    requests: c.samples.length,
    errors: c.errors(),
    errorRate: c.samples.length ? c.errors() / c.samples.length : 0,
    byEndpoint: c.summary(),
    sockets: { opened: sockets.length, failed: socketsFailed },
  };
}

if (process.argv[1] && /loadtest\.(ts|js)$/.test(process.argv[1])) {
  const baseUrl = process.env['BASE_URL'];
  const fixedOtp = process.env['FIXED_OTP'];
  if (!baseUrl || !fixedOtp) {
    console.error('Set BASE_URL and FIXED_OTP (see the comment at the top of this file).');
    process.exit(1);
  }
  runLoad({
    baseUrl: baseUrl.replace(/\/$/, ''),
    fixedOtp,
    riders: Number(process.env['RIDERS'] ?? 50),
    roundsPerRider: Number(process.env['ROUNDS'] ?? 3),
    concurrency: Number(process.env['CONCURRENCY'] ?? 20),
    sockets: process.env['SOCKETS'] !== 'false',
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
