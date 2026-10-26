'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { OutstandingBalanceItem } from '@/types';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import { useAuthStore } from '@/store/auth-store';
import { ArrowLeft, AlertCircle, Ban, FileWarning } from 'lucide-react';

export default function OutstandingBalancesPage() {
  const { user } = useAuthStore();
  const [items, setItems] = useState<OutstandingBalanceItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOutstanding = async () => {
    try {
      const res = await apiClient.get('/admin/outstanding');
      setItems(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutstanding();
  }, []);

  const handleDispute = async (rideId: string) => {
    await apiClient.post(`/admin/outstanding/${rideId}/dispute`);
    fetchOutstanding();
  };

  const handleWriteOff = async (rideId: string) => {
    if (!confirm('SUPER_ADMIN Authorization: Confirm writing off this unpaid balance?')) return;
    await apiClient.post(`/admin/outstanding/${rideId}/write-off`, {
      reasonCode: 'UNCOLLECTIBLE_DEFAULT',
      notes: 'Administrative write-off authorized by Super Admin',
    });
    fetchOutstanding();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/finance/payments" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Customer Outstanding Balances & Risk Desk</h1>
            <p className="text-xs text-slate-400 mt-0.5">Monitor post-ride unpaid balances, manage collection disputes, and execute write-offs.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-800/40 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-6 py-3">Passenger</th>
              <th className="px-6 py-3">Completed Ride</th>
              <th className="px-6 py-3">Amount Due</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Booking Restriction</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">Loading outstanding ledger...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">Zero outstanding unpaid balances.</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.rideId} className="hover:bg-slate-800/30">
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-200">{item.customerName}</p>
                    <span className="text-[10px] font-mono text-slate-400">{item.customerPhoneMasked}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-indigo-400">{item.rideId}</td>
                  <td className="px-6 py-4 font-mono font-bold text-rose-400 text-xs">{formatPaiseToInr(item.amountDuePaise)}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      item.status === 'WRITTEN_OFF' ? 'bg-slate-800 text-slate-500' : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400">
                      {item.bookingRestriction}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    {item.status !== 'WRITTEN_OFF' && (
                      <>
                        <button
                          onClick={() => handleDispute(item.rideId)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                        >
                          Dispute
                        </button>

                        {/* Action RBAC: Only SUPER_ADMIN can execute write-off */}
                        {user?.role === 'SUPER_ADMIN' && (
                          <button
                            onClick={() => handleWriteOff(item.rideId)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600 hover:text-white text-xs font-medium transition"
                          >
                            Write Off
                          </button>
                        )}
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