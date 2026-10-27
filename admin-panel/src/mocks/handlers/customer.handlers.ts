import { http, HttpResponse } from 'msw';
import { CustomerDetail } from '@/types';

const mockCustomers: (CustomerDetail & { restrictionReason?: string })[] = [
  {
    userId: 'usr_cust_01',
    role: 'CUSTOMER',
    name: 'Aarav Sharma',
    phone: '+919810012345',
    accountStatus: 'ACTIVE',
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    phoneVerifiedAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    liveSessions: 1,
    bookingCount: 24,
    totalSpentPaise: 485000,
    walletBalancePaise: 25000,
    bookingRestriction: null,
  },
  {
    userId: 'usr_cust_02',
    role: 'CUSTOMER',
    name: 'Priya Patel',
    phone: '+919820067890',
    accountStatus: 'ACTIVE',
    createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
    phoneVerifiedAt: new Date(Date.now() - 86400000 * 15).toISOString(),
    liveSessions: 1,
    bookingCount: 8,
    totalSpentPaise: 162000,
    walletBalancePaise: 0,
    bookingRestriction: 'PAYMENT_REQUIRED',
    restrictionReason: 'Unpaid completed ride older than 24 hours',
  },
  {
    userId: 'usr_cust_03',
    role: 'CUSTOMER',
    name: 'Ananya Roy',
    phone: '+919830077123',
    accountStatus: 'ACTIVE',
    createdAt: new Date(Date.now() - 86400000 * 60).toISOString(),
    phoneVerifiedAt: new Date(Date.now() - 86400000 * 60).toISOString(),
    liveSessions: 0,
    bookingCount: 42,
    totalSpentPaise: 940000,
    walletBalancePaise: 50000,
    bookingRestriction: null,
  },
  {
    userId: 'usr_cust_04',
    role: 'CUSTOMER',
    name: 'Rohan Mehra',
    phone: '+919840011902',
    accountStatus: 'SUSPENDED',
    createdAt: new Date(Date.now() - 86400000 * 45).toISOString(),
    phoneVerifiedAt: new Date(Date.now() - 86400000 * 45).toISOString(),
    liveSessions: 0,
    bookingCount: 5,
    totalSpentPaise: 75000,
    walletBalancePaise: 0,
    bookingRestriction: 'RESTRICTED',
    restrictionReason: 'Multiple abusive cancellations flagged by operations',
  },
];

export const customerHandlers = [
  // List customers
  http.get('*/admin/users', ({ request }) => {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const q = url.searchParams.get('q')?.toLowerCase();
    const status = url.searchParams.get('accountStatus');

    if (role && role !== 'CUSTOMER') {
      return HttpResponse.json({
        success: true,
        data: { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
        meta: { requestId: 'req_cust_mock' },
      });
    }

    let filtered = [...mockCustomers];
    if (status) {
      filtered = filtered.filter((c) => c.accountStatus === status);
    }
    if (q) {
      filtered = filtered.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          c.userId.toLowerCase().includes(q)
      );
    }

    return HttpResponse.json({
      success: true,
      data: {
        items: filtered,
        meta: { page: 1, limit: 20, total: filtered.length, totalPages: 1 },
      },
      meta: { requestId: 'req_cust_list' },
    });
  }),

  // Customer Detail
  http.get('*/admin/users/:userId', ({ params }) => {
    const { userId } = params;
    const customer = mockCustomers.find((c) => c.userId === userId);
    if (!customer) {
      return HttpResponse.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Customer account not found', requestId: 'err_cust_404' },
        },
        { status: 404 }
      );
    }
    return HttpResponse.json({
      success: true,
      data: customer,
      meta: { requestId: 'req_cust_detail' },
    });
  }),

  // Toggle user status (suspend/activate)
  http.patch('*/admin/users/:userId/status', async ({ params, request }) => {
    const { userId } = params;
    const body = (await request.json()) as { status: 'ACTIVE' | 'SUSPENDED'; reason: string };
    const customer = mockCustomers.find((c) => c.userId === userId);
    if (customer) {
      customer.accountStatus = body.status;
    }
    return HttpResponse.json({
      success: true,
      data: { userId, accountStatus: body.status },
      meta: { requestId: 'req_cust_status' },
    });
  }),

  // Set booking restriction
  http.post('*/admin/customers/:customerId/restrictions', async ({ params, request }) => {
    const { customerId } = params;
    const body = (await request.json()) as { action: 'RESTRICT' | 'LIFT'; reason: string };
    const customer = mockCustomers.find((c) => c.userId === customerId);
    if (customer) {
      customer.bookingRestriction = body.action === 'RESTRICT' ? 'RESTRICTED' : null;
      customer.restrictionReason = body.action === 'RESTRICT' ? body.reason : undefined;
    }
    return HttpResponse.json({
      success: true,
      data: {
        customerId,
        bookingRestriction: customer?.bookingRestriction ?? null,
      },
      meta: { requestId: 'req_cust_restr' },
    });
  }),
];
