'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { OutstandingBalanceItem } from '@/types';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import { useAuthStore } from '@/store/auth-store';
import { getErrorMessage } from '@/lib/errors';
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ShieldAlert,
} from 'lucide-react';

interface FallbackBooking {
  rideId?: string;
  publicId?: string;
  customerId: string;
  customerName?: string;
  customerPhoneMasked?: string;
  farePaise?: number;
  totalFarePaise?: number;
  paymentStatus?: string;
  completedAt?: string;
  createdAt?: string;
}

export default function OutstandingBalancesPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  // Write-off Modal State
  const [selectedItem, setSelectedItem] = useState<OutstandingBalanceItem | null>(null);
  const [writeOffReason, setWriteOffReason] = useState('Rider unreachable after 3 reminders');
  const [customExplanation, setCustomExplanation] = useState('');

  // Dispute Modal State
  const [disputeItem, setDisputeItem] = useState<OutstandingBalanceItem | null>(null);
  const [disputeReason, setDisputeReason] = useState('Customer claims trip fare calculation error');

  // Feedback Banner
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Fetch unpaid debts
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-outstanding'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/outstanding');
        return res.data;
      } catch (err: unknown) {
        const maybeAxios = err as { response?: { status?: number } };
        // Fallback: Query bookings with paymentStatus DUE if /admin/outstanding not mounted
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.get('/admin/bookings?paymentStatus=DUE&limit=50');
          const bookings: FallbackBooking[] = res.data?.data?.items || res.data?.data || [];
          return {
            success: true,
            data: bookings.map((b) => ({
              rideId: b.rideId || b.publicId || 'N/A',
              customerId: b.customerId,
              customerName: b.customerName || 'Customer',
              customerPhoneMasked: b.customerPhoneMasked || '+91 ••••• •••••',
              amountDuePaise: b.farePaise || b.totalFarePaise || 0,
              status: b.paymentStatus || 'DUE',
              bookingRestriction: b.paymentStatus === 'DUE' ? 'RESTRICTED' : 'ACTIVE',
              completedAt: b.completedAt || b.createdAt || new Date().toISOString(),
            })),
          };
        }
        throw err;
      }
    },
  });

  const items: OutstandingBalanceItem[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.items)
      ? data.data.items
      : [];

  // Write-off Mutation (Restricted to SUPER_ADMIN on backend)
  const writeOffMutation = useMutation({
    mutationFn: async ({
      rideId,
      bookingId,
      reason,
    }: {
      rideId: string;
      bookingId?: string;
      reason: string;
    }) => {
      const targetId = bookingId || rideId;
      try {
        const res = await apiClient.post(`/admin/bookings/${targetId}/write-off`, {
          reason,
        });
        return res.data;
      } catch (err: unknown) {
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          // Fallback to /admin/outstanding/:rideId/write-off
          const res = await apiClient.post(`/admin/outstanding/${rideId}/write-off`, {
            reasonCode: 'UNCOLLECTIBLE_DEFAULT',
            notes: reason,
          });
          return res.data;
        }
        throw err;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-outstanding'] });
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      setFeedback({
        type: 'success',
        message: `Outstanding balance for ${variables.rideId} successfully written off. Loss absorbed by platform.`,
      });
      setSelectedItem(null);
    },
    onError: (err: unknown) => {
      const maybeAxios = err as { response?: { status?: number } };
      const status = maybeAxios?.response?.status;
      const msg =
        status === 403
          ? 'Access Denied: Writing off customer debt is strictly restricted to SUPER_ADMIN by server policy.'
          : getErrorMessage(err) || 'Failed to execute debt write-off.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  // Dispute Mutation
  const disputeMutation = useMutation({
    mutationFn: async ({
      rideId,
      bookingId,
      disputeNotes,
    }: {
      rideId: string;
      bookingId?: string;
      disputeNotes: string;
    }) => {
      const targetId = bookingId || rideId;
      try {
        const res = await apiClient.patch(`/admin/bookings/${targetId}/payment-dispute`, {
          disputed: true,
          reason: disputeNotes,
        });
        return res.data;
      } catch (err: unknown) {
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.post(`/admin/outstanding/${rideId}/dispute`);
          return res.data;
        }
        throw err;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-outstanding'] });
      setFeedback({
        type: 'success',
        message: `Dispute logged on ${variables.rideId}. Booking restrictions lifted while under operational review.`,
      });
      setDisputeItem(null);
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err) || 'Failed to update payment dispute.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  const handleWriteOffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    const finalReason = customExplanation.trim()
      ? `${writeOffReason}: ${customExplanation.trim()}`
      : writeOffReason;

    writeOffMutation.mutate({
      rideId: selectedItem.rideId,
      bookingId: (selectedItem as { bookingId?: string }).bookingId,
      reason: finalReason,
    });
  };

  const handleDisputeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeItem) return;
    disputeMutation.mutate({
      rideId: disputeItem.rideId,
      bookingId: (disputeItem as { bookingId?: string }).bookingId,
      disputeNotes: disputeReason,
    });
  };

  const totalOutstandingPaise = items.reduce((acc, curr) => acc + (curr.amountDuePaise || 0), 0);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/finance/payments"
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Customer Outstanding Debts
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                Logged as: {user?.role || 'FINANCE'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Monitor unpaid customer trip fares, block delinquent accounts, or process authorized bad debt write-offs.
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
              Total Uncollected
            </span>
            <span className="text-lg font-mono font-bold text-rose-600">
              {formatPaiseToInr(totalOutstandingPaise)}
            </span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Debts Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Customer</th>
              <th className="px-6 py-3.5">Ride Reference</th>
              <th className="px-6 py-3.5">Unpaid Amount</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5">App Booking Status</th>
              <th className="px-6 py-3.5">Trip Completed</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Loading outstanding debts...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-rose-600">
                  <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-rose-500" />
                  <span>Failed to load outstanding debts. {getErrorMessage(error)}</span>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                  Zero outstanding customer debts recorded on platform.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.rideId} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900">{item.customerName}</p>
                    <span className="text-[11px] font-mono text-slate-400">
                      {item.customerPhoneMasked}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-indigo-700">{item.rideId}</td>
                  <td className="px-6 py-4 font-mono font-bold text-rose-600">
                    {formatPaiseToInr(item.amountDuePaise)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.status === 'DISPUTED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : item.status === 'WRITTEN_OFF'
                            ? 'bg-slate-100 text-slate-600 border border-slate-300'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.bookingRestriction === 'RESTRICTED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {item.bookingRestriction === 'RESTRICTED'
                        ? '🚫 RIDES BLOCKED'
                        : 'ALLOWED'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500">
                    {formatToIST(item.completedAt)}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => setDisputeItem(item)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100 font-semibold transition"
                    >
                      Log Dispute
                    </button>
                    <button
                      onClick={() => setSelectedItem(item)}
                      title={
                        isSuperAdmin
                          ? 'Absorb bad debt as company loss'
                          : 'Requires SUPER_ADMIN server authorization'
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-semibold transition"
                    >
                      Write-off Debt
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Write-off Confirmation Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="h-5 w-5 text-rose-600" />
                <h3 className="text-base font-bold text-slate-900">
                  Authorize Bad Debt Write-off
                </h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-800 space-y-1">
              <p className="font-semibold text-rose-900">
                Warning: Irreversible Accounting Action
              </p>
              <p>
                Writing off this debt clears customer liability and books{' '}
                <strong className="font-mono">
                  {formatPaiseToInr(selectedItem.amountDuePaise)}
                </strong>{' '}
                as bad debt loss against the company platform ledger.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-semibold text-slate-900">{selectedItem.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ride Ref:</span>
                <span className="font-mono">{selectedItem.rideId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount Due:</span>
                <span className="font-mono font-bold text-rose-600">
                  {formatPaiseToInr(selectedItem.amountDuePaise)}
                </span>
              </div>
            </div>

            <form onSubmit={handleWriteOffSubmit} className="space-y-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Reason for Write-off (Mandatory)
                </label>
                <select
                  value={writeOffReason}
                  onChange={(e) => setWriteOffReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                >
                  <option value="Rider unreachable after 3 reminders">
                    Rider unreachable after 3 reminders
                  </option>
                  <option value="Customer bankruptcy / insolvable dispute">
                    Customer bankruptcy / insolvable dispute
                  </option>
                  <option value="Operational goodwill waiver (VIP)">
                    Operational goodwill waiver (VIP)
                  </option>
                  <option value="Payment gateway non-recoverable chargeback">
                    Payment gateway non-recoverable chargeback
                  </option>
                  <option value="Other audited administrative clearance">
                    Other audited administrative clearance
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Additional Notes / Auditable Justification
                </label>
                <textarea
                  rows={2}
                  value={customExplanation}
                  onChange={(e) => setCustomExplanation(e.target.value)}
                  placeholder="Provide supporting details or approval reference..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={writeOffMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-xs disabled:opacity-60"
                >
                  {writeOffMutation.isPending ? 'Writing off...' : 'Confirm Debt Write-off'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dispute Modal */}
      {disputeItem && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Log Customer Trip Dispute
              </h3>
              <button
                onClick={() => setDisputeItem(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <p className="text-slate-600">
                Logging a dispute temporarily lifts rider app restrictions while the fare calculation is reviewed by operations.
              </p>
            </div>

            <form onSubmit={handleDisputeSubmit} className="space-y-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Dispute Reason
                </label>
                <textarea
                  rows={3}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDisputeItem(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disputeMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-xs disabled:opacity-60"
                >
                  {disputeMutation.isPending ? 'Saving...' : 'Submit Dispute'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
