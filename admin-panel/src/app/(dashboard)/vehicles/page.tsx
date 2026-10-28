'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Vehicle } from '@/types';
import { CheckCircle2, AlertCircle, ArrowRight, X } from 'lucide-react';

export default function VehiclesPage() {
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    data: vehicles = [],
    isLoading: loading,
    refetch: fetchVehicles,
  } = useQuery<Vehicle[]>({
    queryKey: ['admin', 'vehicles'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/vehicles');
      return res.data.data;
    },
  });

  const handleVerify = async (vehicleId: string, status: 'VERIFIED' | 'REJECTED') => {
    try {
      await apiClient.patch(`/admin/vehicles/${vehicleId}/verification`, {
        status,
        reason: status === 'REJECTED' ? 'DOCUMENT_MISMATCH' : undefined,
      });
      setToast({
        type: 'success',
        text: `Vehicle ${status === 'VERIFIED' ? 'verified' : 'rejected'} successfully and logged in audit registry.`,
      });
      fetchVehicles();
    } catch {
      setToast({
        type: 'error',
        text: 'Failed to update vehicle verification status.',
      });
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`flex items-center justify-between p-4 rounded-xl border text-xs shadow-xs animate-in fade-in ${
            toast.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            {toast.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            )}
            <span>{toast.text}</span>
            {toast.type === 'success' && (
              <>
                <span>•</span>
                <Link
                  href="/settings/audit-logs"
                  className="font-bold text-emerald-700 hover:text-emerald-900 underline inline-flex items-center space-x-1"
                >
                  <span>View Audit Trail</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </>
            )}
          </div>
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Vehicle Registry & Verification</h1>
          <p className="text-xs text-slate-500 mt-1">Review vehicle registration, capacity, and commercial verification status.</p>
        </div>
        <Link
          href="/vehicles/categories"
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
        >
          Manage Cab Categories
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Registration</th>
              <th className="px-6 py-3.5">Make / Model</th>
              <th className="px-6 py-3.5">Category</th>
              <th className="px-6 py-3.5">Assigned Driver</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading fleet registry...</td></tr>
            ) : (
              vehicles.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4 font-mono font-bold text-slate-900 text-xs">{v.registrationNumber}</td>
                  <td className="px-6 py-4 text-xs font-medium text-slate-800">{v.makeModel} ({v.seats} Seats)</td>
                  <td className="px-6 py-4 font-semibold text-indigo-700 text-xs">{v.categoryName}</td>
                  <td className="px-6 py-4 text-xs text-slate-600">{v.driverName}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      v.verificationStatus === 'VERIFIED'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {v.verificationStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    {v.verificationStatus === 'PENDING' && (
                      <>
                        <button
                          onClick={() => handleVerify(v.id, 'VERIFIED')}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-semibold transition"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => handleVerify(v.id, 'REJECTED')}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-semibold transition"
                        >
                          Reject
                        </button>
                      </>
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