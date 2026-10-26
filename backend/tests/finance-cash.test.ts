import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import {
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

// A tiny cash limit (Rs 5), so a single cash ride puts the driver over it.
let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let customer: Session;
beforeAll(async () => {
  env = await startTestEnv({}, { financeConfig: { driverCashLimitPaise: 500 } });
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
const goOnline = (d: Session & { vehicleId: string }) =>
  api()
    .post('/api/v1/drivers/me/presence')
    .set(d.auth)
    .send({ status: 'ONLINE', vehicleId: d.vehicleId, location: { lat: 28.6335, lng: 77.2167 } });

describe('too much cash in hand', () => {
  it('takes the driver offline, keeps them off until they hand cash in, then lets them back', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'CASH');
    const res = await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    const commission = Math.round(ride.fare * 0.2);
    expect(res.body.data).toMatchObject({
      overLimit: true,
      limitPaise: 500,
      netOwedToPlatformPaise: commission,
    });

    expect((await DriverProfile.findById(driver.driverId).lean())?.onlineStatus).toBe('OFFLINE');
    const status = await api().get('/api/v1/drivers/me/presence').set(driver.auth);
    expect(status.body.data.issues).toContain('CASH_LIMIT_EXCEEDED');
    const refused = await goOnline(driver);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toContain('CASH_LIMIT_EXCEEDED');
    expect(
      (await api().get('/api/v1/drivers/me/balance').set(driver.auth)).body.data,
    ).toMatchObject({
      blockedByCashLimit: true,
      cashLimitPaise: 500,
    });

    // Finance sees them on the over-limit list.
    const over = await api().get('/api/v1/admin/balances/drivers?overLimit=true').set(fin.auth);
    expect(over.body.data.map((d: { driverId: string }) => d.driverId)).toEqual([driver.driverId]);

    // Handing in a little is not enough; handing in enough is.
    const deposit = (amountPaise: number, key: string) =>
      api()
        .post(`/api/v1/admin/drivers/${driver.driverId}/cash-deposits`)
        .set(fin.auth)
        .set('Idempotency-Key', key)
        .send({ amountPaise });
    expect((await deposit(1, 'deposit-key-1')).status).toBe(201);
    expect((await goOnline(driver)).status).toBe(403);
    expect((await deposit(ride.fare - 1, 'deposit-key-2')).status).toBe(201);
    expect((await goOnline(driver)).status).toBe(200);
    expect(
      (await api().get('/api/v1/admin/balances/drivers?overLimit=true').set(fin.auth)).body.data,
    ).toHaveLength(0);
  });

  it('only finance may record a deposit, and it needs an idempotency key', async () => {
    const driver = await createDriver(env, world);
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const url = `/api/v1/admin/drivers/${driver.driverId}/cash-deposits`;
    expect(
      (
        await api()
          .post(url)
          .set(support.auth)
          .set('Idempotency-Key', 'k-0000001')
          .send({ amountPaise: 100 })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(url)
          .set(driver.auth)
          .set('Idempotency-Key', 'k-0000001')
          .send({ amountPaise: 100 })
      ).status,
    ).toBe(403);
    expect((await api().post(url).set(fin.auth).send({ amountPaise: 100 })).status).toBe(400);
    expect(
      (
        await api()
          .post(url)
          .set(fin.auth)
          .set('Idempotency-Key', 'k-0000001')
          .send({ amountPaise: 100 })
      ).status,
    ).toBe(422); // holds no cash
    expect(
      (
        await api()
          .post('/api/v1/admin/drivers/507f1f77bcf86cd799439011/cash-deposits')
          .set(fin.auth)
          .set('Idempotency-Key', 'k-0000002')
          .send({ amountPaise: 100 })
      ).status,
    ).toBe(404);
  });
});
