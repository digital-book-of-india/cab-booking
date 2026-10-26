import { http, HttpResponse } from 'msw';
import { DriverProfile, Vehicle, CabCategory } from '@/types';

let mockDrivers: DriverProfile[] = [
  {
    id: 'drv_101',
    userId: 'usr_drv_101',
    name: 'Rajesh Kumar Verma',
    phoneMasked: '+91 ••••• •3421',
    approvalStatus: 'PENDING',
    onlineStatus: 'OFFLINE',
    currentVehicleId: 'veh_01',
    vehicleDetails: 'Maruti Suzuki Dzire (DL 1Z A 4920)',
    rating: 4.85,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    documents: [
      {
        id: 'doc_dl_101',
        driverId: 'drv_101',
        type: 'DRIVING_LICENCE',
        documentNumberLast4: '8834',
        objectKey: 'private/driver-docs/drv_101/dl.jpg',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000 * 400).toISOString(),
      },
      {
        id: 'doc_rc_101',
        driverId: 'drv_101',
        type: 'VEHICLE_RC',
        documentNumberLast4: '4920',
        objectKey: 'private/driver-docs/drv_101/rc.jpg',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000 * 20).toISOString(), // Expiring in 20 days
      },
      {
        id: 'doc_ins_101',
        driverId: 'drv_101',
        type: 'COMMERCIAL_INSURANCE',
        documentNumberLast4: '1092',
        objectKey: 'private/driver-docs/drv_101/insurance.jpg',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000 * 180).toISOString(),
      },
    ],
  },
  {
    id: 'drv_102',
    userId: 'usr_drv_102',
    name: 'Amit Sharma',
    phoneMasked: '+91 ••••• •9812',
    approvalStatus: 'APPROVED',
    onlineStatus: 'ONLINE',
    currentVehicleId: 'veh_02',
    vehicleDetails: 'Hyundai Aura (DL 2C B 8821)',
    rating: 4.92,
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    documents: [
      {
        id: 'doc_dl_102',
        driverId: 'drv_102',
        type: 'DRIVING_LICENCE',
        documentNumberLast4: '4412',
        objectKey: 'private/driver-docs/drv_102/dl.jpg',
        status: 'APPROVED',
        expiresAt: new Date(Date.now() + 86400000 * 15).toISOString(), // Expiring in 15 days
      },
    ],
  },
  {
    id: 'drv_103',
    userId: 'usr_drv_103',
    name: 'Vikas Singh Yadav',
    phoneMasked: '+91 ••••• •1298',
    approvalStatus: 'SUSPENDED',
    onlineStatus: 'OFFLINE',
    rating: 3.75,
    createdAt: new Date(Date.now() - 86400000 * 60).toISOString(),
    documents: [],
  },
];

let mockVehicles: Vehicle[] = [
  {
    id: 'veh_01',
    driverId: 'drv_101',
    driverName: 'Rajesh Kumar Verma',
    categoryId: 'cat_sedan',
    categoryName: 'Sedan Prime',
    registrationNumber: 'DL 1Z A 4920',
    makeModel: 'Maruti Suzuki Dzire',
    seats: 4,
    verificationStatus: 'PENDING',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'veh_02',
    driverId: 'drv_102',
    driverName: 'Amit Sharma',
    categoryId: 'cat_sedan',
    categoryName: 'Sedan Prime',
    registrationNumber: 'DL 2C B 8821',
    makeModel: 'Hyundai Aura',
    seats: 4,
    verificationStatus: 'VERIFIED',
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
];

let mockCategories: CabCategory[] = [
  { id: 'cat_mini', code: 'MINI', name: 'Mini Hatchback', capacity: 4, active: true, displayOrder: 1, fareConfigRef: 'fc_v12_mini' },
  { id: 'cat_sedan', code: 'SEDAN', name: 'Sedan Prime', capacity: 4, active: true, displayOrder: 2, fareConfigRef: 'fc_v12_sedan' },
  { id: 'cat_suv', code: 'SUV', name: 'SUV XL', capacity: 6, active: true, displayOrder: 3, fareConfigRef: 'fc_v12_suv' },
  { id: 'cat_auto', code: 'AUTO', name: 'Auto Rickshaw', capacity: 3, active: false, displayOrder: 4, fareConfigRef: 'fc_v12_auto' },
];

export const driverHandlers = [
  // List Drivers with filtering
  http.get('/api/v1/admin/drivers', ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.toLowerCase() || '';

    let list = mockDrivers;
    if (status) {
      list = list.filter((d) => d.approvalStatus === status);
    }
    if (search) {
      list = list.filter((d) => d.name.toLowerCase().includes(search) || d.phoneMasked.includes(search));
    }

    return HttpResponse.json({
      success: true,
      data: list,
      meta: { requestId: 'req_drv_list' },
    });
  }),

  // Driver Detail
  http.get('/api/v1/admin/drivers/:driverId', ({ params }) => {
    const drv = mockDrivers.find((d) => d.id === params.driverId);
    if (!drv) {
      return HttpResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Driver not found', requestId: 'err_404' } }, { status: 404 });
    }
    return HttpResponse.json({ success: true, data: drv, meta: { requestId: 'req_drv_detail' } });
  }),

  // Driver Approval / Rejection / Resubmission / Suspension
  http.patch('/api/v1/admin/drivers/:driverId/approval', async ({ params, request }) => {
    const body = (await request.json()) as { approvalStatus: string; reasonCode?: string; notes?: string };
    mockDrivers = mockDrivers.map((d) => (d.id === params.driverId ? { ...d, approvalStatus: body.approvalStatus as any } : d));
    return HttpResponse.json({ success: true, data: { updated: true, approvalStatus: body.approvalStatus }, meta: { requestId: 'req_drv_appr' } });
  }),

  // Presigned document preview URL
  http.get('/api/v1/admin/drivers/:driverId/documents/:docId/url', ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: {
        url: `https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&q=80&w=800&id=${params.docId}`,
        expiresInSeconds: 300,
      },
      meta: { requestId: 'req_doc_url' },
    });
  }),

  // Expiring Documents Query (within 30 days)
  http.get('/api/v1/admin/drivers/documents/expiring', () => {
    const now = Date.now();
    const threshold = now + 86400000 * 30;
    const expiring = mockDrivers.flatMap((d) =>
      d.documents
        .filter((doc) => new Date(doc.expiresAt).getTime() <= threshold)
        .map((doc) => ({
          ...doc,
          driverName: d.name,
          phoneMasked: d.phoneMasked,
          daysLeft: Math.ceil((new Date(doc.expiresAt).getTime() - now) / 86400000),
        }))
    );

    return HttpResponse.json({ success: true, data: expiring, meta: { requestId: 'req_exp_docs' } });
  }),

  // Vehicles Registry
  http.get('/api/v1/admin/vehicles', () => {
    return HttpResponse.json({ success: true, data: mockVehicles, meta: { requestId: 'req_veh_list' } });
  }),

  // Vehicle Verification Action
  http.patch('/api/v1/admin/vehicles/:vehicleId/verification', async ({ params, request }) => {
    const body = (await request.json()) as { status: string; reasonCode?: string };
    mockVehicles = mockVehicles.map((v) => (v.id === params.vehicleId ? { ...v, verificationStatus: body.status as any } : v));
    return HttpResponse.json({ success: true, data: { status: body.status }, meta: { requestId: 'req_veh_appr' } });
  }),

  // Cab Categories CRUD
  http.get('/api/v1/admin/cab-categories', () => {
    return HttpResponse.json({ success: true, data: mockCategories, meta: { requestId: 'req_cat_list' } });
  }),

  http.post('/api/v1/admin/cab-categories', async ({ request }) => {
    const body = (await request.json()) as Partial<CabCategory>;
    const created: CabCategory = {
      id: `cat_${Date.now()}`,
      code: body.code || 'CUSTOM',
      name: body.name || 'Custom Category',
      capacity: body.capacity || 4,
      active: body.active ?? true,
      displayOrder: mockCategories.length + 1,
      fareConfigRef: body.fareConfigRef || 'fc_custom',
    };
    mockCategories.push(created);
    return HttpResponse.json({ success: true, data: created, meta: { requestId: 'req_cat_post' } });
  }),

  http.patch('/api/v1/admin/cab-categories/:categoryId', async ({ params, request }) => {
    const body = (await request.json()) as Partial<CabCategory>;
    mockCategories = mockCategories.map((c) => (c.id === params.categoryId ? { ...c, ...body } : c));
    return HttpResponse.json({ success: true, data: { updated: true }, meta: { requestId: 'req_cat_patch' } });
  }),
];
