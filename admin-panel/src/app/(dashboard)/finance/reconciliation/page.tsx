'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { GatewayReconciliationItem } from '@/types';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import { ArrowLeft } from 'lucide-react';

export default function ReconciliationPage() {
  const [items, setItems] = useState<GatewayReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReconciliations = async () => {
    try {
      const res = await apiClient.get('/admin/payments/reconciliation');
      setItems(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReconciliations();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Link href="/finance/payments" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Gateway Reconciliation Desk</h1>
          <p className="text-xs text-slate-500 mt-0.5">Identify orphaned gateway transactions, webhook latency, and payment signature discrepancies.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Discrepancy Category</th>
              <th className="px-6 py-3.5">Provider Payment / Order ID</th>
              <th className="px-6 py-3.5">System Amount</th>
              <th className="px-6 py-3.5">Gateway Amount</th>
              <th className="px-6 py-3.5">Detected At</th>
              <th className="px-6 py-3.5 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Checking reconciliation records...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Zero gateway discrepancies detected.</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <span className="font-semibold text-rose-600 text-xs">{item.discrepancyType.replace(/_/g, ' ')}</span>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">{item.id}</p>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-700">
                    <p className="font-semibold">{item.providerPaymentId}</p>
                    <span className="text-[10px] text-slate-400">{item.providerOrderId}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">{formatPaiseToInr(item.systemAmountPaise)}</td>
                  <td className="px-6 py-4 font-mono font-bold text-amber-700 text-xs">{formatPaiseToInr(item.gatewayAmountPaise)}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(item.detectedAt)}</td>
                  <td className="px-6 py-4 text-right">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      {item.status}
                    </span>
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