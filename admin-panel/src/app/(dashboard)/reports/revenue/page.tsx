'use client';

import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';

const MOCK_REVENUE_REPORT = [
  { Date: '2026-10-23', GrossBookingINR: 425000, PlatformCommissionINR: 42500, GatewayDeductionsINR: 8500, NetRevenueINR: 34000 },
  { Date: '2026-10-22', GrossBookingINR: 398000, PlatformCommissionINR: 39800, GatewayDeductionsINR: 7960, NetRevenueINR: 31840 },
];

export default function RevenueReportPage() {
  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(MOCK_REVENUE_REPORT);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue');
    XLSX.writeFile(wb, 'Financial_Revenue_Report_2026.xlsx');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Platform Financial Revenue Breakdown</h1>
          <p className="text-xs text-slate-400 mt-1">Audit gross booking values (GBV), commissions, and merchant gateway charges.</p>
        </div>
        <button
          onClick={exportToExcel}
          className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition"
        >
          <Download className="h-4 w-4" />
          <span>Export Excel (XLSX)</span>
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-800/40 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-6 py-3">Reporting Date</th>
              <th className="px-6 py-3">Gross Booking Value</th>
              <th className="px-6 py-3">Platform Commission (10%)</th>
              <th className="px-6 py-3">Gateway Fees</th>
              <th className="px-6 py-3 text-right">Net Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {MOCK_REVENUE_REPORT.map((row, idx) => (
              <tr key={idx} className="hover:bg-slate-800/30">
                <td className="px-6 py-4 font-mono text-xs text-indigo-400">{row.Date}</td>
                <td className="px-6 py-4 font-mono font-semibold text-slate-100">₹{row.GrossBookingINR.toLocaleString('en-IN')}</td>
                <td className="px-6 py-4 font-mono text-emerald-400 font-semibold">₹{row.PlatformCommissionINR.toLocaleString('en-IN')}</td>
                <td className="px-6 py-4 font-mono text-rose-400">₹{row.GatewayDeductionsINR.toLocaleString('en-IN')}</td>
                <td className="px-6 py-4 font-mono font-bold text-indigo-300 text-right">₹{row.NetRevenueINR.toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}