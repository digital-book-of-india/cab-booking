import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { Refund } from '../src/modules/payments/refund.model';
import {
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  startRide,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let customer: Session;
beforeAll(async () => {
  env = await startTestEnv(
    {},
    { devPayments: true, financeConfig: { rideTaxBp: 500, commissionTaxBp: 1800 } },
  );
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  env.razorpay.orders.length = 0;
  env.razorpay.refundRequests.length = 0;
  env.razorpay.refundStatus = 'pending';
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
const balanceOf = async (account: string) => (await ledger().balances([account]))[account]!;
let keyN = 0;
const idem = () => `gk-${Date.now()}-${++keyN}`;

async function paidOnline() {
  const driver = await createDriver(env, world);
  const booking = await requestRide(env, world, customer, { paymentMethod: 'ONLINE' });
  const rideId = await assignTo(env, driver);
  await startRide(env, customer, driver, rideId);
  const done = await rideCall(env, driver, rideId, 'complete');
  expect(done.status).toBe(200);
  const fare = done.body.data.finalFarePaise as number;
  const pay = await api()
    .post(`/api/v1/bookings/${booking.bookingId}/payments`)
    .set(customer.auth)
    .set('Idempotency-Key', idem())
    .send({});
  await env.razorpay.webhook(env.razorpay.captured(pay.body.data.orderId, 'pay_g1', fare));
  const tax = (await Booking.findOne({ publicId: booking.bookingId }).lean())!.taxPaise ?? 0;
  return { booking, fare, tax };
}
const refund = (who: Session, bookingId: string, amountPaise: number) =>
  api()
    .post(`/api/v1/admin/bookings/${bookingId}/refund`)
    .set(who.auth)
    .set('Idempotency-Key', idem())
    .send({ amountPaise, reason: 'Wrong route taken' });
const processed = (id: string) => ({
  event: 'refund.processed',
  payload: { refund: { entity: { id } } },
});

describe('a refund hands the ride GST back in proportion', () => {
  it('returns the refunded share of the tax from the tax account, and all of it by the last refund', async () => {
    const { booking, fare, tax } = await paidOnline();
    expect(tax).toBeGreaterThan(0);
    expect(await balanceOf('TAX_PAYABLE')).toBe(
      -(tax + Math.round(Math.round(((fare - tax) * 20) / 100) * 0.18)),
    );
    const taxHeld = await balanceOf('TAX_PAYABLE');
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');

    const part = Math.floor(fare / 3);
    expect((await refund(fin, booking.bookingId, part)).status).toBe(201);
    await env.razorpay.webhook(processed('rfnd_test_1'));
    const back1 = Math.round((part * tax) / fare);
    expect(await balanceOf('TAX_PAYABLE')).toBe(taxHeld + back1);
    expect(await balanceOf('REFUNDS')).toBe(part - back1);

    expect((await refund(fin, booking.bookingId, fare - part)).status).toBe(201);
    await env.razorpay.webhook(processed('rfnd_test_2'));
    // The refunds together reverse exactly the tax that was charged on the ride, never more.
    const reversed = (await Refund.find().lean()).reduce(
      (n, r) => n + (r.taxReversedPaise ?? 0),
      0,
    );
    expect(reversed).toBe(tax);
    expect(await balanceOf('TAX_PAYABLE')).toBe(taxHeld + tax);
    expect(await balanceOf('REFUNDS')).toBe(fare - tax);
    expect(await balanceOf('GATEWAY')).toBe(0);

    // Every entry balances, and the books as a whole are still consistent.
    for (const t of await LedgerTransaction.find({ kind: 'REFUND' }).lean()) {
      expect(t.entries.reduce((n, e) => n + e.amountPaise, 0)).toBe(0);
    }
    const check = await api().get('/api/v1/admin/finance/consistency').set(fin.auth);
    expect(check.body.data.ok).toBe(true);
  });

  it('is fixed when first worked out: a repeated confirmation posts nothing new', async () => {
    const { booking, fare } = await paidOnline();
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    await refund(fin, booking.bookingId, fare);
    await env.razorpay.webhook(processed('rfnd_test_1'));
    const before = await LedgerTransaction.countDocuments({ kind: 'REFUND' });
    const stored = (await Refund.findOne().lean())!.taxReversedPaise;
    await env.razorpay.webhook(processed('rfnd_test_1'));
    expect(await LedgerTransaction.countDocuments({ kind: 'REFUND' })).toBe(before);
    expect((await Refund.findOne().lean())!.taxReversedPaise).toBe(stored);
  });

  it('reports show the tax apart from the fare: gross includes it, net does not', async () => {
    const { fare, tax } = await paidOnline();
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const rev = (await api().get('/api/v1/admin/analytics/revenue').set(fin.auth)).body.data;
    expect(rev.totals).toMatchObject({
      grossFaresPaise: fare,
      taxPaise: tax,
      netFaresPaise: fare - tax,
    });
    expect(rev.perDay[0]).toMatchObject({ taxPaise: tax, netFaresPaise: fare - tax });
    const sum = (await api().get('/api/v1/admin/reports/summary').set(fin.auth)).body.data;
    expect(sum.money).toMatchObject({
      grossFaresPaise: fare,
      taxPaise: tax,
      netFaresPaise: fare - tax,
    });
  });
});
