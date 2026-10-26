import { http, HttpResponse } from 'msw';

export const authHandlers = [
  http.post('/api/v1/admin/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    if (body.email === 'mfa@platform.internal') {
      return HttpResponse.json({
        success: true,
        data: {
          mfaRequired: true,
          challengeId: 'mfa_ch_9921',
          expiresInSeconds: 300,
        },
        meta: { requestId: 'req_auth_01' },
      });
    }

    return HttpResponse.json({
      success: true,
      data: {
        mfaRequired: false,
        accessToken: 'mock_jwt_access_super_admin',
        user: {
          id: 'usr_admin_001',
          name: 'Super Commander',
          email: body.email || 'admin@platform.internal',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
      },
      meta: { requestId: 'req_auth_02' },
    });
  }),

  http.post('/api/v1/admin/auth/mfa/verify', async ({ request }) => {
    const body = (await request.json()) as { challengeId?: string; mfaCode?: string };
    if (body.mfaCode !== '123456') {
      return HttpResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid MFA verification code.',
            requestId: 'req_mfa_err',
          },
        },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      success: true,
      data: {
        accessToken: 'mock_jwt_access_mfa_verified',
        user: {
          id: 'usr_admin_001',
          name: 'Super Commander',
          email: 'admin@platform.internal',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
      },
      meta: { requestId: 'req_mfa_ok' },
    });
  }),

  http.get('/api/v1/auth/sessions', () => {
    return HttpResponse.json({
      success: true,
      data: [
        {
          sessionId: 'sess_live_01',
          ipAddress: '192.168.1.100',
          userAgent: 'Chrome 131.0 Windows 11',
          isCurrent: true,
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          lastActiveAt: new Date().toISOString(),
        },
        {
          sessionId: 'sess_remote_02',
          ipAddress: '10.0.4.12',
          userAgent: 'Firefox 130.0 macOS Sonoma',
          isCurrent: false,
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          lastActiveAt: new Date(Date.now() - 14400000).toISOString(),
        },
      ],
      meta: { requestId: 'req_sess_01' },
    });
  }),

  http.delete('/api/v1/auth/sessions/:sessionId', ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: { revokedSessionId: params.sessionId },
      meta: { requestId: 'req_sess_rev' },
    });
  }),

  http.get('/api/v1/health/ready', () => {
    return HttpResponse.json({
      success: true,
      data: {
        status: 'ready',
        dependencies: {
          mongo: 'up',
          redis: 'up',
        },
      },
      meta: { requestId: 'req_health_01' },
    });
  }),
];
