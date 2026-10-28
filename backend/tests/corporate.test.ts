import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { Invoice } from '../src/modules/corporate/corporate.models';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import type { MonitorService } from '../src/modules/monitoring/monitor.service';
import { Notification } from '../src/modules/notifications/notification.model';
import { User } from '../src/modules/users/user.model';
import {
  CP,
  IGI,
  NEAR_CP,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  rideCall,
  seedWorld,
  startRide,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let fin: Session;
let boss: Session; // the company admin (an ordinary rider)
let asha: Session; // an employee
let driver: TestDriver;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
  boss = await loginAs(env, nextPhone(), 'CUSTOMER');
  asha = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
const phoneOf = async (s: Session) => (await User.findById(s.userId))!.phone;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;
const HOUR = 3_600_000;

async function createCompany(body: object = {}) {
  const res = await api()
    .post('/api/v1/admin/corporate')
    .set(fin.auth)
    .send({
      name: 'Acme Travels',
      billingEmail: 'accounts@acme.example',
      adminPhone: await phoneOf(boss),
      adminName: 'Boss',
      ...body,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { companyId: string; firstAdmin: { membershipId: string } };
}
const accept = (who: Session, membershipId: string) =>
  api().post(`/api/v1/corporate/invitations/${membershipId}/accept`).set(who.auth).send({});
const invite = (body: object) =>
  api().post('/api/v1/corporate/employees').set(boss.auth).send(body);

/** A company with an admin (boss) and one employee (asha), both accepted. */
async function setup(companyBody: object = {}, employeeBody: object = {}) {
  const company = await createCompany(companyBody);
  expect((await accept(boss, company.firstAdmin.membershipId)).status).toBe(200);
  const inv = await invite({ phone: await phoneOf(asha), name: 'Asha', ...employeeBody });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  expect((await accept(asha, inv.body.data.membershipId)).status).toBe(200);
  return { company, employeeMembership: inv.body.data.membershipId as string };
}

const quote = (who: Session, extra: object = {}) =>
  api()
    .post('/api/v1/fare-quotes')
    .set(who.auth)
    .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'], ...extra });
const book = async (who: Session, body: object = {}) => {
  const q = await quote(who);
  return api()
    .post('/api/v1/bookings')
    .set(who.auth)
    .set('Idempotency-Key', idem())
    .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CORPORATE', ...body });
};
/** Book on the company account and drive the ride to completion. */
async function corporateRide(who: Session, reference?: string) {
  const b = await book(who, reference ? { corporateReference: reference } : {});
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  const rideId = await assignTo(env, driver);
  await startRide(env, who, driver, rideId);
  const done = await rideCall(env, driver, rideId, 'complete');
  expect(done.status).toBe(200);
  return {
    bookingId: b.body.data.bookingId as string,
    rideId,
    fare: done.body.data.finalFarePaise as number,
  };
}
const books = async () =>
  expect(await ledger().checkBalance()).toEqual({
    ledgerTotalPaise: 0,
    unbalancedTransactions: [],
    completedRidesWithoutAccrual: 0,
  });
const patchCompany = (id: string, body: object) =>
  api().patch(`/api/v1/admin/corporate/${id}`).set(fin.auth).send(body);
const generate = (companyId: string) =>
  api()
    .post(`/api/v1/admin/corporate/${companyId}/invoices`)
    .set(fin.auth)
    .send({
      from: new Date(Date.now() - 24 * HOUR).toISOString(),
      to: new Date(Date.now() + 24 * HOUR).toISOString(),
    });

describe('joining a company account', () => {
  it('finance creates the company, the admin and employees accept, and one person is in one company', async () => {
    const company = await createCompany();
    const me = await api().get('/api/v1/corporate/me').set(boss.auth);
    expect(me.body.data.current).toBeNull();
    expect(me.body.data.invitations).toEqual([
      { membershipId: company.firstAdmin.membershipId, companyName: 'Acme Travels', role: 'ADMIN' },
    ]);
    expect(await Notification.countDocuments({ type: 'corporate.invited' })).toBe(1);
    await accept(boss, company.firstAdmin.membershipId);

    const mine = (await api().get('/api/v1/corporate/me').set(boss.auth)).body.data;
    expect(mine.current.company).toMatchObject({
      name: 'Acme Travels',
      creditLimitPaise: 5_000_000,
      paymentTermsDays: 15,
    });
    expect(mine.current.membership).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });

    const inv = await invite({
      phone: await phoneOf(asha),
      name: 'Asha',
      monthlyLimitPaise: 500_000,
    });
    expect(inv.body.data).toMatchObject({
      status: 'INVITED',
      monthlyLimitPaise: 500_000,
      usesCompanyDefault: false,
    });
    expect((await invite({ phone: await phoneOf(asha) })).status).toBe(409); // already invited
    await accept(asha, inv.body.data.membershipId);
    const list = (await api().get('/api/v1/corporate/employees').set(boss.auth)).body.data;
    expect(list).toHaveLength(2);

    // A second company cannot take Asha while she is in the first.
    const second = await createCompany({ name: 'Other Co', adminPhone: await phoneOf(asha) });
    const clash = await accept(asha, second.firstAdmin.membershipId);
    expect(clash.status).toBe(409);
  });

  it('keeps employees out of admin actions, and invitations for people without an account work later', async () => {
    const { employeeMembership } = await setup();
    expect((await api().get('/api/v1/corporate/employees').set(asha.auth)).status).toBe(403);
    expect(
      (
        await api()
          .post('/api/v1/corporate/employees')
          .set(asha.auth)
          .send({ phone: '+919812300009' })
      ).status,
    ).toBe(403);
    const later = await invite({ phone: '+919876500777' });
    expect(later.status).toBe(201);
    const newcomer = await loginAs(env, '+919876500777', 'CUSTOMER');
    expect(
      (await api().get('/api/v1/corporate/me').set(newcomer.auth)).body.data.invitations,
    ).toHaveLength(1);
    // Only the invited phone can accept.
    expect((await accept(asha, later.body.data.membershipId)).status).toBe(404);
    expect((await accept(newcomer, later.body.data.membershipId)).status).toBe(200);
    // Removing, and the admin cannot remove themselves.
    const removed = await api()
      .patch(`/api/v1/corporate/employees/${employeeMembership}`)
      .set(boss.auth)
      .send({ status: 'REMOVED' });
    expect(removed.body.data.status).toBe('REMOVED');
    const mineId = (await api().get('/api/v1/corporate/employees').set(boss.auth)).body.data.find(
      (m: { role: string }) => m.role === 'ADMIN',
    ).membershipId;
    expect(
      (
        await api()
          .patch(`/api/v1/corporate/employees/${mineId}`)
          .set(boss.auth)
          .send({ status: 'REMOVED' })
      ).status,
    ).toBe(422);
    expect((await book(asha)).body.error.code).toBe('CORPORATE_NOT_ALLOWED'); // no longer on the account
  });

  it('only finance creates companies', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api()
      .post('/api/v1/admin/corporate')
      .set(ops.auth)
      .send({ name: 'X Co', billingEmail: 'a@b.co', adminPhone: '+919812300001' });
    expect(res.status).toBe(403);
    expect((await api().get('/api/v1/admin/corporate').set(ops.auth)).status).toBe(200); // looking is fine
    expect((await api().get('/api/v1/admin/corporate/accounts').set(ops.auth)).status).toBe(200);
  });
});

describe('booking on the company account', () => {
  it('works for a member, records the reference, and refuses everyone and everything outside the rules', async () => {
    const { company } = await setup();
    const ok = await book(asha, { corporateReference: 'PROJ-42' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toMatchObject({
      paymentMethod: 'CORPORATE',
      billedToCompany: true,
      corporateReference: 'PROJ-42',
    });

    const outsider = await loginAs(env, nextPhone(), 'CUSTOMER');
    const no = await book(outsider);
    expect(no.status).toBe(403);
    expect(no.body.error.code).toBe('CORPORATE_NOT_ALLOWED');
    expect((await book(outsider, { paymentMethod: 'CASH', corporateReference: 'X' })).status).toBe(
      422,
    );

    await patchCompany(company.companyId, { status: 'SUSPENDED' });
    expect((await book(asha)).body.error.code).toBe('CORPORATE_NOT_ALLOWED'); // suspended at once
    await patchCompany(company.companyId, { status: 'ACTIVE' });

    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api()
      .put('/api/v1/admin/feature-flags/CORPORATE')
      .set(config.auth)
      .send({ enabled: false });
    expect((await book(asha)).body.error.code).toBe('FEATURE_DISABLED');
  });

  it('refuses a ride over the per-ride cap, the employee monthly limit, or the company credit limit', async () => {
    const { company, employeeMembership } = await setup();
    // 1. per-ride cap
    await patchCompany(company.companyId, { perRideCapPaise: 1000 });
    const cap = await book(asha);
    expect(cap.status).toBe(422);
    expect(cap.body.error.code).toBe('CORPORATE_LIMIT_EXCEEDED');
    expect(cap.body.error.fieldErrors[0].message).toMatch(/at most/);
    await patchCompany(company.companyId, { perRideCapPaise: null });

    // 2. the employee's own monthly limit: one ride fits, the second does not
    await api()
      .patch(`/api/v1/corporate/employees/${employeeMembership}`)
      .set(boss.auth)
      .send({ monthlyLimitPaise: 50_000 });
    expect((await book(asha)).status).toBe(201);
    const second = await book(asha);
    expect(second.status).toBe(422);
    expect(second.body.error.fieldErrors[0].message).toMatch(/monthly limit/);
    await api()
      .patch(`/api/v1/corporate/employees/${employeeMembership}`)
      .set(boss.auth)
      .send({ monthlyLimitPaise: null });

    // 3. the company credit limit counts rides still to be billed
    await patchCompany(company.companyId, { creditLimitPaise: 50_000 });
    const credit = await book(asha);
    expect(credit.status).toBe(422);
    expect(credit.body.error.fieldErrors[0].message).toMatch(/credit limit/);
  });

  it('does not allow a coupon on a company ride', async () => {
    await setup();
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api()
      .post('/api/v1/admin/coupons')
      .set(config.auth)
      .send({
        code: 'CORP5',
        type: 'FLAT',
        value: 1000,
        validFrom: new Date(Date.now() - HOUR).toISOString(),
        validTo: new Date(Date.now() + 24 * HOUR).toISOString(),
      });
    const q = await quote(asha, { couponCode: 'CORP5' });
    const res = await api()
      .post('/api/v1/bookings')
      .set(asha.auth)
      .set('Idempotency-Key', idem())
      .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CORPORATE' });
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors[0].message).toMatch(/Coupons cannot/);
  });
});

describe('the money on a company ride', () => {
  it('is owed by the company, never asked of the rider, never taken in cash, and the books balance', async () => {
    const { company } = await setup();
    const ride = await corporateRide(asha, 'PROJ-1');
    const b = (await Booking.findOne({ publicId: ride.bookingId }))!;
    expect(b.paymentStatus).toBe('BILLED');

    // The rider owes nothing and cannot pay or hand over cash.
    expect(
      (await api().get('/api/v1/customers/me/balance').set(asha.auth)).body.data.unpaidPaise,
    ).toBe(0);
    const pay = await api()
      .post(`/api/v1/bookings/${ride.bookingId}/payments`)
      .set(asha.auth)
      .set('Idempotency-Key', idem())
      .send({});
    expect(pay.status).toBe(409);
    const cash = await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    expect(cash.status).toBe(409);

    // The company owes the fare; the driver and the commission are worked out as usual.
    const account = `CORPORATE_RECEIVABLE:${(await Booking.findOne({ publicId: ride.bookingId }))!.corporateId}`;
    expect((await ledger().balances([account]))[account]).toBe(ride.fare);
    const commission = Math.round(ride.fare * 0.2);
    expect((await ledger().driverPosition(driver.driverId)).payablePaise).toBe(
      ride.fare - commission,
    );
    const detail = (await api().get(`/api/v1/admin/corporate/${company.companyId}`).set(fin.auth))
      .body.data;
    expect(detail.exposure).toMatchObject({
      owedPaise: ride.fare,
      openRidesPaise: 0,
      invoicedUnpaidPaise: 0,
    });
    expect(detail.activeEmployees).toBe(2);

    // The company admin sees the ride with its reference.
    const rides = (await api().get('/api/v1/corporate/rides').set(boss.auth)).body.data;
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({
      bookingId: ride.bookingId,
      reference: 'PROJ-1',
      amountPaise: ride.fare,
      invoiced: false,
    });
    expect((await api().get('/api/v1/corporate/rides').set(asha.auth)).status).toBe(403);
    await books();
  });
});

describe('invoices and payments', () => {
  it('bills the rides once, numbers the invoice on issue, takes part and full payments, and clears what is owed', async () => {
    const { company } = await setup();
    const ride = await corporateRide(asha, 'PROJ-1');

    const draft = await generate(company.companyId);
    expect(draft.status).toBe(201);
    expect(draft.body.data).toMatchObject({
      status: 'DRAFT',
      number: null,
      totalPaise: ride.fare,
      lineCount: 1,
      taxPaise: 0,
    });
    expect(draft.body.data.lines[0]).toMatchObject({
      bookingId: ride.bookingId,
      reference: 'PROJ-1',
      amountPaise: ride.fare,
    });
    expect((await generate(company.companyId)).status).toBe(422); // already billed on the draft
    const id = draft.body.data.invoiceId as string;

    // The company cannot see a draft; once issued it can.
    expect((await api().get(`/api/v1/corporate/invoices/${id}`).set(boss.auth)).status).toBe(404);
    const issued = await api()
      .post(`/api/v1/admin/corporate-invoices/${id}/issue`)
      .set(fin.auth)
      .send({});
    expect(issued.body.data.status).toBe('ISSUED');
    expect(issued.body.data.number).toMatch(/^CI-\d{4}-000001$/);
    const days =
      (new Date(issued.body.data.dueAt).getTime() - new Date(issued.body.data.issuedAt).getTime()) /
      (24 * HOUR);
    expect(days).toBe(15);
    expect(
      (await api().post(`/api/v1/admin/corporate-invoices/${id}/issue`).set(fin.auth).send({}))
        .status,
    ).toBe(409);
    expect(
      (await api().get(`/api/v1/corporate/invoices/${id}`).set(boss.auth)).body.data.lines,
    ).toHaveLength(1);
    expect((await api().get('/api/v1/corporate/invoices').set(asha.auth)).status).toBe(403);

    // Part payment, the same request again, too much, then the rest.
    const part = Math.floor(ride.fare / 2);
    const pay = (amountPaise: number, key: string, reference = 'NEFT 111') =>
      api()
        .post(`/api/v1/admin/corporate-invoices/${id}/payments`)
        .set(fin.auth)
        .set('Idempotency-Key', key)
        .send({ amountPaise, reference });
    const k1 = idem();
    const first = await pay(part, k1);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      status: 'ISSUED',
      paidPaise: part,
      balancePaise: ride.fare - part,
    });
    expect((await pay(part, k1)).body.data.paidPaise).toBe(part); // not recorded twice
    expect((await pay(ride.fare, idem())).status).toBe(422); // more than is left
    const last = await pay(ride.fare - part, idem(), 'NEFT 222');
    expect(last.body.data).toMatchObject({ status: 'PAID', balancePaise: 0 });

    const account = `CORPORATE_RECEIVABLE:${(await Booking.findOne({ publicId: ride.bookingId }))!.corporateId}`;
    expect((await ledger().balances([account]))[account]).toBe(0); // nothing owed any more
    expect((await ledger().balances(['PLATFORM_BANK']))['PLATFORM_BANK']).toBe(ride.fare);
    expect(
      (await api().post(`/api/v1/admin/corporate-invoices/${id}/void`).set(fin.auth).send({}))
        .status,
    ).toBe(409); // paid
    await books();
  });

  it('a voided invoice frees its rides for a new one', async () => {
    const { company } = await setup();
    await corporateRide(asha);
    const first = await generate(company.companyId);
    const id = first.body.data.invoiceId as string;
    await api().post(`/api/v1/admin/corporate-invoices/${id}/issue`).set(fin.auth).send({});
    expect(
      (await api().post(`/api/v1/admin/corporate-invoices/${id}/void`).set(fin.auth).send({})).body
        .data.status,
    ).toBe('VOID');
    const again = await generate(company.companyId);
    expect(again.status).toBe(201);
    expect(again.body.data.lineCount).toBe(1);
    // Issued numbers have no gap: the new invoice gets the next number.
    const issued = await api()
      .post(`/api/v1/admin/corporate-invoices/${again.body.data.invoiceId}/issue`)
      .set(fin.auth)
      .send({});
    expect(issued.body.data.number).toMatch(/-000002$/);
  });

  it('a credit lowers what the company owes and the invoice, but only before the ride is invoiced', async () => {
    const { company } = await setup();
    const ride = await corporateRide(asha);
    const credit = (amountPaise: number) =>
      api()
        .post(`/api/v1/admin/corporate-bookings/${ride.bookingId}/credit`)
        .set(fin.auth)
        .send({ amountPaise, reason: 'Driver took a longer route' });
    expect((await credit(5000)).body.data.creditedPaise).toBe(5000);
    expect((await credit(ride.fare)).status).toBe(422); // more than is left
    const account = `CORPORATE_RECEIVABLE:${(await Booking.findOne({ publicId: ride.bookingId }))!.corporateId}`;
    expect((await ledger().balances([account]))[account]).toBe(ride.fare - 5000);

    const draft = await generate(company.companyId);
    expect(draft.body.data.totalPaise).toBe(ride.fare - 5000);
    expect((await credit(1000)).status).toBe(409); // now on an invoice
    await books();
  });

  it('notices unpaid invoices past their due date, and lists them', async () => {
    const { company } = await setup();
    await corporateRide(asha);
    const id = (await generate(company.companyId)).body.data.invoiceId as string;
    await api().post(`/api/v1/admin/corporate-invoices/${id}/issue`).set(fin.auth).send({});
    const monitor = (env.app.locals['services'] as { monitor: MonitorService }).monitor;
    const overdue = async () =>
      (await monitor.checks()).find((c) => c.name === 'corporate_invoices_overdue')!;
    expect((await overdue()).ok).toBe(true);
    env.setNow(new Date(Date.now() + 16 * 24 * HOUR));
    expect((await overdue()).ok).toBe(false);
    expect(
      (await api().get('/api/v1/admin/corporate-invoices?overdue=true').set(fin.auth)).body.data,
    ).toHaveLength(1);
    env.setNow(null);
  });
});

describe('repair', () => {
  it('a company payment that never reached the ledger is posted by the repair job, once', async () => {
    const { company } = await setup();
    const ride = await corporateRide(asha);
    const id = (await generate(company.companyId)).body.data.invoiceId as string;
    await api().post(`/api/v1/admin/corporate-invoices/${id}/issue`).set(fin.auth).send({});
    const key = idem();
    await api()
      .post(`/api/v1/admin/corporate-invoices/${id}/payments`)
      .set(fin.auth)
      .set('Idempotency-Key', key)
      .send({ amountPaise: ride.fare, reference: 'NEFT 9' });

    // Simulate a crash between saving the payment and posting it.
    await LedgerTransaction.collection.deleteOne({ idempotencyKey: `corp-pay:${id}:${key}` });
    await Invoice.updateOne({ publicId: id }, { $unset: { 'payments.0.ledgerAt': 1 } });
    expect(await LedgerTransaction.countDocuments({ kind: 'CORPORATE_PAYMENT' })).toBe(0);

    env.setNow(new Date(Date.now() + 2 * 60_000));
    await env.runFinance();
    await env.runFinance();
    env.setNow(null);
    expect(await LedgerTransaction.countDocuments({ kind: 'CORPORATE_PAYMENT' })).toBe(1);
    await books();
  });
});
