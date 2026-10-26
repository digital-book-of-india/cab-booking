'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { CorporateAccount } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';

export default function CorporateAccountsPage() {
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCorporate = async () => {
    try {
      const res = await apiClient.get('/admin/corporate/accounts');
      setAccounts(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCorporate();
  }, []);

  const handleApprove = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    await apiClient.patch(`/admin/corporate/accounts/${id}/approval`, {
      status,
      reasonCode: status === 'APPROVED' ? 'CORPORATE_KYC_VERIFIED' : 'TAX_NUMBER_MISMATCH',
    });
    fetchCorporate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Corporate Client Profiles</h1>
          <p className="text-xs text-slate-500 mt-1">Review enterprise onboarding, credit limits, and billing status.</p>
        </div>
        <Link
          href="/corporate/invoices"
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
        >
          View Monthly Invoices
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Company Name</th>
              <th className="px-6 py-3.5">GST Number</th>
              <th className="px-6 py-3.5">Credit Limit</th>
              <th className="px-6 py-3.5">Current Balance</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Approval Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading corporate accounts...</td></tr>
            ) : (
              accounts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{c.companyName}</p>
                    <span className="text-[11px] text-slate-500">{c.contactEmail}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">{c.gstNumber}</td>
                  <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-800">{formatPaiseToInr(c.monthlyCreditLimitPaise)}</td>
                  <td className="px-6 py-4 font-mono text-xs text-rose-600 font-semibold">{formatPaiseToInr(c.currentOutstandingPaise)}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      c.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    {c.status === 'PENDING_APPROVAL' && (
                      <>
                        <button
                          onClick={() => handleApprove(c.id, 'APPROVED')}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleApprove(c.id, 'REJECTED')}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition"
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