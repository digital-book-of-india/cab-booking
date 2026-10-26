import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CP,
  IGI,
  NEARISH_CP,
  NEAR_CP,
  acceptOffer,
  createDriver,
  currentOffer,
  loginAs,
  loginAsAdmin,
  nextPhone,
  pickupOtpOf,
  rideCall,
  seedWorld,
  startTestEnv,
  type TestEnv,
} from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());

const api = () => request(env.app);

/**
 * Spec A: "Test with two driver accounts and one customer account."
 * Everything below goes through the public HTTP API, like the real apps will.
 */
describe('full journey: one customer, two drivers', () => {
  it('quote -> booking -> decline -> accept -> arrive -> OTP start -> complete -> history', async () => {
    const world = await seedWorld();
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver1 = await createDriver(env, world, { at: NEAR_CP, name: 'Ravi Kumar' });
    const driver2 = await createDriver(env, world, { at: NEARISH_CP, name: 'Sunil Verma' });

    // 1. The customer sees the area is served, gets a quote and books.
    const area = await api().get(
      `/api/v1/serviceability?pickupLat=${CP.lat}&pickupLng=${CP.lng}&dropLat=${IGI.lat}&dropLng=${IGI.lng}`,
    );
    expect(area.body.data.serviceable).toBe(true);

    const quote = await api()
      .post('/api/v1/fare-quotes')
      .set(customer.auth)
      .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'], paymentPreference: 'CASH' });
    expect(quote.status).toBe(201);

    const booked = await api()
      .post('/api/v1/bookings')
      .set(customer.auth)
      .set('Idempotency-Key', 'journey-key-0001')
      .send({ quoteId: quote.body.data.quoteId, paymentMethod: 'CASH' });
    expect(booked.status).toBe(201);
    expect(booked.body.data.status).toBe('DISPATCHING');
    const bookingId = booked.body.data.bookingId as string;

    // 2. Only the nearest driver is offered the ride; the second is not bothered yet.
    const offer1 = await currentOffer(env, driver1);
    expect(offer1?.bookingId).toBe(bookingId);
    expect(await currentOffer(env, driver2)).toBeNull();

    // 3. Driver 1 declines, so driver 2 is offered it.
    await api()
      .post(`/api/v1/ride-offers/${offer1!.offerId}/reject`)
      .set(driver1.auth)
      .send({ reason: 'Break time' });
    const offer2 = await currentOffer(env, driver2);
    expect(offer2?.bookingId).toBe(bookingId);

    // 4. Driver 1's old offer is dead; driver 2 accepts and wins.
    expect((await acceptOffer(env, driver1, offer1!.offerId)).status).toBe(409);
    const accepted = await acceptOffer(env, driver2, offer2!.offerId);
    expect(accepted.status).toBe(200);
    const rideId = accepted.body.data.rideId as string;

    // 5. The customer sees who is coming; driver 1 can see nothing of this ride.
    const asCustomer = await api().get(`/api/v1/rides/${rideId}`).set(customer.auth);
    expect(asCustomer.body.data).toMatchObject({ status: 'DRIVER_ASSIGNED' });
    expect(asCustomer.body.data.driver.firstName).toBe('Sunil');
    expect((await api().get(`/api/v1/rides/${rideId}`).set(driver1.auth)).status).toBe(404);
    expect((await rideCall(env, driver1, rideId, 'en-route')).status).toBe(404);

    // 6. Driver 2 heads to the pickup; the customer can follow along.
    expect((await rideCall(env, driver2, rideId, 'en-route')).status).toBe(200);
    const track = await api().get(`/api/v1/rides/${rideId}/track`).set(customer.auth);
    expect(track.body.data.driver).toMatchObject({ lat: NEARISH_CP.lat, stale: false });

    // 7. Arrival needs the driver to actually be there.
    expect((await rideCall(env, driver2, rideId, 'arrived')).status).toBe(422);
    env.setNow(new Date(Date.now() + 45_000));
    await api()
      .post('/api/v1/drivers/me/location')
      .set(driver2.auth)
      .send({ lat: CP.lat, lng: CP.lng });
    expect((await rideCall(env, driver2, rideId, 'arrived')).status).toBe(200);

    // 8. The ride only starts with the rider's OTP.
    expect((await rideCall(env, driver2, rideId, 'start', { pickupOtp: '000000' })).status).toBe(
      422,
    );
    const otp = await pickupOtpOf(env, customer, rideId);
    expect((await rideCall(env, driver2, rideId, 'start', { pickupOtp: otp })).status).toBe(200);

    // 9. Complete: the server prices it, payment is due, and the driver is freed.
    env.setNow(new Date(Date.now() + 45_000 + quote.body.data.estimatedDurationSeconds * 1000));
    const done = await rideCall(env, driver2, rideId, 'complete');
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', paymentStatus: 'DUE' });
    expect(done.body.data.finalFarePaise).toBeGreaterThanOrEqual(10_000);

    // 10. History reflects it for both sides, and the timeline is complete and ordered.
    const mine = await api().get('/api/v1/customers/me/rides').set(customer.auth);
    expect(mine.body.data[0]).toMatchObject({
      bookingId,
      rideId,
      status: 'COMPLETED',
      paymentStatus: 'DUE',
    });
    const theirs = await api().get('/api/v1/drivers/me/rides').set(driver2.auth);
    expect(theirs.body.data[0].rideId).toBe(rideId);
    expect((await api().get('/api/v1/drivers/me/rides').set(driver1.auth)).body.data).toHaveLength(
      0,
    );

    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const events = await api().get(`/api/v1/bookings/${bookingId}/events`).set(ops.auth);
    expect(events.body.data.map((e: { type: string }) => e.type)).toEqual([
      'BOOKING_CREATED',
      'DISPATCH_STARTED',
      'DRIVER_ASSIGNED',
      'DRIVER_EN_ROUTE',
      'DRIVER_ARRIVED',
      'RIDE_STARTED',
      'RIDE_COMPLETED',
    ]);
    const times = events.body.data.map((e: { at: string }) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
