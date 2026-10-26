'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { RideRecord, RideStatus } from '@/types';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import { Search, Eye } from 'lucide-react';

const STATUS_FILTERS: { label: string; value: RideStatus | 'ALL' }[] = [
  { label: 'All States', value: 'ALL' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Driver Assigned', value: 'DRIVER_ASSIGNED' },
  { label: 'Dispatching', value: 'DISPATCHING' },
];

export default function RideExplorerPage() {
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<RideStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchRides = async () => {
    setLoading(true);
    try {
      const statusParam = selectedStatus !== 'ALL' ? `&status=${selectedStatus}` : '';
      const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';
      const res = await apiClient.get(`/admin/rides?page=1&limit=50${statusParam}${searchParam}`);
      setRides(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRides();
  }, [selectedStatus]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRides();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Ride Lifecycle Explorer</h1>
          <p className="text-xs text-slate-500 mt-1">Audit trips, state transitions, fare breakdowns, and route paths.</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-wrap bg-white border border-slate-200 p-1 rounded-xl shadow-xs">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setSelectedStatus(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                selectedStatus === f.value ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex items-center space-x-2 w-full md:w-80">
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search Ride ID, Customer or Driver..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
          >
            Filter
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Ride Reference</th>
              <th className="px-6 py-3.5">Passenger</th>
              <th className="px-6 py-3.5">Assigned Driver</th>
              <th className="px-6 py-3.5">Total Fare</th>
              <th className="px-6 py-3.5">Trip Status</th>
              <th className="px-6 py-3.5">Payment</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">Loading trips...</td></tr>
            ) : (
              rides.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-mono font-bold text-indigo-700 text-xs">{r.id}</p>
                    <span className="text-[10px] text-slate-400">{formatToIST(r.requestedAt)}</span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{r.customerName}</p>
                    <span className="text-[11px] font-mono text-slate-500">{r.customerPhoneMasked}</span>
                  </td>
                  <td className="px-6 py-4">
                    {r.driverName ? (
                      <>
                        <p className="font-semibold text-slate-900 text-xs">{r.driverName}</p>
                        <span className="text-[11px] font-mono text-slate-500">{r.vehicleRegistration}</span>
                      </>
                    ) : (
                      <span className="text-slate-400 italic text-xs">Unassigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-slate-900 text-xs">
                    {formatPaiseToInr(r.fare.finalTotalPaise)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                        r.status === 'COMPLETED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : r.status === 'IN_PROGRESS'
                          ? 'bg-sky-50 text-sky-700 border border-sky-200'
                          : r.status === 'CANCELLED'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                        r.paymentStatus === 'PAID' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {r.paymentStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/rides/${r.id}`}
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition text-xs font-semibold"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Details</span>
                    </Link>
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