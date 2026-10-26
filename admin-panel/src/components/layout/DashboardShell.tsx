'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import {
  LayoutDashboard,
  Radio,
  Users,
  Car,
  UserCheck,
  Compass,
  CreditCard,
  ShieldAlert,
  LifeBuoy,
  Tag,
  FileBarChart,
  Settings,
  LogOut,
  Sliders,
  DollarSign,
  Building2,
  Star,
  Activity,
  X,
  AlertTriangle,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Overview', href: '/', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'OPS', 'SUPPORT', 'FINANCE', 'SAFETY_ADMIN', 'CONFIG_ADMIN'] },
  { label: 'Live Fleet Radar', href: '/dispatch/live-map', icon: Radio, roles: ['SUPER_ADMIN', 'OPS'] },
  { label: 'Dispatch Queue', href: '/dispatch/queue', icon: Compass, roles: ['SUPER_ADMIN', 'OPS'] },
  { label: 'Driver Directory', href: '/drivers', icon: UserCheck, roles: ['SUPER_ADMIN', 'OPS', 'SUPPORT'] },
  { label: 'Vehicle Registry', href: '/vehicles', icon: Car, roles: ['SUPER_ADMIN', 'OPS', 'SUPPORT'] },
  { label: 'Customers', href: '/customers', icon: Users, roles: ['SUPER_ADMIN', 'OPS', 'SUPPORT'] },
  { label: 'Ride Explorer', href: '/rides', icon: Activity, roles: ['SUPER_ADMIN', 'OPS', 'SUPPORT', 'FINANCE'] },
  { label: 'Pricing & Zones', href: '/pricing/configs', icon: DollarSign, roles: ['SUPER_ADMIN', 'CONFIG_ADMIN'] },
  { label: 'Finance & Payments', href: '/finance/payments', icon: CreditCard, roles: ['SUPER_ADMIN', 'FINANCE'] },
  { label: 'Emergency SOS', href: '/safety/sos', icon: ShieldAlert, roles: ['SUPER_ADMIN', 'SAFETY_ADMIN'] },
  { label: 'Support Tickets', href: '/support/tickets', icon: LifeBuoy, roles: ['SUPER_ADMIN', 'SUPPORT'] },
  { label: 'Review Moderation', href: '/moderation/ratings', icon: Star, roles: ['SUPER_ADMIN', 'OPS', 'SUPPORT'] },
  { label: 'Corporate Accounts', href: '/corporate/accounts', icon: Building2, roles: ['SUPER_ADMIN', 'OPS', 'FINANCE'] },
  { label: 'Marketing & Coupons', href: '/marketing/coupons', icon: Tag, roles: ['SUPER_ADMIN', 'CONFIG_ADMIN'] },
  { label: 'Reports & Analytics', href: '/reports/rides', icon: FileBarChart, roles: ['SUPER_ADMIN', 'OPS', 'FINANCE'] },
  { label: 'Active Sessions', href: '/settings/sessions', icon: Sliders, roles: ['SUPER_ADMIN', 'OPS', 'SUPPORT', 'FINANCE', 'SAFETY_ADMIN', 'CONFIG_ADMIN'] },
  { label: 'System Governance', href: '/settings/audit-logs', icon: Settings, roles: ['SUPER_ADMIN'] },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [unauthAlert, setUnauthAlert] = useState<{ dept?: string; path?: string } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('unauthorized') === 'true') {
      setUnauthAlert({
        dept: params.get('dept') || 'Restricted Department',
        path: params.get('deniedPath') || '',
      });
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Sidebar - Clean Pure White */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col shadow-sm">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-200">
              CB
            </div>
            <span className="font-bold text-base tracking-tight text-slate-900">Car Booking Ops</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.filter((item) => !user || item.roles.includes(user.role)).map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold border-l-4 border-indigo-600'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Current User Profile Bar */}
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between">
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-slate-800 truncate">{user?.name || 'Administrator'}</p>
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">
                {user?.role || 'SUPER_ADMIN'}
              </span>
            </div>
            <button
              onClick={() => logout()}
              className="p-1.5 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-slate-200 transition"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-slate-200 bg-white px-8 flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-3">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-600">Cluster: New Delhi Core</span>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-xs px-3 py-1 rounded-full border border-slate-200 bg-slate-100 text-slate-700 font-medium">
              API Base: <code className="text-indigo-600 font-bold">/api/v1</code>
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 bg-slate-50">
          {unauthAlert && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between shadow-xs animate-fadeIn">
              <div className="flex items-center space-x-3">
                <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0" />
                <div>
                  <strong className="font-bold text-rose-900 block text-xs">
                    Access Denied (Route-Level RBAC Security)
                  </strong>
                  <span className="text-[11px] text-rose-700">
                    Your current account role does not have authorization to access{' '}
                    <strong>{unauthAlert.dept}</strong> ({unauthAlert.path}). You were safely redirected to the operational overview.
                  </span>
                </div>
              </div>
              <button
                onClick={() => setUnauthAlert(null)}
                className="p-1 text-rose-400 hover:text-rose-700 rounded transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}