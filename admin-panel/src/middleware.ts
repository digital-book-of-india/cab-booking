import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface RouteRestriction {
  pattern: RegExp;
  allowedRoles: string[];
  department: string;
}

// Route-Level RBAC Security Matrix
const ROUTE_PERMISSIONS: RouteRestriction[] = [
  {
    pattern: /^\/finance(\/.*)?$/,
    allowedRoles: ['FINANCE', 'SUPER_ADMIN', 'CONFIG_ADMIN'],
    department: 'Finance & Accounts',
  },
  {
    pattern: /^\/pricing(\/.*)?$/,
    allowedRoles: ['CONFIG_ADMIN', 'SUPER_ADMIN'],
    department: 'Pricing & Geofence Architecture',
  },
  {
    pattern: /^\/safety(\/.*)?$/,
    allowedRoles: ['SAFETY_ADMIN', 'SUPER_ADMIN', 'OPS'],
    department: 'Emergency SOS & Safety Console',
  },
  {
    pattern: /^\/moderation(\/.*)?$/,
    allowedRoles: ['SUPPORT', 'OPS', 'SUPER_ADMIN'],
    department: 'Review Moderation & Trust Desk',
  },
  {
    pattern: /^\/settings\/roles(\/.*)?$/,
    allowedRoles: ['SUPER_ADMIN'],
    department: 'Staff Security & RBAC Roles',
  },
  {
    pattern: /^\/settings\/audit-logs(\/.*)?$/,
    allowedRoles: ['SUPER_ADMIN'],
    department: 'System Governance & Audit Logs',
  },
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow login page unconditionally
  if (pathname === '/login') {
    const token = request.cookies.get('auth_token')?.value;
    // If already logged in, redirect from login to dashboard
    if (token) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  // 2. Authentication Check for all dashboard routes
  const authToken =
    request.cookies.get('auth_token')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '');

  if (!authToken) {
    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // 3. Role-Based Access Control (RBAC) URL Security Guard
  const userRole = request.cookies.get('user_role')?.value;

  if (userRole) {
    for (const rule of ROUTE_PERMISSIONS) {
      if (rule.pattern.test(pathname)) {
        if (!rule.allowedRoles.includes(userRole)) {
          // Block unauthorized direct URL tampering and redirect to overview with alert
          const redirectUrl = new URL('/', request.url);
          redirectUrl.searchParams.set('unauthorized', 'true');
          redirectUrl.searchParams.set('dept', rule.department);
          redirectUrl.searchParams.set('deniedPath', pathname);
          return NextResponse.redirect(redirectUrl);
        }
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
