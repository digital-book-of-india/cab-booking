import { http, HttpResponse } from 'msw';
import { LiveDriverLocation, RideRecord, DispatchQueueItem, RideReceipt } from '@/types';

const mockLiveDrivers: LiveDriverLocation[] = [
  {
    driverId: 'drv_101',
    name: 'Rajesh Kumar Verma',
    phoneMasked: '+91 ••••• •3421',
    status: 'ONLINE',
    vehicleMakeModel: 'Maruti Suzuki Dzire',
    vehicleReg: 'DL 1Z A 4920',
    category: 'Sedan Prime',
    lat: 28.6315,
    lng: 77.2167, // Connaught Place
    headingDegrees: 90,
    speedKmh: 24,
    updatedAt: new Date().toISOString(),
  },
  {
    driverId: 'drv_102',
    name: 'Amit Sharma',
    phoneMasked: '+91 ••••• •9812',
    status: 'ONLINE',
    currentRideId: 'ride_10001',
    vehicleMakeModel: 'Hyundai Aura',
    vehicleReg: 'DL 2C B 8821',
    category: 'Sedan Prime',
    lat: 28.5921,
    lng: 77.1754, // En route to Airport
    headingDegrees: 220,
    speedKmh: 48,
    updatedAt: new Date().toISOString(),
  },
  {
    driverId: 'drv_103',
    name: 'Sunil Paswan',
    phoneMasked: '+91 ••••• •5512',
    status: 'ONLINE',
    vehicleMakeModel: 'Maruti WagonR',
    vehicleReg: 'DL 3C C 1102',
    category: 'Mini Hatchback',
    lat: 28.6502,
    lng: 77.2301, // Old Delhi
    headingDegrees: 180,
    speedKmh: 0,
    updatedAt: new Date().toISOString(),
  },
];

let mockDispatchQueue: DispatchQueueItem[] = [
  {
    bookingId: 'bk_2001',
    customerId: 'usr_cust_01',
    customerName: 'Priya Sharma',
    customerPhoneMasked: '+91 ••••• •9021',
    categoryName: 'Sedan Prime',
    pickup: { label: 'Barakhamba Road, Connaught Place', lat: 28.6300, lng: 77.2200 },
    drop: { label: 'Cyber City, Gurugram', lat: 28.4950, lng: 77.0890 },
    estimatedFarePaise: 54000,
    status: 'DISPATCHING',
    dispatchAttempts: 3,
    createdAt: new Date(Date.now() - 180000).toISOString(),
  },
  {
    bookingId: 'bk_2002',
    customerId: 'usr_cust_02',
    customerName: 'Vikas Gupta',
    customerPhoneMasked: '+91 ••••• •4411',
    categoryName: 'Mini Hatchback',
    pickup: { label: 'Lajpat Nagar Central Market', lat: 28.5680, lng: 77.2430 },
    drop: { label: 'Noida Sector 62', lat: 28.6250, lng: 77.3730 },
    estimatedFarePaise: 42000,
    status: 'NO_DRIVER_FOUND',
    dispatchAttempts: 5,
    createdAt: new Date(Date.now() - 600000).toISOString(),
  },
];

let mockRides: RideRecord[] = [
  {
    id: 'ride_10001',
    bookingId: 'bk_10001',
    customerId: 'usr_cust_03',
    customerName: 'Ananya Roy',
    customerPhoneMasked: '+91 ••••• •7712',
    driverId: 'drv_102',
    driverName: 'Amit Sharma',
    driverPhoneMasked: '+91 ••••• •9812',
    vehicleRegistration: 'DL 2C B 8821',
    vehicleModel: 'Hyundai Aura',
    categoryId: 'cat_sedan',
    categoryName: 'Sedan Prime',
    pickup: { label: 'Connaught Place, New Delhi', lat: 28.6315, lng: 77.2167 },
    drop: { label: 'IGI Airport Terminal 3, New Delhi', lat: 28.5562, lng: 77.1000 },
    status: 'IN_PROGRESS',
    paymentStatus: 'DUE',
    paymentMethod: 'ONLINE',
    rideType: 'INSTANT',
    fare: {
      baseFarePaise: 4000,
      distanceFarePaise: 26000,
      timeFarePaise: 7000,
      waitingFarePaise: 0,
      tollPaise: 0,
      demandAdjustmentPaise: 0,
      discountPaise: 0,
      taxPaise: 200,
      finalTotalPaise: 37200,
    },
    routePolyline: [
      [28.6315, 77.2167],
      [28.6150, 77.2000],
      [28.5921, 77.1754],
      [28.5562, 77.1000],
    ],
    requestedAt: new Date(Date.now() - 3600000).toISOString(),
    acceptedAt: new Date(Date.now() - 3300000).toISOString(),
    arrivedAt: new Date(Date.now() - 3000000).toISOString(),
    startedAt: new Date(Date.now() - 2700000).toISOString(),
  },
  {
    id: 'ride_10002',
    bookingId: 'bk_10002',
    customerId: 'usr_cust_04',
    customerName: 'Rohan Mehra',
    customerPhoneMasked: '+91 ••••• •1190',
    driverId: 'drv_101',
    driverName: 'Rajesh Kumar Verma',
    driverPhoneMasked: '+91 ••••• •3421',
    vehicleRegistration: 'DL 1Z A 4920',
    vehicleModel: 'Maruti Suzuki Dzire',
    categoryId: 'cat_sedan',
    categoryName: 'Sedan Prime',
    pickup: { label: 'Hauz Khas Village', lat: 28.5494, lng: 77.1931 },
    drop: { label: 'Khan Market', lat: 28.6003, lng: 77.2270 },
    status: 'COMPLETED',
    paymentStatus: 'PAID',
    paymentMethod: 'ONLINE',
    rideType: 'INSTANT',
    fare: {
      baseFarePaise: 4000,
      distanceFarePaise: 18000,
      timeFarePaise: 4500,
      waitingFarePaise: 0,
      tollPaise: 0,
      demandAdjustmentPaise: 0,
      discountPaise: 0,
      taxPaise: 150,
      finalTotalPaise: 26650,
    },
    routePolyline: [
      [28.5494, 77.1931],
      [28.5700, 77.2100],
      [28.6003, 77.2270],
    ],
    requestedAt: new Date(Date.now() - 7200000).toISOString(),
    acceptedAt: new Date(Date.now() - 7000000).toISOString(),
    arrivedAt: new Date(Date.now() - 6800000).toISOString(),
    startedAt: new Date(Date.now() - 6600000).toISOString(),
    completedAt: new Date(Date.now() - 5400000).toISOString(),
  },
];

export const rideHandlers = [
  // Live Drivers Map Feed
  http.get('/api/v1/admin/drivers/live', () => {
    return HttpResponse.json({
      success: true,
      data: mockLiveDrivers,
      meta: { requestId: 'req_live_radar' },
    });
  }),

  // Dispatch Queue
  http.get('/api/v1/admin/dispatch/queue', () => {
    return HttpResponse.json({
      success: true,
      data: mockDispatchQueue,
      meta: { requestId: 'req_disp_queue' },
    });
  }),

  // Manual Driver Assignment (Spec B M11)
  http.post('/api/v1/admin/bookings/:bookingId/assign-driver', async ({ params, request }) => {
    const body = (await request.json()) as { driverId: string; vehicleId?: string; reasonCode: string };

    // Simulate 409 conflict if already claimed
    if (body.driverId === 'drv_conflict') {
      return HttpResponse.json(
        {
          success: false,
          error: {
            code: 'RIDE_ALREADY_ASSIGNED',
            message: 'This ride has already been accepted by another driver.',
            requestId: 'err_conflict_409',
          },
        },
        { status: 409 }
      );
    }

    mockDispatchQueue = mockDispatchQueue.filter((item) => item.bookingId !== params.bookingId);
    return HttpResponse.json({
      success: true,
      data: {
        bookingId: params.bookingId,
        status: 'DRIVER_ASSIGNED',
        assignedDriverId: body.driverId,
      },
      meta: { requestId: 'req_manual_assign_ok' },
    });
  }),

  // Retry Dispatch
  http.post('/api/v1/bookings/:bookingId/dispatch/retry', ({ params }) => {
    mockDispatchQueue = mockDispatchQueue.map((item) =>
      item.bookingId === params.bookingId ? { ...item, status: 'DISPATCHING', dispatchAttempts: item.dispatchAttempts + 1 } : item
    );
    return HttpResponse.json({ success: true, data: { status: 'DISPATCHING' }, meta: { requestId: 'req_retry_ok' } });
  }),

  // Ride Explorer (11-State Filtering)
  http.get('/api/v1/admin/rides', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.toLowerCase() || '';

    let list = mockRides;
    if (status && status !== 'ALL') {
      list = list.filter((r) => r.status === status);
    }
    if (search) {
      list = list.filter(
        (r) =>
          r.id.toLowerCase().includes(search) ||
          r.customerName.toLowerCase().includes(search) ||
          (r.driverName && r.driverName.toLowerCase().includes(search))
      );
    }

    return HttpResponse.json({
      success: true,
      data: list,
      meta: { requestId: 'req_rides_list' },
    });
  }),

  // Ride Detail
  http.get('/api/v1/admin/rides/:rideId', ({ params }) => {
    const ride = mockRides.find((r) => r.id === params.rideId);
    if (!ride) {
      return HttpResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Ride not found', requestId: 'err_404_ride' } },
        { status: 404 }
      );
    }
    return HttpResponse.json({ success: true, data: ride, meta: { requestId: 'req_ride_get' } });
  }),

  // Administrative Ride Cancellation
  http.post('/api/v1/admin/bookings/:bookingId/cancel', async ({ params, request }) => {
    const body = (await request.json()) as { reasonCode: string; feeDecision: string; notes?: string };
    mockRides = mockRides.map((r) =>
      r.bookingId === params.bookingId
        ? {
            ...r,
            status: 'CANCELLED',
            cancellationActor: 'ADMIN',
            cancellationReason: `${body.reasonCode}: ${body.notes || 'Ops Override'}`,
            cancelledAt: new Date().toISOString(),
          }
        : r
    );
    return HttpResponse.json({ success: true, data: { cancelled: true }, meta: { requestId: 'req_admin_cancel' } });
  }),

  // Printable Receipt Query
  http.get('/api/v1/admin/bookings/:bookingId/receipt', ({ params }) => {
    const ride = mockRides.find((r) => r.bookingId === params.bookingId) || mockRides[1];
    const receipt: RideReceipt = {
      receiptId: `rcpt_${params.bookingId}`,
      bookingId: ride.bookingId,
      rideId: ride.id,
      issuedAt: new Date().toISOString(),
      customerName: ride.customerName,
      driverName: ride.driverName || 'Verified Fleet Partner',
      vehicleDetails: `${ride.vehicleModel || 'Sedan'} (${ride.vehicleRegistration || 'DL 1Z A 4920'})`,
      pickupAddress: ride.pickup.label,
      dropAddress: ride.drop.label,
      distanceKm: 18.5,
      durationMinutes: 45,
      paymentMethod: ride.paymentMethod,
      paymentStatus: ride.paymentStatus,
      fare: ride.fare,
    };
    return HttpResponse.json({ success: true, data: receipt, meta: { requestId: 'req_rcpt' } });
  }),
];