import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Invoice } from '../src/modules/corporate/corporate.models';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
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
let boss: Session;
let driver: TestDriver;
beforeAll(async () => {
  env = await startTestEnv(
    {},
    {
      financeConfig: {
        invoiceTaxBp: 1800,
        invoiceTaxLabel: 'GST',
        seller: {
          name: 'Cab Booking Pvt Ltd',
          gstin: '07AAAAA0000A1Z5',
          address: 'Delhi',
          sacCode: '996412',
        },
      },
    },
  );
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
  boss = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
const HOUR = 3_600_000;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;

/** A company with one admin who takes one billed ride; returns an issued-ready draft invoice. */
async function draftInvoice() {
  const company = (
    await api()
      .post('/api/v1/admin/corporate')
      .set(fin.auth)
      .send({
        name: 'Acme',
        billingEmail: 'accounts@acme.example',
        adminPhone: (await User.findById(boss.userId))!.phone,
        gstin: '27AAAAA0000A1Z5',
      })
  ).body.data;
  await api()
    .post(`/api/v1/corporate/invitations/${company.firstAdmin.membershipId}/accept`)
    .set(boss.auth)
    .send({});
  const q = await api()
    .post('/api/v1/fare-quotes')
    .set(boss.auth)
    .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'] });
  await api()
    .post('/api/v1/bookings')
    .set(boss.auth)
    .set('Idempotency-Key', idem())
    .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CORPORATE' });
  const rideId = await assignTo(env, driver);
  await startRide(env, boss, driver, rideId);
  const done = await rideCall(env, driver, rideId, 'complete');
  const fare = done.body.data.finalFarePaise as number;
  const draft = await api()
    .post(`/api/v1/admin/corporate/${company.companyId}/invoices`)
    .set(fin.auth)
    .send({
      from: new Date(Date.now() - 24 * HOUR).toISOString(),
      to: new Date(Date.now() + 24 * HOUR).toISOString(),
    });
  return { company, fare, invoiceId: draft.body.data.invoiceId as string };
}
const balance = async (account: string) => (await ledger().balances([account]))[account]!;
const checkBooks = async () =>
  expect(await ledger().checkBalance()).toEqual({
    ledgerTotalPaise: 0,
    unbalancedTransactions: [],
    completedRidesWithoutAccrual: 0,
  });

describe('tax on a company invoice', () => {
  it('is added when the invoice is issued, shown with the seller, owed by the company, and settled by paying the total', async () => {
    const { company, fare, invoiceId } = await draftInvoice();
    const tax = Math.round(fare * 0.18);
    const draft = (await api().get(`/api/v1/admin/corporate-invoices/${invoiceId}`).set(fin.auth))
      .body.data;
    expect(draft).toMatchObject({ taxPaise: 0, totalPaise: fare }); // no tax until it is issued

    const issued = (
      await api().post(`/api/v1/admin/corporate-invoices/${invoiceId}/issue`).set(fin.auth).send({})
    ).body.data;
    expect(issued).toMatchObject({
      subtotalPaise: fare,
      taxBp: 1800,
      taxLabel: 'GST',
      taxPaise: tax,
      totalPaise: fare + tax,
      balancePaise: fare + tax,
    });
    expect(issued.seller).toEqual({
      name: 'Cab Booking Pvt Ltd',
      gstin: '07AAAAA0000A1Z5',
      address: 'Delhi',
      sacCode: '996412',
    });
    expect(issued.company.gstin).toBe('27AAAAA0000A1Z5');

    // The company is emailed a notice with the tax included.
    const mail = env.emails.find((m) => m.to === 'accounts@acme.example')!;
    expect(mail.subject).toMatch(/^Invoice CI-\d{4}-000001/);
    expect(mail.text).toContain('including GST');

    // It owes the fare and the tax; we owe the tax onward.
    const account = `CORPORATE_RECEIVABLE:${(await Invoice.findOne({ publicId: invoiceId }))!.companyId}`;
    expect(await balance(account)).toBe(fare + tax);
    expect(await balance('TAX_PAYABLE')).toBe(-tax);

    // Paying the total (not just the fares) clears everything.
    expect(
      (
        await api()
          .post(`/api/v1/admin/corporate-invoices/${invoiceId}/payments`)
          .set(fin.auth)
          .set('Idempotency-Key', idem())
          .send({ amountPaise: fare + tax + 1, reference: 'NEFT 1' })
      ).status,
    ).toBe(422);
    const paid = await api()
      .post(`/api/v1/admin/corporate-invoices/${invoiceId}/payments`)
      .set(fin.auth)
      .set('Idempotency-Key', idem())
      .send({ amountPaise: fare + tax, reference: 'NEFT 2' });
    expect(paid.body.data.status).toBe('PAID');
    expect(await balance(account)).toBe(0);
    expect(await balance('PLATFORM_BANK')).toBe(fare + tax);
    await checkBooks();
    // The company sees it too.
    expect(
      (await api().get(`/api/v1/corporate/invoices/${invoiceId}`).set(boss.auth)).body.data
        .taxPaise,
    ).toBe(tax);
    void company;
  });

  it('voiding an issued invoice takes the tax back out', async () => {
    const { fare, invoiceId } = await draftInvoice();
    const tax = Math.round(fare * 0.18);
    await api().post(`/api/v1/admin/corporate-invoices/${invoiceId}/issue`).set(fin.auth).send({});
    const account = `CORPORATE_RECEIVABLE:${(await Invoice.findOne({ publicId: invoiceId }))!.companyId}`;
    expect(await balance(account)).toBe(fare + tax);
    await api().post(`/api/v1/admin/corporate-invoices/${invoiceId}/void`).set(fin.auth).send({});
    expect(await balance(account)).toBe(fare);
    expect(await balance('TAX_PAYABLE')).toBe(0);
    await checkBooks();
  });

  it('tax that never reached the ledger is posted by the repair job, once', async () => {
    const { fare, invoiceId } = await draftInvoice();
    const tax = Math.round(fare * 0.18);
    await api().post(`/api/v1/admin/corporate-invoices/${invoiceId}/issue`).set(fin.auth).send({});
    await LedgerTransaction.collection.deleteOne({ idempotencyKey: `inv-tax:${invoiceId}` });
    await Invoice.updateOne({ publicId: invoiceId }, { $unset: { taxLedgerAt: 1 } });
    expect(await balance('TAX_PAYABLE')).toBe(0);
    env.setNow(new Date(Date.now() + 2 * 60_000));
    await env.runFinance();
    await env.runFinance();
    env.setNow(null);
    expect(await balance('TAX_PAYABLE')).toBe(-tax);
    expect(await LedgerTransaction.countDocuments({ kind: 'INVOICE_TAX' })).toBe(1);
    void fare;
  });
});
