import { http, HttpResponse } from 'msw';
import { FeatureFlag, RbacUserItem, AuditLogEntry, Role } from '@/types';

let mockFeatureFlags: FeatureFlag[] = [
  {
    key: 'ENABLE_DYNAMIC_SURGE',
    name: 'Dynamic Surge Pricing Engine',
    description: 'Allows algorithm to apply multiplier caps based on zone demand density.',
    enabled: true,
    category: 'DISPATCH',
    lastUpdatedBy: 'Super Admin',
    changeReason: 'Standard active operation baseline',
    updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    key: 'INSTANT_PAYOUT_TRIGGER',
    name: 'Driver Instant Daily Payouts',
    description: 'Allows eligible drivers to request real-time IMPS transfers.',
    enabled: false,
    category: 'PAYMENTS',
    lastUpdatedBy: 'Finance Lead',
    changeReason: 'Pending weekly banking gateway clearance',
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    key: 'SAFETY_AUDIO_RECORDING',
    name: 'In-Trip Emergency Audio Stream',
    description: 'Enables mobile client encrypted audio buffer on SOS trigger.',
    enabled: true,
    category: 'SAFETY',
    lastUpdatedBy: 'Safety Admin',
    changeReason: 'Regulatory compliance requirement',
    updatedAt: new Date(Date.now() - 86400000 * 12).toISOString(),
  },
  {
    key: 'REFERRAL_BONUS_PROGRAM',
    name: 'Customer Referral Bonus',
    description: 'Automatically credits ₹100 discount coupon upon friend’s first completed ride.',
    enabled: true,
    category: 'MARKETING',
    lastUpdatedBy: 'Config Admin',
    changeReason: 'Q4 Festive Campaign',
    updatedAt: new Date(Date.now() - 86400000 * 8).toISOString(),
  },
];

let mockUsers: RbacUserItem[] = [
  { id: 'usr_001', name: 'Krishna Mohan (Lead)', email: 'admin@platform.internal', role: 'SUPER_ADMIN', status: 'ACTIVE', lastLoginAt: new Date().toISOString() },
  { id: 'usr_002', name: 'Ravi Teja', email: 'ops.lead@platform.internal', role: 'OPS', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 'usr_003', name: 'Pooja Hegde', email: 'finance@platform.internal', role: 'FINANCE', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 'usr_004', name: 'Manish Sisodia', email: 'safety@platform.internal', role: 'SAFETY_ADMIN', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'usr_005', name: 'Swati Jain', email: 'support@platform.internal', role: 'SUPPORT', status: 'ACTIVE', lastLoginAt: new Date(Date.now() - 14400000).toISOString() },
];

const mockAuditLogs: AuditLogEntry[] = [
  {
    id: 'aud_9901',
    actorId: 'usr_001',
    actorName: 'Super Admin',
    actorRole: 'SUPER_ADMIN',
    actionCode: 'DRIVER_KYC_APPROVED',
    targetResource: 'DriverProfile',
    targetId: 'drv_102',
    beforeSnapshot: { approvalStatus: 'PENDING' },
    afterSnapshot: { approvalStatus: 'APPROVED' },
    ipAddress: '103.21.144.10',
    timestamp: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'aud_9902',
    actorId: 'usr_002',
    actorName: 'Ravi Teja',
    actorRole: 'OPS',
    actionCode: 'MANUAL_DRIVER_ALLOCATION',
    targetResource: 'Booking',
    targetId: 'bk_2001',
    beforeSnapshot: { status: 'DISPATCHING', assignedDriver: null },
    afterSnapshot: { status: 'DRIVER_ASSIGNED', assignedDriver: 'drv_101', reasonCode: 'DISPATCH_TIMEOUT' },
    ipAddress: '103.21.144.15',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'aud_9903',
    actorId: 'usr_001',
    actorName: 'Super Admin',
    actorRole: 'SUPER_ADMIN',
    actionCode: 'CUSTOMER_BALANCE_WRITE_OFF',
    targetResource: 'OutstandingLedger',
    targetId: 'ride_10007',
    beforeSnapshot: { status: 'DUE', amountDuePaise: 52000 },
    afterSnapshot: { status: 'WRITTEN_OFF', reasonCode: 'UNCOLLECTIBLE_DEFAULT' },
    ipAddress: '103.21.144.10',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
  },
];

let simulateDegradedState = false;

export const governanceHandlers = [
  // List Feature Flags
  http.get('/api/v1/admin/feature-flags', () => {
    return HttpResponse.json({ success: true, data: mockFeatureFlags, meta: { requestId: 'req_flags' } });
  }),

  // Toggle Feature Flag (Mandatory changeReason)
  http.patch('/api/v1/admin/feature-flags/:flagKey', async ({ params, request }) => {
    const body = (await request.json()) as { enabled: boolean; changeReason: string };
    if (!body.changeReason || body.changeReason.trim().length === 0) {
      return HttpResponse.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Mandatory changeReason must be supplied to toggle platform flags.', requestId: 'err_flag' },
        },
        { status: 400 }
      );
    }

    mockFeatureFlags = mockFeatureFlags.map((f) =>
      f.key === params.flagKey
        ? {
            ...f,
            enabled: body.enabled,
            changeReason: body.changeReason,
            lastUpdatedBy: 'Super Admin',
            updatedAt: new Date().toISOString(),
          }
        : f
    );

    return HttpResponse.json({ success: true, data: { updated: true }, meta: { requestId: 'req_flag_ok' } });
  }),

  // List Admin Users for RBAC
  http.get('/api/v1/admin/users', () => {
    return HttpResponse.json({ success: true, data: mockUsers, meta: { requestId: 'req_users_rbac' } });
  }),

  // Reassign User Role (SUPER_ADMIN only)
  http.patch('/api/v1/admin/users/:userId/role', async ({ params, request }) => {
    const body = (await request.json()) as { role: Role };
    mockUsers = mockUsers.map((u) => (u.id === params.userId ? { ...u, role: body.role } : u));
    return HttpResponse.json({ success: true, data: { updated: true }, meta: { requestId: 'req_role_ok' } });
  }),

  // Immutable Audit Log Stream
  http.get('/api/v1/admin/audit-logs', () => {
    return HttpResponse.json({ success: true, data: mockAuditLogs, meta: { requestId: 'req_audit_list' } });
  }),

  // Toggle Degraded Probe State Simulation
  http.post('/api/v1/admin/health/toggle-degraded', () => {
    simulateDegradedState = !simulateDegradedState;
    return HttpResponse.json({ success: true, data: { degraded: simulateDegradedState }, meta: { requestId: 'req_probe_toggle' } });
  }),

  // Health Readiness Probe (Returns 503 degraded dependency state)
  http.get('/api/v1/health/ready', () => {
    if (simulateDegradedState) {
      return HttpResponse.json(
        {
          success: false,
          data: {
            status: 'degraded',
            uptimeSeconds: 84210,
            timestamp: new Date().toISOString(),
            dependencies: {
              mongo: { status: 'up', latencyMs: 4 },
              redis: { status: 'degraded', latencyMs: 420, details: 'Replica lag detected (>300ms)' },
              socketCluster: { status: 'up', latencyMs: 8 },
            },
          },
          meta: { requestId: 'req_health_deg' },
        },
        { status: 503 }
      );
    }

    return HttpResponse.json({
      success: true,
      data: {
        status: 'healthy',
        uptimeSeconds: 84210,
        timestamp: new Date().toISOString(),
        dependencies: {
          mongo: { status: 'up', latencyMs: 3 },
          redis: { status: 'up', latencyMs: 2 },
          socketCluster: { status: 'up', latencyMs: 6 },
        },
      },
      meta: { requestId: 'req_health_ok' },
    });
  }),
];