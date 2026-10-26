'use client';

import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';

const MOCK_RIDES_REPORT = [
  { Date: '2026-10-23', TotalBookings: 1420, CompletedRides: 1310, CancelledRides: 110, AvgDurationMins: 38 },
  { Date: '2026-10-22', TotalBookings: 1380, CompletedRides: 1260, CancelledRides: 120, AvgDurationMins: 35 },
  { Date: '2026-10-21', TotalBookings: 1510, CompletedRides: 1410, CancelledRides: 100, AvgDurationMins: 42 },
];

export default function RidesReportPage() {
  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(MOCK_RIDES_REPORT);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rides_Report');
    XLSX.writeFile(wb, 'Platform_Rides_Report_2026.xlsx');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Rides Operational Analytics</h1>
          <p className="text-xs text-slate-500 mt-1">Export trip completions, cancellation ratios, and duration benchmarks.</p>
        </div>
        <button
          onClick={exportToExcel}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
        >
          <Download className="h-4 w-4" />
          <span>Export Excel (XLSX)</span>
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Date</th>
              <th className="px-6 py-3.5">Total Bookings</th>
              <th className="px-6 py-3.5">Completed Trips</th>
              <th className="px-6 py-3.5">Cancellations</th>
              <th className="px-6 py-3.5 text-right">Avg Trip Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {MOCK_RIDES_REPORT.map((row, idx) => (
              <tr key={idx} className="hover:bg-slate-50/80 transition">
                <td className="px-6 py-4 font-mono text-xs text-indigo-700 font-semibold">{row.Date}</td>
                <td className="px-6 py-4 font-semibold text-slate-900">{row.TotalBookings}</td>
                <td className="px-6 py-4 text-emerald-600 font-semibold">{row.CompletedRides}</td>
                <td className="px-6 py-4 text-rose-600 font-semibold">{row.CancelledRides}</td>
                <td className="px-6 py-4 text-right text-xs text-slate-600">{row.AvgDurationMins} minutes</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}