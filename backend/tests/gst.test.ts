import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Ride } from '../src/modules/rides/ride.model';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import { calculateFare, withTax, type FareRates } from '../src/modules/pricing/fare';
import { outstationEstimate, rentalEstimate, rentalFinal } from '../src/modules/trips/tripFares';
import { Accounts } from '../src/modules/ledger/accounts';
import {
  CP,
  IGI,
  assignTo,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  rideCall,
  seedWorld,
  startRide,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

const RATES: FareRates = {
  baseFarePaise: 5000,
  perKmPaise: 1200,
  perMinutePaise: 150,
  minimumFarePaise: 8000,
  roundingMode: 'NEAREST_RUPEE',
};

describe('tax added on top of a fare (the maths)', () => {
  it('adds the tax in exact paise and leaves the fare before tax as it was', () => {
    const plain = calculateFare(RATES, 10_000, 1200);
    const taxed = calculateFare(RATES, 10_000, 1200, undefined, 500);
    expect(plain.taxPaise).toBe(0);
    expect(taxed.taxPaise).toBe(Math.round((plain.estimatedTotalPaise * 500) / 10_000));
    expect(taxed.estimatedTotalPaise).toBe(plain.estimatedTotalPaise + taxed.taxPaise);
    // Every other line is untouched.
    expect({ ...taxed, taxPaise: 0, estimatedTotalPaise: 0 }).toEqual({
      ...plain,
      taxPaise: 0,
      estimatedTotalPaise: 0,
    });
  });

  it('is off when the rate is 0 or missing', () => {
    const plain = calculateFare(RATES, 10_000, 1200);
    expect(calculateFare(RATES, 10_000, 1200, undefined, 0)).toEqual(plain);
    expect(withTax(plain, 0)).toBe(plain);
  });

  it('keeps the minimum fare before tax, so the tax is on the minimum', () => {
    const b = calculateFare(RATES, 100, 10, undefined, 500);
    expect(b.minimumFareAdjustmentPaise).toBeGreaterThan(0);
    expect(b.estimatedTotalPaise - b.taxPaise).toBe(8000);
    expect(b.taxPaise).toBe(400);
  });

  it('applies to rentals and outstation trips too', () => {
    const rental = {
      packageId: 'p',
      name: '4 hours',
      hours: 4,
      includedKm: 40,
      pricePaise: 120_000,
      extraKmPaise: 1500,
      extraHourPaise: 24_000,
    };
    expect(rentalEstimate(rental, 500).breakdown).toMatchObject({
      taxPaise: 6000,
      estimatedTotalPaise: 126_000,
    });
    expect(rentalEstimate(rental).breakdown.taxPaise).toBe(0);
    const usage = { elapsedSeconds: 3600, measuredMeters: 10_000 };
    const rules = { rentalGraceMinutes: 10, rentalGraceKm: 2, oneWayDetourBp: 2000, taxBp: 500 };
    expect(rentalFinal(rental, usage, rules).breakdown).toMatchObject({
      taxPaise: 6000,
      estimatedTotalPaise: 126_000,
    });
    const outstation = {
      rateId: 'r',
      tripType: 'ONE_WAY' as const,
      routeMeters: 250_000,
      days: 1,
      nights: 0,
      perKmPaise: 1200,
      minKmPerDay: 250,
      allowancePerNightPaise: 0,
      minimumFarePaise: 0,
      estimatedKm: 250,
    };
    const o = outstationEstimate(outstation, 500).breakdown;
    expect(o.taxPaise).toBe(Math.round(((o.estimatedTotalPaise - o.taxPaise) * 500) / 10_000));
    expect(o.taxPaise).toBeGreaterThan(0);
  });
});

describe('a ride with GST (5% on the fare, 18% on the commission)', () => {
  let env: TestEnv;
  let world: Awaited<ReturnType<typeof seedWorld>>;
  let rider: Session;
  beforeAll(async () => {
    env = await startTestEnv({}, { financeConfig: { rideTaxBp: 500, commissionTaxBp: 1800 } });
  });
  afterAll(() => env.stop());
  beforeEach(async () => {
    await env.reset();
    world = await seedWorld();
    rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  });
  const api = () => request(env.app);

  it('shows the rider the tax in the quote, and charges the same at the end', async () => {
    const q = await api()
      .post('/api/v1/fare-quotes')
      .set(rider.auth)
      .send({
        pickup: { lat: 28.6315, lng: 77.2167 },
        drop: { lat: 28.5562, lng: 77.1 },
        categoryId: world.cats['MINI'],
      });
    expect(q.status).toBe(201);
    const b = q.body.data.breakdown;
    expect(b.taxPaise).toBeGreaterThan(0);
    expect(q.body.data.estimatedPayablePaise).toBe(b.estimatedTotalPaise);
    expect(b.taxPaise).toBe(Math.round(((b.estimatedTotalPaise - b.taxPaise) * 500) / 10_000));
  });

  it('splits a completed cash ride between rider, driver, platform and the tax office', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, rider, driver, 'CASH');

    const complete = await api().get(`/api/v1/rides/${ride.rideId}`).set(rider.auth);
    expect(complete.status).toBe(200);

    const receipt = await api().get(`/api/v1/rides/${ride.rideId}/receipt`).set(rider.auth);
    expect(receipt.status).toBe(200);
    const lines = receipt.body.data.lines as { code: string; amountPaise: number }[];
    const taxLine = lines.find((l) => l.code === 'TAX');
    expect(taxLine, JSON.stringify(lines)).toBeTruthy();
    const tax = taxLine!.amountPaise;
    expect(receipt.body.data.totalPaise).toBe(ride.fare);
    const beforeTax = ride.fare - tax;
    expect(tax).toBe(Math.round((beforeTax * 500) / 10_000));

    // The driver confirms cash for the whole amount the rider owes, tax included.
    const paid = await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);

    // The ledger: commission and driver pay on the fare BEFORE tax; tax held for the tax office.
    const commission = Math.round(beforeTax * 0.2);
    const commissionTax = Math.round(commission * 0.18);
    const driverShare = beforeTax - commission - commissionTax;
    const [accrual] = await LedgerTransaction.find({ kind: 'RIDE_ACCRUAL' }).lean();
    const byAccount = Object.fromEntries(
      accrual!.entries.map((e: { account: string; amountPaise: number }) => [
        e.account,
        e.amountPaise,
      ]),
    );
    expect(byAccount[Accounts.driverPayable(driver.driverId)]).toBe(-driverShare);
    expect(byAccount[Accounts.commission]).toBe(-commission);
    expect(byAccount[Accounts.taxPayable]).toBe(-(tax + commissionTax));
    expect(
      accrual!.entries.reduce((s: number, e: { amountPaise: number }) => s + e.amountPaise, 0),
    ).toBe(0);
    expect(byAccount[`RIDER_RECEIVABLE:${await rideCustomerId(ride.rideId)}`]).toBe(ride.fare);

    // The books still balance, and the driver's earnings are net of the tax on the commission.
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const consistency = await api().get('/api/v1/admin/finance/consistency').set(fin.auth);
    expect(consistency.status).toBe(200);
    expect(consistency.body.data.ok, JSON.stringify(consistency.body.data)).toBe(true);
    const balance = await api().get('/api/v1/drivers/me/balance').set(driver.auth);
    expect(balance.body.data.payablePaise).toBe(driverShare);
    const earnings = await api().get('/api/v1/drivers/me/earnings').set(driver.auth);
    expect(earnings.body.data.items[0]).toMatchObject({
      taxPaise: tax,
      commissionTaxPaise: commissionTax,
      commissionPaise: commission,
      earningsPaise: driverShare,
    });
  });

  it('works out a coupon on the fare before tax; the platform pays it and the tax is still charged in full', async () => {
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const made = await api()
      .post('/api/v1/admin/coupons')
      .set(admin.auth)
      .send({
        code: 'TENOFF',
        type: 'PERCENT',
        value: 1000,
        validFrom: new Date(Date.now() - 86_400_000).toISOString(),
        validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const driver = await createDriver(env, world);
    const q = await api()
      .post('/api/v1/fare-quotes')
      .set(rider.auth)
      .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'], couponCode: 'TENOFF' });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    const b = q.body.data.breakdown;
    const beforeTax = b.estimatedTotalPaise - b.taxPaise;
    // The quote already shows what the rider will pay: fare + tax - 10% of the fare.
    expect(q.body.data.coupon.discountPaise).toBe(Math.round(beforeTax * 0.1));
    expect(q.body.data.estimatedPayablePaise).toBe(
      b.estimatedTotalPaise - Math.round(beforeTax * 0.1),
    );
    const booked = await api()
      .post('/api/v1/bookings')
      .set(rider.auth)
      .set('Idempotency-Key', `gst-coupon-${Date.now()}`)
      .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CASH' });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    const rideId = await assignTo(env, driver);
    await startRide(env, rider, driver, rideId);
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    const { grossFarePaise, taxPaise, discountPaise, finalFarePaise } = done.body.data;
    const fareBeforeTax = grossFarePaise - taxPaise;
    expect(discountPaise).toBe(Math.round(fareBeforeTax * 0.1));
    expect(finalFarePaise).toBe(grossFarePaise - discountPaise);
    expect(taxPaise).toBe(Math.round((fareBeforeTax * 500) / 10_000));

    const [accrual] = await LedgerTransaction.find({ kind: 'RIDE_ACCRUAL' }).lean();
    const byAccount = Object.fromEntries(
      accrual!.entries.map((e: { account: string; amountPaise: number }) => [
        e.account,
        e.amountPaise,
      ]),
    );
    const commission = Math.round(fareBeforeTax * 0.2);
    const commissionTax = Math.round(commission * 0.18);
    expect(byAccount[Accounts.promotions]).toBe(discountPaise);
    expect(byAccount[Accounts.taxPayable]).toBe(-(taxPaise + commissionTax));
    expect(byAccount[Accounts.driverPayable(driver.driverId)]).toBe(
      -(fareBeforeTax - commission - commissionTax),
    );
    expect(
      accrual!.entries.reduce((s: number, e: { amountPaise: number }) => s + e.amountPaise, 0),
    ).toBe(0);
  });

  async function rideCustomerId(rideId: string): Promise<string> {
    return String((await Ride.findOne({ publicId: rideId }).lean())!.customerId);
  }
});
