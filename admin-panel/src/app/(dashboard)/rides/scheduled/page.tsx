'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { ScheduledRide } from '@/types';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import { ArrowLeft } from 'lucide-react';

export default function ScheduledRidesPage() {
  const [rides, setRides] = useState<ScheduledRide[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScheduled = async () => {
    try {
      const res = await apiClient.get('/admin/scheduled-rides');
      setRides(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScheduled();
  }, []);

  const handleCancelScheduled = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this scheduled booking?')) return;
    await apiClient.post(`/scheduled-rides/${id}/cancel`);
    fetchScheduled();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Link href="/rides" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Scheduled Rides Monitor</h1>
          <p className="text-xs text-slate-400 mt-0.5">Advance reservations, pre-allocation windows, and assignment status.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-800/40 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-6 py-3">Reservation ID</th>
              <th className="px-6 py-3">Passenger</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Pickup Window</th>
              <th className="px-6 py-3">Estimated Fare</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-slate-500">Loading scheduled bookings...</td>
              </tr>
            ) : rides.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-slate-500">No scheduled rides currently queued.</td>
              </tr>
            ) : (
              rides.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/30">
                  <td className="px-6 py-4 font-mono font-bold text-indigo-400 text-xs">{r.id}</td>
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-200">{r.customerName}</p>
                    <span className="text-[10px] font-mono text-slate-400">{r.customerPhoneMasked}</span>
                  </td>
                  <td className="px-6 py-4 text-xs font-semibold text-slate-300">{r.categoryName}</td>
                  <td className="px-6 py-4">
                    <p className="text-xs font-medium text-slate-200">{formatToIST(r.scheduledTime)}</p>
                    <span className="text-[10px] text-slate-400">Window: {r.allocationWindowMinutes}m before</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-100">
                    {formatPaiseToInr(r.estimatedFarePaise)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                      r.status === 'SCHEDULED' ? 'bg-indigo-500/10 text-indigo-300' : 'bg-rose-500/10 text-rose-300'
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {r.status === 'SCHEDULED' && (
                      <button
                        onClick={() => handleCancelScheduled(r.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600 hover:text-white text-xs font-medium transition"
                      >
                        Cancel
                      </button>
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