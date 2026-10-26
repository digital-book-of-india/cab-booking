'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatPaiseToInr } from '@/lib/currency';
import {
  Activity,
  Radio,
  Car,
  ShieldAlert,
  CreditCard,
  Clock,
  ArrowRight
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

const DEMAND_DATA = [
  { hour: '06:00', requests: 120, completed: 110 },
  { hour: '08:00', requests: 480, completed: 420 },
  { hour: '10:00', requests: 620, completed: 590 },
  { hour: '12:00', requests: 380, completed: 370 },
  { hour: '14:00', requests: 310, completed: 300 },
  { hour: '16:00', requests: 540, completed: 510 },
  { hour: '18:00', requests: 790, completed: 720 },
  { hour: '20:00', requests: 680, completed: 640 },
  { hour: '22:00', requests: 390, completed: 380 },
];

export default function MasterDashboardPage() {
  const [stats] = useState({
    completedToday: 4180,
    activeDispatches: 18,
    grossValuePaise: 142500000,
    onlineDrivers: 148,
    activeSos: 1,
  });

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Mission Control Overview</h1>
          <p className="text-xs text-slate-500 mt-1">Real-time platform operations, live dispatch health, and fleet metrics.</p>
        </div>
        <div className="flex items-center space-x-3">
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
          <p className="text-2xl font-bold text-slate-900 font-mono">{stats.completedToday.toLocaleString('en-IN')}</p>
          <span className="text-[11px] text-emerald-600 font-bold">+12% vs last week</span>
        </div>

        {/* Active Dispatches */}
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Dispatches</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{stats.activeDispatches}</p>
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
          <p className="text-2xl font-bold text-slate-900 font-mono">{formatPaiseToInr(stats.grossValuePaise)}</p>
          <span className="text-[11px] text-indigo-600 font-semibold">Today's collection</span>
        </div>

        {/* Drivers Online */}
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Drivers Online</span>
            <div className="p-1.5 bg-sky-50 text-sky-600 rounded-lg">
              <Car className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900 font-mono">{stats.onlineDrivers}</p>
          <span className="text-[11px] text-emerald-600 font-bold">82% on active trip</span>
        </div>

        {/* Active SOS */}
        <div className="p-5 rounded-xl border border-rose-200 bg-rose-50/60 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-rose-700">
            <span className="text-xs font-semibold uppercase tracking-wider">Active SOS</span>
            <ShieldAlert className="h-4 w-4 text-rose-600 animate-pulse" />
          </div>
          <p className="text-2xl font-bold text-rose-700 font-mono">{stats.activeSos}</p>
          <Link href="/safety/sos" className="text-[11px] text-rose-700 hover:underline font-bold block">
            Inspect incident &rarr;
          </Link>
        </div>
      </div>

      {/* Hourly Demand vs Completed Rides Chart */}
      <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">Hourly Demand vs Completed Rides</h3>
          <p className="text-xs text-slate-500">Comparison of customer trip requests vs completed dispatches across peak hours.</p>
        </div>

        <div className="h-72 w-full pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={DEMAND_DATA}>
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