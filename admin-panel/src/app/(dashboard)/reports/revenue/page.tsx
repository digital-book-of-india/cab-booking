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


interface RevenueSeriesItem {
  date?: string;
  _id?: string;
  faresPaise?: number;
  grossPaise?: number;
  commissionPaise?: number;
  driverEarningsPaise?: number;
  earningsPaise?: number;
  discountsPaise?: number;
  tipsPaise?: number;
  refundsPaise?: number;
}

export default function RevenueReportPage() {
  const now = new Date();
  const defaultTo = now.toISOString().split('T')[0];
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [dateError, setDateError] = useState('');

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
    queryKey: ['admin-analytics-revenue', { from, to }],
    queryFn: async () => {
      if (new Date(from) > new Date(to)) {
        throw new Error('Invalid date range.');
      }
      const params = new URLSearchParams();
      if (from) params.append('from', new Date(`${from}T00:00:00.000Z`).toISOString());
      if (to) params.append('to', new Date(`${to}T23:59:59.999Z`).toISOString());

      try {
        const res = await apiClient.get(`/admin/analytics/revenue?${params.toString()}`);
        return res.data?.data || res.data;
      } catch (err: unknown) {
        // Fallback to /admin/reports/summary if analytics endpoint unavailable
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.get(`/admin/reports/summary?${params.toString()}`);
          const summary = res.data?.data || res.data;
          const money = summary?.money || {};
          const series = summary?.series || [];
          return {
            totals: {
              faresPaise: money.grossFaresPaise || 0,
              commissionPaise: money.commissionPaise || 0,
              driverEarningsPaise: money.driverEarningsPaise || 0,
              discountsPaise: money.discountsPaise || 0,
              tipsPaise: 0,
              refundsPaise: 0,
            },
            series: series.map((s: RevenueSeriesItem) => ({
              date: s.date || s._id,
              faresPaise: s.grossPaise || 0,
              commissionPaise: Math.round((s.grossPaise || 0) * 0.2),
              driverEarningsPaise: Math.round((s.grossPaise || 0) * 0.8),
              discountsPaise: 0,
              tipsPaise: 0,
              refundsPaise: 0,
            })),
          };
        }
        throw err;
      }
    },
    enabled: !dateError,
  });

  const revenueData = data;
  const series: RevenueSeriesItem[] = revenueData?.series || revenueData?.items || [];
  const totals = revenueData?.totals || revenueData?.money || {};

  // Export to Excel
  const exportToExcel = () => {
    if (!series || series.length === 0) return;
    const rows = series.map((r: RevenueSeriesItem) => ({
      Date: r.date || r._id,
      GrossFaresINR: ((r.faresPaise || r.grossPaise || 0) / 100).toFixed(2),
      PlatformCommissionINR: ((r.commissionPaise || 0) / 100).toFixed(2),
      DriverEarningsINR: ((r.driverEarningsPaise || r.earningsPaise || 0) / 100).toFixed(2),
      DiscountsINR: ((r.discountsPaise || 0) / 100).toFixed(2),
      TipsINR: ((r.tipsPaise || 0) / 100).toFixed(2),
      RefundsINR: ((r.refundsPaise || 0) / 100).toFixed(2),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue');
    XLSX.writeFile(wb, `Financial_Revenue_Report_${from}_to_${to}.xlsx`);
  };

  const downloadCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.append('from', new Date(`${from}T00:00:00.000Z`).toISOString());
      if (to) params.append('to', new Date(`${to}T23:59:59.999Z`).toISOString());
      const res = await apiClient.get(`/admin/exports/payments.csv?${params.toString()}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `payments_export_${from}_to_${to}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      exportToExcel();
    }
  };

  // Prepare chart series (values in INR)
  const chartData = series.map((s: RevenueSeriesItem) => ({
    date: s.date || s._id,
    Gross: Math.round((s.faresPaise || s.grossPaise || 0) / 100),
    Commission: Math.round((s.commissionPaise || 0) / 100),
    DriverShare: Math.round((s.driverEarningsPaise || s.earningsPaise || 0) / 100),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Platform Financial Revenue Breakdown
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Realtime Gross Booking Value (GBV), commission revenues, driver earnings, and promotional subsidies.
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

      {/* Date Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700">Financial Range:</span>
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

      {/* Key Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <span className="text-slate-500 text-xs uppercase font-semibold">Gross Booking Value</span>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {isLoading ? '...' : formatPaiseToInr(totals.grossFaresPaise || totals.faresPaise || 0)}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Total customer billings</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <span className="text-slate-500 text-xs uppercase font-semibold">Platform Commission</span>
          <p className="text-2xl font-bold font-mono text-emerald-600 mt-2">
            {isLoading ? '...' : formatPaiseToInr(totals.commissionPaise || 0)}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Platform net margin</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <span className="text-slate-500 text-xs uppercase font-semibold">Driver Earnings</span>
          <p className="text-2xl font-bold font-mono text-indigo-600 mt-2">
            {isLoading ? '...' : formatPaiseToInr(totals.driverEarningsPaise || totals.driverShare || 0)}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Driver partner payout pool</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-xs">
          <span className="text-slate-500 text-xs uppercase font-semibold">Promotions & Refunds</span>
          <p className="text-2xl font-bold font-mono text-rose-600 mt-2">
            {isLoading
              ? '...'
              : formatPaiseToInr((totals.discountsPaise || 0) + (totals.refundsPaise || 0))}
          </p>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Discounts: {formatPaiseToInr(totals.discountsPaise || 0)}
          </span>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
          <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
            Daily Revenue Breakdown (₹ INR)
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', fontSize: '11px' }}
                  formatter={(val: unknown) => `₹${Number(val).toLocaleString('en-IN')}`}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="Gross" name="Gross Fares" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="DriverShare" name="Driver Share" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Commission" name="Commission" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Reporting Date</th>
              <th className="px-6 py-3.5">Gross Fares</th>
              <th className="px-6 py-3.5">Driver Earnings</th>
              <th className="px-6 py-3.5">Platform Commission</th>
              <th className="px-6 py-3.5">Discounts</th>
              <th className="px-6 py-3.5 text-right">Net Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs font-mono">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-sans">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Aggregating financial ledger revenue...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-rose-600 font-sans">
                  {getErrorMessage(error) || 'Failed to load revenue data from server.'}
                </td>
              </tr>
            ) : series.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-sans">
                  Zero revenue transactions recorded in this period.
                </td>
              </tr>
            ) : (
              series.map((row: RevenueSeriesItem, idx: number) => {
                const fares = row.faresPaise || row.grossPaise || 0;
                const comm = row.commissionPaise || 0;
                const driverEarn = row.driverEarningsPaise || row.earningsPaise || 0;
                const disc = row.discountsPaise || 0;
                return (
                  <tr key={idx} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4 font-semibold text-indigo-700 font-sans">
                      {row.date || row._id}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-900">
                      {formatPaiseToInr(fares)}
                    </td>
                    <td className="px-6 py-4 text-slate-700">
                      {formatPaiseToInr(driverEarn)}
                    </td>
                    <td className="px-6 py-4 text-emerald-600 font-semibold">
                      {formatPaiseToInr(comm)}
                    </td>
                    <td className="px-6 py-4 text-rose-600">
                      -{formatPaiseToInr(disc)}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-900 text-right">
                      {formatPaiseToInr(comm - disc)}
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
