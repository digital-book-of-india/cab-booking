'use client';

import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';

const MOCK_DRIVER_REPORT = [
  { Driver: 'Rajesh Kumar Verma', OnlineHours: 8.5, TripHours: 6.2, AcceptanceRatePct: 94, IdleMinutes: 138 },
  { Driver: 'Amit Sharma', OnlineHours: 9.0, TripHours: 7.5, AcceptanceRatePct: 98, IdleMinutes: 90 },
];

export default function DriversReportPage() {
  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(MOCK_DRIVER_REPORT);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drivers_Utilisation');
    XLSX.writeFile(wb, 'Driver_Utilisation_2026.xlsx');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Driver Fleet Utilisation Analytics</h1>
          <p className="text-xs text-slate-400 mt-1">Audit active online hours, engagement duration, and dispatch acceptance percentages.</p>
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
              <th className="px-6 py-3">Driver Partner</th>
              <th className="px-6 py-3">Total Online Hours</th>
              <th className="px-6 py-3">Active Trip Hours</th>
              <th className="px-6 py-3">Acceptance Ratio</th>
              <th className="px-6 py-3 text-right">Idle Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {MOCK_DRIVER_REPORT.map((row, idx) => (
              <tr key={idx} className="hover:bg-slate-800/30">
                <td className="px-6 py-4 font-semibold text-slate-200">{row.Driver}</td>
                <td className="px-6 py-4 text-xs font-mono">{row.OnlineHours}h</td>
                <td className="px-6 py-4 text-xs font-mono text-emerald-400 font-semibold">{row.TripHours}h</td>
                <td className="px-6 py-4 text-xs font-bold text-indigo-400">{row.AcceptanceRatePct}%</td>
                <td className="px-6 py-4 text-xs text-slate-400 text-right">{row.IdleMinutes} mins</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}