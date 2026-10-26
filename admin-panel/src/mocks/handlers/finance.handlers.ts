import { http, HttpResponse } from 'msw';
import {
  PaymentAttempt,
  GatewayReconciliationItem,
  CashCollectionDiscrepancy,
  OutstandingBalanceItem,
  SettlementBatch,
  LedgerEntry,
} from '@/types';

let mockPayments: PaymentAttempt[] = [
  {
    paymentId: 'pay_local_10001',
    rideId: 'ride_10001',
    bookingId: 'bk_10001',
    customerId: 'usr_cust_03',
    customerName: 'Ananya Roy',
    customerPhoneMasked: '+91 ••••• •7712',
    amountPaise: 37200,
    currency: 'INR',
    method: 'ONLINE',
    provider: 'RAZORPAY',
    status: 'PAID',
    providerOrderId: 'order_rzp_9921',
    providerPaymentId: 'pay_rzp_1189',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    paymentId: 'pay_local_10002',
    rideId: 'ride_10002',
    bookingId: 'bk_10002',
    customerId: 'usr_cust_04',
    customerName: 'Rohan Mehra',
    customerPhoneMasked: '+91 ••••• •1190',
    amountPaise: 26650,
    currency: 'INR',
    method: 'ONLINE',
    provider: 'RAZORPAY',
    status: 'PAID',
    providerOrderId: 'order_rzp_8812',
    providerPaymentId: 'pay_rzp_4401',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    paymentId: 'pay_local_10003',
    rideId: 'ride_10003',
    bookingId: 'bk_10003',
    customerId: 'usr_cust_05',
    customerName: 'Vikram Seth',
    customerPhoneMasked: '+91 ••••• •2290',
    amountPaise: 1250000, // Rs 12,500.00 (triggers high-risk MFA confirmation)
    currency: 'INR',
    method: 'ONLINE',
    provider: 'RAZORPAY',
    status: 'PAID',
    providerOrderId: 'order_rzp_7711',
    providerPaymentId: 'pay_rzp_9902',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

let mockReconciliations: GatewayReconciliationItem[] = [
  {
    id: 'rec_01',
    paymentId: 'pay_local_10004',
    providerPaymentId: 'pay_rzp_ghost_88',
    providerOrderId: 'order_rzp_6612',
    systemAmountPaise: 42000,
    gatewayAmountPaise: 42000,
    discrepancyType: 'DELAYED_WEBHOOK',
    status: 'FLAGGED',
    detectedAt: new Date(Date.now() - 14400000).toISOString(),
  },
  {
    id: 'rec_02',
    paymentId: 'pay_local_10005',
    providerPaymentId: 'pay_rzp_orphan_99',
    providerOrderId: 'order_rzp_4410',
    systemAmountPaise: 0,
    gatewayAmountPaise: 35000,
    discrepancyType: 'ORPHANED_GATEWAY_CHARGE',
    status: 'FLAGGED',
    detectedAt: new Date(Date.now() - 28800000).toISOString(),
  },
];

let mockCashDiscrepancies: CashCollectionDiscrepancy[] = [
  {
    id: 'cash_disc_01',
    rideId: 'ride_10006',
    driverId: 'drv_101',
    driverName: 'Rajesh Kumar Verma',
    driverPhoneMasked: '+91 ••••• •3421',
    expectedFarePaise: 45000,
    reportedCollectedPaise: 40000,
    differencePaise: 5000, // Short collected by Rs 50
    status: 'PENDING_REVIEW',
    reportedAt: new Date(Date.now() - 18000000).toISOString(),
  },
];

let mockOutstanding: OutstandingBalanceItem[] = [
  {
    rideId: 'ride_10007',
    customerId: 'usr_cust_06',
    customerName: 'Aakash Verma',
    customerPhoneMasked: '+91 ••••• •8819',
    amountDuePaise: 52000,
    status: 'DUE',
    bookingRestriction: 'PAYMENT_REQUIRED',
    completedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    rideId: 'ride_10008',
    customerId: 'usr_cust_07',
    customerName: 'Karan Johar',
    customerPhoneMasked: '+91 ••••• •1280',
    amountDuePaise: 29000,
    status: 'DISPUTED',
    bookingRestriction: 'RESTRICTED',
    completedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
];

let mockSettlements: SettlementBatch[] = [
  {
    batchId: 'st_batch_2026_w42',
    period: '12 Oct 2026 - 18 Oct 2026',
    driverCount: 148,
    totalGrossPaise: 42500000,
    totalCommissionPaise: 4250000, // 10%
    totalNetPayablePaise: 38250000,
    status: 'PROCESSED',
    processedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
];

let mockLedger: LedgerEntry[] = [
  {
    entryId: 'led_001',
    ownerType: 'DRIVER',
    ownerId: 'drv_101',
    ownerName: 'Rajesh Kumar Verma',
    rideId: 'ride_10002',
    entryType: 'DRIVER_EARNING_PAYABLE',
    direction: 'CREDIT',
    amountPaise: 23985,
    reasonCode: 'RIDE_COMPLETION_FARE',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    entryId: 'led_002',
    ownerType: 'DRIVER',
    ownerId: 'drv_101',
    ownerName: 'Rajesh Kumar Verma',
    rideId: 'ride_10002',
    entryType: 'PLATFORM_COMMISSION_REVENUE',
    direction: 'DEBIT',
    amountPaise: 2665,
    reasonCode: 'PLATFORM_COMMISSION_10_PCT',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

export const financeHandlers = [
  // Payments List
  http.get('/api/v1/admin/payments', () => {
    return HttpResponse.json({ success: true, data: mockPayments, meta: { requestId: 'req_pay_list' } });
  }),

  // Manual Refund Trigger (Idempotent)
  http.post('/api/v1/admin/payments/:paymentId/refund', async ({ params, request }) => {
    const body = (await request.json()) as { amountPaise: number; reasonCode: string; notes?: string };
    mockPayments = mockPayments.map((p) => (p.paymentId === params.paymentId ? { ...p, status: 'REFUNDED' } : p));
    return HttpResponse.json({
      success: true,
      data: { refunded: true, paymentId: params.paymentId, amountPaise: body.amountPaise },
      meta: { requestId: 'req_refund_ok' },
    });
  }),

  // Gateway Reconciliation List
  http.get('/api/v1/admin/payments/reconciliation', () => {
    return HttpResponse.json({ success: true, data: mockReconciliations, meta: { requestId: 'req_rec_list' } });
  }),

  // Cash Collections List
  http.get('/api/v1/admin/cash-collections', () => {
    return HttpResponse.json({ success: true, data: mockCashDiscrepancies, meta: { requestId: 'req_cash_list' } });
  }),

  // Cash Discrepancy Resolution
  http.post('/api/v1/admin/cash-collections/:id/resolve', async ({ params, request }) => {
    const body = (await request.json()) as { action: string; reasonCode: string; notes?: string };
    mockCashDiscrepancies = mockCashDiscrepancies.map((c) =>
      c.id === params.id ? { ...c, status: body.action as any } : c
    );
    return HttpResponse.json({ success: true, data: { resolved: true }, meta: { requestId: 'req_cash_res' } });
  }),

  // Global Outstanding Balances List
  http.get('/api/v1/admin/outstanding', () => {
    return HttpResponse.json({ success: true, data: mockOutstanding, meta: { requestId: 'req_out_list' } });
  }),

  // Dispute Logging
  http.post('/api/v1/admin/outstanding/:rideId/dispute', ({ params }) => {
    mockOutstanding = mockOutstanding.map((o) => (o.rideId === params.rideId ? { ...o, status: 'DISPUTED' } : o));
    return HttpResponse.json({ success: true, data: { disputed: true }, meta: { requestId: 'req_disp_log' } });
  }),

  // SUPER_ADMIN Write-Off
  http.post('/api/v1/admin/outstanding/:rideId/write-off', async ({ params, request }) => {
    const body = (await request.json()) as { reasonCode: string; notes?: string };
    mockOutstanding = mockOutstanding.map((o) => (o.rideId === params.rideId ? { ...o, status: 'WRITTEN_OFF' } : o));
    return HttpResponse.json({ success: true, data: { writtenOff: true }, meta: { requestId: 'req_writeoff' } });
  }),

  // Settlements List
  http.get('/api/v1/admin/settlements', () => {
    return HttpResponse.json({ success: true, data: mockSettlements, meta: { requestId: 'req_st_list' } });
  }),

  // Settlement Batch Trigger (Idempotent)
  http.post('/api/v1/admin/settlements/run', () => {
    const newBatch: SettlementBatch = {
      batchId: `st_batch_${Date.now()}`,
      period: 'Current Running Settlement Cycle',
      driverCount: 42,
      totalGrossPaise: 12500000,
      totalCommissionPaise: 1250000,
      totalNetPayablePaise: 11250000,
      status: 'PROCESSED',
      processedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    mockSettlements.unshift(newBatch);
    return HttpResponse.json({ success: true, data: newBatch, meta: { requestId: 'req_st_run' } });
  }),

  // Ledger Entries View
  http.get('/api/v1/admin/ledger/entries', () => {
    return HttpResponse.json({ success: true, data: mockLedger, meta: { requestId: 'req_led_list' } });
  }),

  // Manual Append-Only Ledger Adjustment
  http.post('/api/v1/admin/ledger/adjustments', async ({ request }) => {
    const body = (await request.json()) as {
      ownerType: 'DRIVER' | 'CUSTOMER';
      ownerId: string;
      rideId?: string;
      amountPaise: number;
      direction: 'CREDIT' | 'DEBIT';
      reasonCode: string;
      notes?: string;
    };

    const entry: LedgerEntry = {
      entryId: `led_${Date.now()}`,
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      ownerName: body.ownerType === 'DRIVER' ? 'Rajesh Kumar Verma' : 'Aakash Verma',
      rideId: body.rideId,
      entryType: body.ownerType === 'DRIVER' ? 'DRIVER_EARNING_PAYABLE' : 'CUSTOMER_FARE_RECEIVABLE',
      direction: body.direction,
      amountPaise: body.amountPaise,
      reasonCode: body.reasonCode,
      notes: body.notes,
      createdAt: new Date().toISOString(),
    };

    mockLedger.unshift(entry);
    return HttpResponse.json({ success: true, data: entry, meta: { requestId: 'req_adj_post' } });
  }),
];