import { http, HttpResponse } from 'msw';
import { ServiceZone, PricingConfig, ScheduledRide } from '@/types';

let mockZones: ServiceZone[] = [
  {
    id: 'zone_central_delhi',
    name: 'Central Delhi Core',
    cityId: 'city_delhi',
    cityName: 'New Delhi',
    polygon: [
      [28.6500, 77.2000],
      [28.6500, 77.2400],
      [28.6000, 77.2400],
      [28.6000, 77.2000],
    ],
    active: true,
    operatingHours: { start: '00:00', end: '23:59' },
    createdAt: new Date(Date.now() - 86400000 * 45).toISOString(),
  },
  {
    id: 'zone_airport_aerocity',
    name: 'IGI Airport & Aerocity',
    cityId: 'city_delhi',
    cityName: 'New Delhi',
    polygon: [
      [28.5700, 77.0800],
      [28.5700, 77.1300],
      [28.5300, 77.1300],
      [28.5300, 77.0800],
    ],
    active: true,
    operatingHours: { start: '00:00', end: '23:59' },
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
];

let mockPricingConfigs: PricingConfig[] = [
  {
    id: 'pc_sedan_v12',
    name: 'Delhi Sedan Standard Tariff',
    cityId: 'city_delhi',
    zoneId: 'zone_central_delhi',
    zoneName: 'Central Delhi Core',
    categoryId: 'cat_sedan',
    categoryName: 'Sedan Prime',
    version: 12,
    effectiveFrom: new Date(Date.now() - 86400000 * 10).toISOString(),
    baseFarePaise: 4000, // Rs 40.00
    perKmPaise: 1400,    // Rs 14.00
    perMinutePaise: 150, // Rs 1.50
    minimumFarePaise: 10000, // Rs 100.00
    freeWaitingSeconds: 180,
    waitingPerMinutePaise: 200, // Rs 2.00
    demandMultiplierMin: 1.0,
    demandMultiplierMax: 1.5,
    roundingMode: 'NEAREST_RUPEE',
    isActive: true,
    changeReason: 'Q4 Fuel Adjustment Baseline',
  },
  {
    id: 'pc_mini_v08',
    name: 'Delhi Mini Economical Tariff',
    cityId: 'city_delhi',
    zoneId: 'zone_central_delhi',
    zoneName: 'Central Delhi Core',
    categoryId: 'cat_mini',
    categoryName: 'Mini Hatchback',
    version: 8,
    effectiveFrom: new Date(Date.now() - 86400000 * 15).toISOString(),
    baseFarePaise: 3000,
    perKmPaise: 1100,
    perMinutePaise: 120,
    minimumFarePaise: 7500,
    freeWaitingSeconds: 180,
    waitingPerMinutePaise: 150,
    demandMultiplierMin: 1.0,
    demandMultiplierMax: 1.4,
    roundingMode: 'NEAREST_RUPEE',
    isActive: true,
    changeReason: 'Launch Pricing',
  },
];

let mockScheduledRides: ScheduledRide[] = [
  {
    id: 'sch_9001',
    customerId: 'usr_cust_11',
    customerName: 'Anil Kapoor',
    customerPhoneMasked: '+91 ••••• •8821',
    categoryId: 'cat_sedan',
    categoryName: 'Sedan Prime',
    pickup: { label: 'Vasant Vihar, Block C', lat: 28.5600, lng: 77.1600 },
    drop: { label: 'Terminal 3, IGI Airport', lat: 28.5562, lng: 77.1000 },
    scheduledTime: new Date(Date.now() + 86400000 * 2).toISOString(),
    allocationWindowMinutes: 30,
    status: 'SCHEDULED',
    estimatedFarePaise: 42000,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'sch_9002',
    customerId: 'usr_cust_12',
    customerName: 'Suman Sen',
    customerPhoneMasked: '+91 ••••• •3312',
    categoryId: 'cat_suv',
    categoryName: 'SUV XL',
    pickup: { label: 'Greater Kailash 1', lat: 28.5400, lng: 77.2300 },
    drop: { label: 'New Delhi Railway Station', lat: 28.6420, lng: 77.2200 },
    scheduledTime: new Date(Date.now() + 86400000 * 1).toISOString(),
    allocationWindowMinutes: 45,
    status: 'SCHEDULED',
    estimatedFarePaise: 68000,
    createdAt: new Date().toISOString(),
  },
];

export const pricingHandlers = [
  // List Zones
  http.get('/api/v1/admin/zones', () => {
    return HttpResponse.json({ success: true, data: mockZones, meta: { requestId: 'req_zones' } });
  }),

  // Create Zone
  http.post('/api/v1/admin/zones', async ({ request }) => {
    const body = (await request.json()) as Partial<ServiceZone>;
    const created: ServiceZone = {
      id: `zone_${Date.now()}`,
      name: body.name || 'New City Zone',
      cityId: body.cityId || 'city_delhi',
      cityName: body.cityName || 'New Delhi',
      polygon: body.polygon || [
        [28.61, 77.20],
        [28.61, 77.22],
        [28.59, 77.22],
        [28.59, 77.20],
      ],
      active: true,
      operatingHours: body.operatingHours || { start: '00:00', end: '23:59' },
      createdAt: new Date().toISOString(),
    };
    mockZones.push(created);
    return HttpResponse.json({ success: true, data: created, meta: { requestId: 'req_zone_add' } });
  }),

  // Toggle/Update Zone
  http.patch('/api/v1/admin/zones/:zoneId', async ({ params, request }) => {
    const body = (await request.json()) as Partial<ServiceZone>;
    mockZones = mockZones.map((z) => (z.id === params.zoneId ? { ...z, ...body } : z));
    return HttpResponse.json({ success: true, data: { updated: true }, meta: { requestId: 'req_zone_patch' } });
  }),

  // List Fare Configs
  http.get('/api/v1/admin/pricing/configs', () => {
    return HttpResponse.json({ success: true, data: mockPricingConfigs, meta: { requestId: 'req_configs' } });
  }),

  // Create Versioned Fare Config (Spec B §9.1)
  http.post('/api/v1/admin/pricing/configs', async ({ request }) => {
    const body = (await request.json()) as Partial<PricingConfig>;
    const created: PricingConfig = {
      id: `pc_${Date.now()}`,
      name: body.name || 'Custom Tariff',
      cityId: body.cityId || 'city_delhi',
      zoneId: body.zoneId || 'zone_central_delhi',
      zoneName: 'Central Delhi Core',
      categoryId: body.categoryId || 'cat_sedan',
      categoryName: 'Sedan Prime',
      version: mockPricingConfigs.length + 1,
      effectiveFrom: body.effectiveFrom || new Date().toISOString(),
      baseFarePaise: body.baseFarePaise || 4000,
      perKmPaise: body.perKmPaise || 1400,
      perMinutePaise: body.perMinutePaise || 150,
      minimumFarePaise: body.minimumFarePaise || 10000,
      freeWaitingSeconds: body.freeWaitingSeconds || 180,
      waitingPerMinutePaise: body.waitingPerMinutePaise || 200,
      demandMultiplierMin: body.demandMultiplierMin || 1.0,
      demandMultiplierMax: body.demandMultiplierMax || 1.5,
      roundingMode: 'NEAREST_RUPEE',
      isActive: true,
      changeReason: body.changeReason || 'Administrative update',
    };
    mockPricingConfigs.push(created);
    return HttpResponse.json({ success: true, data: created, meta: { requestId: 'req_cfg_create' } });
  }),

  // Server-side Pricing Preview Calculator
  http.post('/api/v1/admin/pricing/preview', async ({ request }) => {
    const body = (await request.json()) as { distanceMeters: number; durationSeconds: number; configId: string };
    const cfg = mockPricingConfigs.find((c) => c.id === body.configId) || mockPricingConfigs[0];

    const km = body.distanceMeters / 1000;
    const mins = body.durationSeconds / 60;
    const distanceFare = Math.round(km * cfg.perKmPaise);
    const timeFare = Math.round(mins * cfg.perMinutePaise);
    const total = Math.max(cfg.baseFarePaise + distanceFare + timeFare, cfg.minimumFarePaise);

    return HttpResponse.json({
      success: true,
      data: {
        configVersion: cfg.version,
        breakdown: {
          baseFarePaise: cfg.baseFarePaise,
          distanceFarePaise: distanceFare,
          timeFarePaise: timeFare,
          estimatedTotalPaise: total,
        },
      },
      meta: { requestId: 'req_calc_preview' },
    });
  }),

  // List Scheduled Rides
  http.get('/api/v1/admin/scheduled-rides', () => {
    return HttpResponse.json({ success: true, data: mockScheduledRides, meta: { requestId: 'req_sch_list' } });
  }),

  // Cancel Scheduled Ride
  http.post('/api/v1/scheduled-rides/:id/cancel', ({ params }) => {
    mockScheduledRides = mockScheduledRides.map((s) => (s.id === params.id ? { ...s, status: 'CANCELLED' } : s));
    return HttpResponse.json({ success: true, data: { cancelled: true }, meta: { requestId: 'req_sch_cancel' } });
  }),
];