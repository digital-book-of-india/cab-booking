'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import * as XLSX from 'xlsx';
import { formatPaiseToInr } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import {
  Download,
  Calendar,
  RefreshCw,
  AlertTriangle,
  Star,
} from 'lucide-react';


interface DriverAnalyticsItem {
  driverId: string;
  name?: string;
  phone?: string;
  rides?: number;
  earningsPaise?: number;
  tipsPaise?: number;
  acceptanceRate?: number | null;
  rating?: number | null;
  offersAnswered?: number;
  ratingCount?: number;
}

export default function DriversReportPage() {
  const now = new Date();
  const defaultTo = now.toISOString().split('T')[0];
  const defaultFrom = new Date(now.getTime() - 14 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [dateError, setDateError] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const limit = 50;

  const maskPhone = (phone?: string) => {
    if (!phone) return '—';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '••••';
    return `+91 ••••• •${digits.slice(-4)}`;
  };

  const handleDateChange = (newFrom: string, newTo: string) => {
    setFrom(newFrom);
    setTo(newTo);
    if (new Date(newFrom) > new Date(newTo)) {
      setDateError('Start date must be before or equal to End date.');
    } else {
      setDateError('');
    }
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-analytics-drivers', { from, to, limit }],
    queryFn: async () => {
      if (new Date(from) > new Date(to)) {
        throw new Error('Invalid date range.');
      }
      const params = new URLSearchParams();
      if (from) params.append('from', new Date(`${from}T00:00:00.000Z`).toISOString());
      if (to) params.append('to', new Date(`${to}T23:59:59.999Z`).toISOString());
      params.append('limit', String(limit));

      const res = await apiClient.get(`/admin/analytics/drivers?${params.toString()}`);
      return res.data?.data || res.data;
    },
    enabled: !dateError,
  });

  const driversList: DriverAnalyticsItem[] = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data)
      ? data
      : [];

  const exportToExcel = () => {
    if (!driversList.length) return;
    const capped = driversList.slice(0, 50000);
    const rows = capped.map((d: DriverAnalyticsItem, idx: number) => ({
      Rank: idx + 1,
      DriverId: d.driverId,
      DriverName: d.name || 'Driver Partner',
      PhoneMasked: maskPhone(d.phone),
      CompletedRides: d.rides || 0,
      TotalEarningsINR: ((d.earningsPaise || 0) / 100).toFixed(2),
      TipsINR: ((d.tipsPaise || 0) / 100).toFixed(2),
      AcceptanceRate:
        d.acceptanceRate !== null && d.acceptanceRate !== undefined
          ? `${(d.acceptanceRate * 100).toFixed(1)}%`
          : 'N/A',
      Rating: d.rating ? `${d.rating} / 5` : 'No reviews',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drivers_Ranking');
    XLSX.writeFile(wb, `Driver_Fleet_Analytics_${from}_to_${to}.xlsx`);
  };

  const downloadCsv = () => {
    if (!driversList.length) return;
    const capped = driversList.slice(0, 50000);
    const rows = capped.map((d: DriverAnalyticsItem, idx: number) => ({
      Rank: idx + 1,
      DriverId: d.driverId,
      DriverName: d.name || 'Driver Partner',
      PhoneMasked: maskPhone(d.phone),
      CompletedRides: d.rides || 0,
      TotalEarningsINR: ((d.earningsPaise || 0) / 100).toFixed(2),
      TipsINR: ((d.tipsPaise || 0) / 100).toFixed(2),
      AcceptanceRate:
        d.acceptanceRate !== null && d.acceptanceRate !== undefined
          ? `${(d.acceptanceRate * 100).toFixed(1)}%`
          : 'N/A',
      Rating: d.rating ? `${d.rating} / 5` : 'No reviews',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `drivers_export_${from}_to_${to}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Driver Fleet Performance & Leaderboard
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Audit driver completions, partner earnings, customer tips, offer acceptance ratio, and star ratings.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={downloadCsv}
            disabled={!driversList.length || isLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={exportToExcel}
            disabled={!driversList.length || isLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export XLSX</span>
          </button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700">Period:</span>
        </div>
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <input
            type="date"
            value={from}
            onChange={(e) => handleDateChange(e.target.value, to)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-600 font-mono"
          />
          <span className="text-slate-400 text-xs">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => handleDateChange(from, e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-600 font-mono"
          />
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching || !!dateError}
          className="ml-auto flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          <span>Apply Filter</span>
        </button>
      </div>

      {dateError && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{dateError}</span>
        </div>
      )}

      {exportError && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>{exportError}</span>
          </div>
          <button
            onClick={() => setExportError(null)}
            className="text-amber-500 hover:text-amber-700 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Driver Leaderboard Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Rank / Driver</th>
              <th className="px-6 py-3.5">Completed Trips</th>
              <th className="px-6 py-3.5">Fare Earnings</th>
              <th className="px-6 py-3.5">Customer Tips</th>
              <th className="px-6 py-3.5">Acceptance Ratio</th>
              <th className="px-6 py-3.5 text-right">Star Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Aggregating driver fleet leaderboard...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-rose-600">
                  {getErrorMessage(error) || 'Failed to load driver analytics.'}
                </td>
              </tr>
            ) : driversList.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  Zero driver activity found in selected date period.
                </td>
              </tr>
            ) : (
              driversList.map((d: DriverAnalyticsItem, idx: number) => (
                <tr key={d.driverId || idx} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4 flex items-center space-x-3">
                    <span
                      className={`h-6 w-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                        idx === 0
                          ? 'bg-amber-100 text-amber-800'
                          : idx === 1
                            ? 'bg-slate-200 text-slate-800'
                            : idx === 2
                              ? 'bg-amber-600/20 text-amber-900'
                              : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900">{d.name || 'Driver Partner'}</p>
                      <span className="font-mono text-slate-400 text-[11px]">{d.driverId}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-semibold text-slate-900">
                    {d.rides || 0} rides
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-emerald-600">
                    {formatPaiseToInr(d.earningsPaise || 0)}
                  </td>
                  <td className="px-6 py-4 font-mono text-indigo-600">
                    {formatPaiseToInr(d.tipsPaise || 0)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono font-bold text-slate-700">
                      {d.acceptanceRate !== null && d.acceptanceRate !== undefined
                        ? `${(d.acceptanceRate * 100).toFixed(1)}%`
                        : '-'}
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      {d.offersAnswered || 0} offers answered
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {d.rating ? (
                      <span className="inline-flex items-center font-bold text-amber-500">
                        <Star className="h-3.5 w-3.5 fill-current mr-1" />
                        {d.rating}
                        <span className="text-slate-400 font-normal text-[10px] ml-1">
                          ({d.ratingCount})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">No reviews</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
