'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import * as XLSX from 'xlsx';
import { getErrorMessage } from '@/lib/errors';
import {
  Download,
  Calendar,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';


interface RideSeriesItem {
  date?: string;
  _id?: string;
  requested?: number;
  total?: number;
  completed?: number;
  cancelled?: number;
  grossPaise?: number;
}

export default function RidesReportPage() {
  const now = new Date();
  const defaultTo = now.toISOString().split('T')[0];
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [dateError, setDateError] = useState('');

  // Validate dates
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
    queryKey: ['admin-reports-summary', { from, to }],
    queryFn: async () => {
      if (new Date(from) > new Date(to)) {
        throw new Error('Invalid date range: "from" must be before "to".');
      }
      const params = new URLSearchParams();
      if (from) params.append('from', new Date(`${from}T00:00:00.000Z`).toISOString());
      if (to) params.append('to', new Date(`${to}T23:59:59.999Z`).toISOString());

      const res = await apiClient.get(`/admin/reports/summary?${params.toString()}`);
      return res.data?.data || res.data;
    },
    enabled: !dateError,
  });

  const summary = data;
  const series: RideSeriesItem[] = summary?.series || [];
  const bookings = summary?.bookings || {};
  const dispatch = summary?.dispatch || {};

  const [exportError, setExportError] = useState<string | null>(null);

  // Export to Excel using actual data (Enforce 50,000-row cap)
  const exportToExcel = () => {
    if (!series || series.length === 0) return;
    const capped = series.slice(0, 50000);
    const rows = capped.map((row: RideSeriesItem) => ({
      Date: row.date || row._id,
      TotalBookings: row.requested || row.total || 0,
      CompletedRides: row.completed || 0,
      CancelledRides: row.cancelled || 0,
      GrossFareINR: row.grossPaise ? (row.grossPaise / 100).toFixed(2) : '0.00',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rides_Report');
    XLSX.writeFile(wb, `Platform_Rides_Report_${from}_to_${to}.xlsx`);
  };

  // Download raw CSV from server with 50,000 limit enforcement
  const downloadCsv = async () => {
    setExportError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.append('from', new Date(`${from}T00:00:00.000Z`).toISOString());
      if (to) params.append('to', new Date(`${to}T23:59:59.999Z`).toISOString());
      const res = await apiClient.get(`/admin/exports/rides.csv?${params.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `rides_export_${from}_to_${to}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: unknown) {
      const maybeAxios = err as { response?: { status?: number } };
      if (maybeAxios?.response?.status === 422) {
        setExportError('Export exceeds platform limit of 50,000 rows. Please select a shorter date range.');
        return;
      }
      exportToExcel();
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Rides Operational Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Realtime volume, trip completions, cancellations, and dispatch response times from actual server telemetry.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={downloadCsv}
            disabled={!series.length || isLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={exportToExcel}
            disabled={!series.length || isLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export XLSX</span>
          </button>
        </div>
      </div>

      {/* Date Range Filters */}
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

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Total Bookings</span>
            <TrendingUp className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {isLoading ? '...' : bookings.total ?? 0}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Requested rides in period</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Completion Rate</span>
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold font-mono text-emerald-600 mt-2">
            {isLoading
              ? '...'
              : bookings.completionRate !== undefined && bookings.completionRate !== null
                ? `${(bookings.completionRate * 100).toFixed(1)}%`
                : '0.0%'}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            {bookings.byStatus?.COMPLETED || 0} completed rides
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Cancellation Rate</span>
            <XCircle className="h-4 w-4 text-rose-600" />
          </div>
          <p className="text-2xl font-bold font-mono text-rose-600 mt-2">
            {isLoading
              ? '...'
              : bookings.cancelRate !== undefined && bookings.cancelRate !== null
                ? `${(bookings.cancelRate * 100).toFixed(1)}%`
                : '0.0%'}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            {bookings.byStatus?.CANCELLED || 0} cancelled rides
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Avg Assign Time</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {isLoading
              ? '...'
              : dispatch.averageSecondsToAssign !== null && dispatch.averageSecondsToAssign !== undefined
                ? `${dispatch.averageSecondsToAssign}s`
                : '-'}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Offer accept: {dispatch.offerAcceptanceRate ? `${(dispatch.offerAcceptanceRate * 100).toFixed(1)}%` : '-'}
          </span>
        </div>
      </div>

      {/* Visual Chart */}
      {series.length > 0 && (
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
          <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
            Daily Volume Trends (Requested vs Completed vs Cancelled)
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', fontSize: '11px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="requested" name="Requested" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cancelled" name="Cancelled" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Data Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Reporting Date</th>
              <th className="px-6 py-3.5">Requested Bookings</th>
              <th className="px-6 py-3.5">Completed Trips</th>
              <th className="px-6 py-3.5">Cancellations</th>
              <th className="px-6 py-3.5 text-right">Completion Ratio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Aggregating rides metrics...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-rose-600">
                  {getErrorMessage(error) || 'Failed to load report from server.'}
                </td>
              </tr>
            ) : series.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                  Zero ride bookings found in this period. Adjust your date filters.
                </td>
              </tr>
            ) : (
              series.map((row: RideSeriesItem, idx: number) => {
                const totalReq = row.requested || row.total || 0;
                const comp = row.completed || 0;
                const ratio = totalReq > 0 ? ((comp / totalReq) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={idx} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4 font-mono font-semibold text-indigo-700">
                      {row.date || row._id}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900">{totalReq}</td>
                    <td className="px-6 py-4 text-emerald-600 font-semibold">{comp}</td>
                    <td className="px-6 py-4 text-rose-600 font-semibold">{row.cancelled || 0}</td>
                    <td className="px-6 py-4 text-right font-mono font-semibold text-slate-700">
                      {ratio}%
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
