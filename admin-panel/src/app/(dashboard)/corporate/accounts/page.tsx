'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { CorporateAccount } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';

export default function CorporateAccountsPage() {
  const [accounts, setAccounts] = useState<CorporateAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const fetchCorporate = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await apiClient.get('/admin/corporate/accounts');
      const raw = res.data?.data;
      const list = Array.isArray(raw) ? raw : [];

      const normalized: CorporateAccount[] = list.map((c: Record<string, unknown>) => {
        const id = String(c.id || c.companyId || '');
        const companyName = String(c.companyName || c.name || 'Unnamed Company');
        const contactEmail = String(c.contactEmail || c.billingEmail || '—');
        const contactPhoneMasked = String(c.contactPhoneMasked || '—');
        const gstNumber = String(c.gstNumber || c.gstin || '—');
        const monthlyCreditLimitPaise = Number(
          c.monthlyCreditLimitPaise ?? c.creditLimitPaise ?? 0
        );
        const currentOutstandingPaise = Number(
          c.currentOutstandingPaise ?? (c as { owedPaise?: number }).owedPaise ?? 0
        );
        const status =
          (c.status === 'ACTIVE'
            ? 'APPROVED'
            : (c.status as CorporateAccount['status'])) || 'APPROVED';

        return {
          id,
          companyName,
          contactEmail,
          contactPhoneMasked,
          gstNumber,
          monthlyCreditLimitPaise,
          currentOutstandingPaise,
          status,
          rejectionReason: c.rejectionReason as string | undefined,
          createdAt: String(c.createdAt || new Date().toISOString()),
        };
      });

      setAccounts(normalized);
    } catch (err: unknown) {
      console.error('Failed to load corporate accounts:', err);
      const apiErr = err as {
        response?: { data?: { error?: { message?: string } } };
        message?: string;
      };
      const message =
        apiErr?.response?.data?.error?.message ||
        apiErr?.message ||
        'Failed to load corporate client accounts. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCorporate();
  }, []);

  const handleApprove = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setActionLoadingId(id);
    setError(null);

    try {
      await apiClient.patch(
        `/admin/corporate/accounts/${encodeURIComponent(id)}/approval`,
        {
          status,
          reasonCode:
            status === 'APPROVED' ? 'CORPORATE_KYC_VERIFIED' : 'TAX_NUMBER_MISMATCH',
        }
      );
      await fetchCorporate();
    } catch (err: unknown) {
      console.error('Failed to update corporate approval status:', err);
      const apiErr = err as {
        response?: { data?: { error?: { message?: string } } };
        message?: string;
      };
      const message =
        apiErr?.response?.data?.error?.message ||
        apiErr?.message ||
        'Failed to update corporate account status.';
      setError(message);
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Corporate Client Profiles
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Review enterprise onboarding, credit limits, and billing status.
          </p>
        </div>
        <Link
          href="/corporate/invoices"
          className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700"
        >
          View Monthly Invoices
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchCorporate()}
            className="ml-3 font-semibold underline hover:text-rose-900"
          >
            Retry
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
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
              <tr key="corporate-loading-row">
                <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                  Loading corporate accounts...
                </td>
              </tr>
            ) : error && accounts.length === 0 ? (
              <tr key="corporate-error-row">
                <td colSpan={6} className="px-6 py-8 text-center text-rose-500">
                  {error}
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr key="corporate-empty-row">
                <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                  No corporate accounts found.
                </td>
              </tr>
            ) : (
              accounts.map((c) => {
                const isActionInProgress = actionLoadingId === c.id;
                return (
                  <tr key={c.id} className="transition hover:bg-slate-50/80">
                    <td className="px-6 py-4">
                      <p className="text-xs font-semibold text-slate-900">
                        {c.companyName}
                      </p>
                      <span className="text-[11px] text-slate-500">
                        {c.contactEmail}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-600">
                      {c.gstNumber}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-semibold text-slate-800">
                      {formatPaiseToInr(c.monthlyCreditLimitPaise)}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs font-semibold text-rose-600">
                      {formatPaiseToInr(c.currentOutstandingPaise)}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          c.status === 'APPROVED'
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border border-amber-200 bg-amber-50 text-amber-700'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="space-x-2 px-6 py-4 text-right">
                      {c.status === 'PENDING_APPROVAL' && (
                        <>
                          <button
                            type="button"
                            disabled={isActionInProgress}
                            onClick={() => void handleApprove(c.id, 'APPROVED')}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={isActionInProgress}
                            onClick={() => void handleApprove(c.id, 'REJECTED')}
                            className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
