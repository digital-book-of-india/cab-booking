import { http, HttpResponse } from 'msw';
import {
  SosIncident,
  SupportTicket,
  ReviewRatingItem,
  CorporateAccount,
  CorporateInvoice,
  CouponItem,
} from '@/types';

let mockIncidents: SosIncident[] = [
  {
    incidentId: 'sos_inc_901',
    rideId: 'ride_10001',
    customerId: 'usr_cust_03',
    customerName: 'Ananya Roy',
    customerPhoneMasked: '+91 ••••• •7712',
    driverId: 'drv_102',
    driverName: 'Amit Sharma',
    driverPhoneMasked: '+91 ••••• •9812',
    vehicleRegistration: 'DL 2C B 8821',
    vehicleModel: 'Hyundai Aura',
    currentLat: 28.5921,
    currentLng: 77.1754,
    emergencyContacts: [
      { name: 'Sunil Roy (Father)', phone: '+91 98110 22331', relation: 'Father' },
      { name: 'Ritu Roy (Mother)', phone: '+91 98110 44552', relation: 'Mother' },
    ],
    status: 'OPEN',
    triggeredAt: new Date(Date.now() - 480000).toISOString(),
  },
];

let mockTickets: SupportTicket[] = [
  {
    ticketId: 'tkt_8001',
    customerId: 'usr_cust_04',
    customerName: 'Rohan Mehra',
    customerPhoneMasked: '+91 ••••• •1190',
    rideId: 'ride_10002',
    category: 'FARE_DISPUTE',
    status: 'OPEN',
    subject: 'Incorrect toll charges applied on airport link',
    assignedTo: 'Support Agent - Swati',
    messages: [
      { id: 'msg_01', sender: 'CUSTOMER', senderName: 'Rohan Mehra', message: 'I was charged an extra ₹150 for toll, but the driver took an open toll road.', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: 'msg_02', sender: 'SUPPORT_AGENT', senderName: 'Swati Jain', message: 'Hello Rohan, we are inspecting the GPS track against municipal toll coordinates.', timestamp: new Date(Date.now() - 1800000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
  },
];

let mockRatings: ReviewRatingItem[] = [
  {
    ratingId: 'rat_7001',
    rideId: 'ride_10002',
    raterRole: 'CUSTOMER',
    raterName: 'Rohan Mehra',
    targetName: 'Rajesh Kumar Verma',
    stars: 2,
    comment: 'Driver was constantly on phone call and driving aggressively.',
    flagged: true,
    moderationStatus: 'PENDING_REVIEW',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    ratingId: 'rat_7002',
    rideId: 'ride_10001',
    raterRole: 'CUSTOMER',
    raterName: 'Ananya Roy',
    targetName: 'Amit Sharma',
    stars: 5,
    comment: 'Punctual, polite and smooth driving experience.',
    flagged: false,
    moderationStatus: 'APPROVED',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

let mockCorporates: CorporateAccount[] = [
  {
    id: 'corp_601',
    companyName: 'Zomato Operations Delhi NCR',
    contactEmail: 'fleet-admin@zomato.internal',
    contactPhoneMasked: '+91 ••••• •9900',
    gstNumber: '07AAAAZ0000A1Z5',
    monthlyCreditLimitPaise: 50000000, // ₹5,00,000
    currentOutstandingPaise: 14250000,
    status: 'APPROVED',
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
  {
    id: 'corp_602',
    companyName: 'Blinkit Last-Mile Hub Gurgaon',
    contactEmail: 'travel@blinkit.internal',
    contactPhoneMasked: '+91 ••••• •8820',
    gstNumber: '06AAACB9999C1Z2',
    monthlyCreditLimitPaise: 25000000,
    currentOutstandingPaise: 0,
    status: 'PENDING_APPROVAL',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

const mockInvoices: CorporateInvoice[] = [
  {
    invoiceId: 'inv_oct_2026_01',
    corporateAccountId: 'corp_601',
    companyName: 'Zomato Operations Delhi NCR',
    billingMonth: 'October 2026',
    totalRides: 482,
    totalBilledPaise: 14250000,
    taxPaise: 712500,
    paymentStatus: 'DUE',
    issuedAt: new Date().toISOString(),
  },
];

const mockCoupons: CouponItem[] = [
  {
    id: 'coup_01',
    code: 'FESTIVE50',
    discountType: 'PERCENTAGE',
    discountValue: 25,
    maxDiscountPaise: 10000, // ₹100 max
    validFrom: new Date(Date.now() - 86400000 * 5).toISOString(),
    validTo: new Date(Date.now() + 86400000 * 25).toISOString(),
    totalRedemptions: 894,
    maxRedemptionsLimit: 5000,
    active: true,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'coup_02',
    code: 'AIRPORTFLAT',
    discountType: 'FLAT_PAISE',
    discountValue: 15000, // ₹150 flat
    validFrom: new Date(Date.now() - 86400000 * 10).toISOString(),
    validTo: new Date(Date.now() + 86400000 * 20).toISOString(),
    totalRedemptions: 120,
    maxRedemptionsLimit: 1000,
    active: true,
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
];

export const operationsHandlers = [
  // SOS Incident Stream
  http.get('/api/v1/admin/sos', () => {
    return HttpResponse.json({ success: true, data: mockIncidents, meta: { requestId: 'req_sos_list' } });
  }),

  // Resolve SOS Incident
  http.post('/api/v1/admin/sos/:incidentId/resolve', async ({ params, request }) => {
    const body = (await request.json()) as { resolutionCategory: SosIncident['resolutionCategory']; resolutionSummary: string };
    mockIncidents = mockIncidents.map((inc) =>
      inc.incidentId === params.incidentId
        ? {
            ...inc,
            status: 'RESOLVED',
            resolutionCategory: body.resolutionCategory,
            resolutionSummary: body.resolutionSummary,
            resolvedAt: new Date().toISOString(),
          }
        : inc
    );
    return HttpResponse.json({ success: true, data: { resolved: true }, meta: { requestId: 'req_sos_res' } });
  }),

  // Support Tickets
  http.get('/api/v1/support/tickets', () => {
    return HttpResponse.json({ success: true, data: mockTickets, meta: { requestId: 'req_tkt_list' } });
  }),

  http.post('/api/v1/support/tickets/:ticketId/messages', async ({ params, request }) => {
    const body = (await request.json()) as { message: string };
    const newMessage = {
      id: `msg_${Date.now()}`,
      sender: 'SUPPORT_AGENT' as const,
      senderName: 'Support Desk Lead',
      message: body.message,
      timestamp: new Date().toISOString(),
    };
    mockTickets = mockTickets.map((t) =>
      t.ticketId === params.ticketId ? { ...t, messages: [...t.messages, newMessage] } : t
    );
    return HttpResponse.json({ success: true, data: newMessage, meta: { requestId: 'req_msg_post' } });
  }),

  // Ratings Moderation
  http.get('/api/v1/admin/ratings', () => {
    return HttpResponse.json({ success: true, data: mockRatings, meta: { requestId: 'req_rat_list' } });
  }),

  http.patch('/api/v1/admin/ratings/:ratingId/moderation', async ({ params, request }) => {
    const body = (await request.json()) as { moderationStatus: ReviewRatingItem['moderationStatus']; reasonCode: string };
    mockRatings = mockRatings.map((r) =>
      r.ratingId === params.ratingId
        ? { ...r, moderationStatus: body.moderationStatus, moderationReason: body.reasonCode }
        : r
    );
    return HttpResponse.json({ success: true, data: { updated: true }, meta: { requestId: 'req_rat_mod' } });
  }),

  // Corporate Accounts
  http.get('/api/v1/admin/corporate/accounts', () => {
    return HttpResponse.json({ success: true, data: mockCorporates, meta: { requestId: 'req_corp_list' } });
  }),

  http.patch('/api/v1/admin/corporate/accounts/:id/approval', async ({ params, request }) => {
    const body = (await request.json()) as { status: CorporateAccount['status']; reasonCode?: string };
    mockCorporates = mockCorporates.map((c) => (c.id === params.id ? { ...c, status: body.status } : c));
    return HttpResponse.json({ success: true, data: { updated: true }, meta: { requestId: 'req_corp_appr' } });
  }),

  http.get('/api/v1/corporate/invoices', () => {
    return HttpResponse.json({ success: true, data: mockInvoices, meta: { requestId: 'req_inv_list' } });
  }),

  // Marketing Coupons
  http.get('/api/v1/admin/coupons', () => {
    return HttpResponse.json({ success: true, data: mockCoupons, meta: { requestId: 'req_coup_list' } });
  }),

  http.post('/api/v1/admin/coupons', async ({ request }) => {
    const body = (await request.json()) as Partial<CouponItem>;
    const created: CouponItem = {
      id: `coup_${Date.now()}`,
      code: body.code?.toUpperCase() || 'CUSTOMCODE',
      discountType: body.discountType || 'PERCENTAGE',
      discountValue: body.discountValue || 10,
      maxDiscountPaise: body.maxDiscountPaise,
      validFrom: new Date().toISOString(),
      validTo: new Date(Date.now() + 86400000 * 30).toISOString(),
      totalRedemptions: 0,
      maxRedemptionsLimit: body.maxRedemptionsLimit || 1000,
      active: true,
      createdAt: new Date().toISOString(),
    };
    mockCoupons.unshift(created);
    return HttpResponse.json({ success: true, data: created, meta: { requestId: 'req_coup_add' } });
  }),

  // Notification Gateway Test
  http.post('/api/v1/admin/notifications/test', async ({ request }) => {
    const body = (await request.json()) as { channel: string; recipient: string; message: string };
    return HttpResponse.json({
      success: true,
      data: {
        messageId: `gw_msg_${Date.now()}`,
        channel: body.channel,
        recipient: body.recipient,
        deliveryStatus: 'DELIVERED',
        gatewayLatencyMs: Math.floor(Math.random() * 45) + 30,
        timestamp: new Date().toISOString(),
      },
      meta: { requestId: 'req_notif_test' },
    });
  }),
];