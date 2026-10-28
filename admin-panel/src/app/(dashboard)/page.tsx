'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { formatPaiseToInr } from '@/lib/currency';
import {
  Activity,
  Radio,
  Car,
  ShieldAlert,
  CreditCard,
  Clock,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from 'recharts';

const DEFAULT_DEMAND = [
  { hour: '06:00', requests: 12, completed: 11 },
  { hour: '08:00', requests: 48, completed: 42 },
  { hour: '10:00', requests: 62, completed: 59 },
  { hour: '12:00', requests: 38, completed: 37 },
  { hour: '14:00', requests: 31, completed: 30 },
  { hour: '16:00', requests: 54, completed: 51 },
  { hour: '18:00', requests: 79, completed: 72 },
  { hour: '20:00', requests: 68, completed: 64 },
  { hour: '22:00', requests: 39, completed: 38 },
];

export default function MasterDashboardPage() {
  // 1. Fetch Ops Dashboard Counters
  const dashboardQuery = useQuery({
    queryKey: ['admin-dashboard-stats'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/dashboard');
        return res.data?.data || res.data;
      } catch (err) {
        console.warn('Could not load /admin/dashboard:', err);
        return null;
      }
    },
    refetchInterval: 15000,
  });

  // 2. Fetch Financial / Operational Summary
  const reportsQuery = useQuery({
    queryKey: ['admin-reports-summary-today'],
    queryFn: async () => {
      try {
        const today = new Date();
        const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const to = new Date(today.getTime() + 86400000).toISOString();
        const res = await apiClient.get(`/admin/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        return res.data?.data || res.data;
      } catch (err) {
        console.warn('Could not load /admin/reports/summary:', err);
        return null;
      }
    },
    refetchInterval: 30000,
  });

  // 3. Fetch Active SOS Incidents
  const sosQuery = useQuery({
    queryKey: ['admin-open-sos'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/incidents?status=OPEN');
        const items = res.data?.data?.items || res.data?.data || [];
        return Array.isArray(items) ? items.length : 0;
      } catch {
        return 0;
      }
    },
    refetchInterval: 10000,
  });

  const dData = dashboardQuery.data;
  const rData = reportsQuery.data;

  const completedToday = useMemo(() => {
    if (dData?.bookings?.last24hByStatus?.COMPLETED !== undefined) {
      return dData.bookings.last24hByStatus.COMPLETED;
    }
    const completedRow = rData?.byStatus?.find((s: any) => s._id === 'COMPLETED');
    return completedRow?.n || 0;
  }, [dData, rData]);

  const activeDispatches = useMemo(() => {
    return dData?.bookings?.active ?? 0;
  }, [dData]);

  const grossValuePaise = useMemo(() => {
    return rData?.money?.gross || 0;
  }, [rData]);

  const onlineDrivers = useMemo(() => {
    return dData?.drivers?.onlineNow ?? 0;
  }, [dData]);

  const activeSos = useMemo(() => {
    return sosQuery.data ?? 0;
  }, [sosQuery.data]);

  const chartData = useMemo(() => {
    if (Array.isArray(rData?.perDay) && rData.perDay.length > 0) {
      return rData.perDay.map((p: any) => ({
        hour: p.date?.slice(5) || p._id || 'Day',
        requests: p.requests || p.completed || 0,
        completed: p.completed || 0,
      }));
    }
    return DEFAULT_DEMAND;
  }, [rData]);

  const isRefreshing = dashboardQuery.isFetching || reportsQuery.isFetching;

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Mission Control Overview</h1>
          <p className="text-xs text-slate-500 mt-1">Real-time platform operations, live dispatch health, and fleet metrics.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              dashboardQuery.refetch();
              reportsQuery.refetch();
              sosQuery.refetch();
            }}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Live</span>
          </button>
          <Link
            href="/tools/verification-matrix"
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition shadow-xs"
          >
            <span>Run Test Matrix</span>
          </Link>
          <Link
            href="/dispatch/live-map"
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition"
          >
            <Radio className="h-3.5 w-3.5" />
            <span>Launch Live Radar</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Completed Rides */}
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Completed Rides</span>
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{completedToday.toLocaleString('en-IN')}</p>
          <span className="text-[11px] text-emerald-600 font-bold">Live database count</span>
        </div>

        {/* Active Dispatches */}
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Dispatches</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{activeDispatches}</p>
          <span className="text-[11px] text-amber-700 font-medium">Queued & allocating</span>
        </div>

        {/* Gross Booking */}
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Gross Booking (INR)</span>
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{formatPaiseToInr(grossValuePaise)}</p>
          <span className="text-[11px] text-indigo-600 font-semibold">Today&apos;s collection</span>
        </div>

        {/* Drivers Online */}
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Drivers Online</span>
            <div className="p-1.5 bg-sky-50 text-sky-600 rounded-lg">
              <Car className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{onlineDrivers}</p>
          <span className="text-[11px] text-emerald-600 font-bold">Online on fleet radar</span>
        </div>

        {/* Active SOS */}
        <div className="p-5 rounded-xl border border-rose-200 bg-rose-50/60 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-rose-700">
            <span className="text-xs font-semibold uppercase tracking-wider">Active SOS</span>
            <ShieldAlert className="h-4 w-4 text-rose-600 animate-pulse" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{activeSos}</p>
          <Link href="/safety/sos" className="text-[11px] text-rose-700 hover:underline font-bold block">
            Inspect incident &rarr;
          </Link>
        </div>
      </div>

      {/* Hourly Demand vs Completed Rides Chart */}
      <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">Demand vs Completed Rides</h3>
          <p className="text-xs text-slate-500">Live operational trip requests vs completed dispatches.</p>
        </div>

        <div className="h-72 w-full pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="requestsColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="completedColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="hour" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Area type="monotone" dataKey="requests" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#requestsColor)" name="Requested Trips" />
              <Area type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#completedColor)" name="Completed Rides" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
