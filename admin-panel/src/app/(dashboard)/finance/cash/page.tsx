'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { CashCollectionDiscrepancy } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';
import { ArrowLeft } from 'lucide-react';

export default function CashCollectionsPage() {
  const [discrepancies, setDiscrepancies] = useState<CashCollectionDiscrepancy[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCash = async () => {
    try {
      const res = await apiClient.get('/admin/cash-collections');
      setDiscrepancies(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCash();
  }, []);

  const resolveCash = async (id: string, action: 'ACCEPT_DRIVER' | 'ADJUST_LEDGER' | 'FLAG_FOR_REVIEW') => {
    await apiClient.post(`/admin/cash-collections/${id}/resolve`, {
      action,
      reasonCode: 'CASH_MISMATCH_REVIEW',
      notes: 'Operational cash resolution decision',
    });
    fetchCash();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Link href="/finance/payments" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Driver Cash Collection Discrepancies</h1>
          <p className="text-xs text-slate-500 mt-0.5">Review mismatches between driver-declared cash receipts and expected final trip fares.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Driver Partner</th>
              <th className="px-6 py-3.5">Ride Reference</th>
              <th className="px-6 py-3.5">Expected Fare</th>
              <th className="px-6 py-3.5">Reported Cash</th>
              <th className="px-6 py-3.5">Discrepancy</th>
              <th className="px-6 py-3.5 text-right">Operational Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading cash collection audits...</td></tr>
            ) : discrepancies.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">No cash collection discrepancies flagged.</td></tr>
            ) : (
              discrepancies.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{c.driverName}</p>
                    <span className="text-[11px] font-mono text-slate-500">{c.driverPhoneMasked}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs font-bold text-indigo-700">{c.rideId}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-700">{formatPaiseToInr(c.expectedFarePaise)}</td>
                  <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">{formatPaiseToInr(c.reportedCollectedPaise)}</td>
                  <td className="px-6 py-4 font-mono text-xs font-bold text-rose-600">-{formatPaiseToInr(c.differencePaise)}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => resolveCash(c.id, 'ACCEPT_DRIVER')}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                    >
                      Accept Amount
                    </button>
                    <button
                      onClick={() => resolveCash(c.id, 'ADJUST_LEDGER')}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition"
                    >
                      Debit Ledger
                    </button>
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