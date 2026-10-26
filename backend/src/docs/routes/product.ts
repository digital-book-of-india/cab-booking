import type { RouteDoc } from '../routes';

const REVIEW = ['OPS', 'SUPER_ADMIN'];
const OPS_SUPPORT = ['OPS', 'SUPPORT', 'SUPER_ADMIN'];

/**
 * DEV 2 mandatory route contracts (Product, Customer & Admin).
 * Single source of truth for:
 * - Feature 1: Customer Saved Places (CRUD)
 * - Feature 2: Customer Referrals
 * - Feature 3: Admin Booking Restrictions
 * - Feature 4: Admin Test Notification
 * - Feature 5: Admin Live-Driver Feed
 * - Feature 6: Admin Dispatch Queue
 * - Feature 7: Manual Driver Assignment
 */
export const productRoutes: RouteDoc[] = [
  // ---------------- FEATURE 1: CUSTOMER SAVED PLACES ----------------
  {
    method: 'get',
    path: '/customers/me/places',
    tag: 'Customers',
    summary: 'List own saved places (home, work, other)',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/customers/me/places',
    tag: 'Customers',
    summary: 'Create a saved place (enforces configurable limit, valid coordinates)',
    auth: ['CUSTOMER'],
    body: {
      name: 'My Home',
      type: 'home',
      address: 'B-12 Connaught Place, New Delhi',
      lat: 28.6315,
      lng: 77.2167,
    },
    postmanTest: "pm.collectionVariables.set('placeId', pm.response.json().data.id);",
  },
  {
    method: 'patch',
    path: '/customers/me/places/{placeId}',
    tag: 'Customers',
    summary: 'Update own saved place',
    auth: ['CUSTOMER'],
    body: {
      name: 'Home Office',
      address: 'Flat 402, Block C, Connaught Place, New Delhi',
      lat: 28.632,
      lng: 77.217,
    },
  },
  {
    method: 'delete',
    path: '/customers/me/places/{placeId}',
    tag: 'Customers',
    summary: 'Delete own saved place',
    auth: ['CUSTOMER'],
  },

  // ---------------- FEATURE 2: CUSTOMER REFERRALS ----------------
  {
    method: 'get',
    path: '/customers/me/referrals',
    tag: 'Customers',
    summary: 'Get unique referral code, shareable link, referral stats and reward history',
    auth: ['CUSTOMER'],
  },
  {
    method: 'post',
    path: '/customers/me/referrals/claim',
    tag: 'Customers',
    summary: 'Apply a referral code to receive referral coupon reward',
    auth: ['CUSTOMER'],
    body: {
      code: 'REF-123456',
    },
  },

  // ---------------- FEATURE 3: ADMIN BOOKING RESTRICTIONS ----------------
  {
    method: 'post',
    path: '/admin/customers/{customerId}/restrictions',
    tag: 'Admin',
    summary: 'Apply or lift a booking restriction on a customer (mandatory reason, audited)',
    auth: REVIEW,
    body: {
      action: 'RESTRICT',
      reason: 'Repeated cancellation fraud observed in sector 14',
    },
  },

  // ---------------- FEATURE 4: ADMIN TEST NOTIFICATION ----------------
  {
    method: 'post',
    path: '/admin/notifications/test',
    tag: 'Notifications',
    summary: 'Send an audited test push or SMS notification to a specific eligible recipient',
    auth: REVIEW,
    body: {
      channel: 'push',
      recipientId: '507f1f77bcf86cd799439011',
      title: 'Test Notification',
      body: 'This is a test notification from operations staff.',
    },
  },

  // ---------------- FEATURE 5: ADMIN LIVE-DRIVER FEED ----------------
  {
    method: 'get',
    path: '/admin/drivers/live',
    tag: 'Operations',
    summary: 'Live map feed of online and on-ride drivers within bounding box or zone (audited)',
    auth: OPS_SUPPORT,
    query: {
      minLat: '28.40',
      maxLat: '28.88',
      minLng: '76.84',
      maxLng: '77.55',
      limit: '50',
    },
  },

  // ---------------- FEATURE 6: ADMIN DISPATCH QUEUE ----------------
  {
    method: 'get',
    path: '/admin/dispatch/queue',
    tag: 'Dispatch',
    summary: 'List bookings awaiting driver assignment with server-calculated waiting duration',
    auth: OPS_SUPPORT,
    query: { page: '1', limit: '20' },
  },

  // ---------------- FEATURE 7: MANUAL DRIVER ASSIGNMENT ----------------
  {
    method: 'post',
    path: '/admin/bookings/{bookingId}/assign-driver',
    tag: 'Dispatch',
    summary:
      'Manually assign or reassign an eligible driver to a booking with atomic conditional claim (audited)',
    auth: REVIEW,
    body: {
      driverId: '507f1f77bcf86cd799439022',
      reason: 'Customer VIP request / dispatch timeout rescue',
    },
  },
];
