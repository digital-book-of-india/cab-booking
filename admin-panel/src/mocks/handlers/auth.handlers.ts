import { http, HttpResponse } from 'msw';

export const authHandlers = [
  http.post('/api/v1/auth/staff/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return HttpResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Email and password are required.',
            requestId: 'req_auth_err',
          },
        },
        { status: 400 },
      );
    }

    if (body.email === 'invalid@platform.internal' || body.password === 'wrongpassword') {
      return HttpResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Invalid email or password.',
            requestId: 'req_auth_bad',
          },
        },
        { status: 401 },
      );
    }

    return HttpResponse.json({
      success: true,
      data: {
        mfaRequired: true,
        mfaToken: 'mock_staff_mfa_token_flow_9921',
      },
      meta: { requestId: 'req_auth_01' },
    });
  }),

  http.post('/api/v1/auth/staff/mfa', async ({ request }) => {
    const body = (await request.json()) as { mfaToken?: string; code?: string };
    if (!body.mfaToken || body.code !== '123456') {
      return HttpResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'That code is not right.',
            requestId: 'req_mfa_err',
          },
        },
        { status: 401 },
      );
    }

    return HttpResponse.json({
      success: true,
      data: {
        accessToken: 'mock_jwt_access_super_admin',
        refreshToken: 'mock_jwt_refresh_super_admin',
        expiresInSeconds: 900,
        recoveryCodesLeft: 8,
        user: {
          id: 'usr_admin_001',
          role: 'SUPER_ADMIN',
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
