'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { CashCollectionDiscrepancy } from '@/types';
import { formatPaiseToInr, parseInrInputToPaise } from '@/lib/currency';
import { createIdempotencyHeader } from '@/lib/idempotency';
import { getErrorMessage } from '@/lib/errors';
import {
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Flag,
} from 'lucide-react';

interface FallbackDriver {
  driverId: string;
  driverName?: string;
  phoneMasked?: string;
  cashLimitPaise?: number;
  cashHeldPaise?: number;
}

export default function CashCollectionsPage() {
  const queryClient = useQueryClient();

  // Selected item for action modal
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState<CashCollectionDiscrepancy | null>(
    null
  );
  const [actionType, setActionType] = useState<'ACCEPT_DRIVER' | 'ADJUST_LEDGER' | 'FLAG_FOR_REVIEW' | null>(
    null
  );
  const [reasonCode, setReasonCode] = useState('CASH_MISMATCH_VERIFIED');
  const [notes, setNotes] = useState('');
  const [adjustmentInr, setAdjustmentInr] = useState('');

  // Feedback banner
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Fetch cash discrepancies
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-cash-collections'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/cash-collections');
        return res.data;
      } catch (err: unknown) {
        // Fallback: If cash-collections endpoint isn't mounted, try drivers over cash limit
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const fallback = await apiClient.get('/admin/balances/drivers?overLimit=true');
          const drivers: FallbackDriver[] = fallback.data?.data?.items || fallback.data?.data || [];
          return {
            success: true,
            data: drivers.map((d) => ({
              id: d.driverId,
              rideId: 'N/A',
              driverId: d.driverId,
              driverName: d.driverName || 'Driver Partner',
              driverPhoneMasked: d.phoneMasked || '+91 ••••• •••••',
              expectedFarePaise: d.cashLimitPaise || 200000,
              reportedCollectedPaise: d.cashHeldPaise || 0,
              differencePaise: (d.cashHeldPaise || 0) - (d.cashLimitPaise || 200000),
              status: 'PENDING_REVIEW',
              reportedAt: new Date().toISOString(),
            })),
          };
        }
        throw err;
      }
    },
  });

  const discrepancies: CashCollectionDiscrepancy[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.items)
      ? data.data.items
      : [];

  // Resolution Mutation
  const resolveMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      actionReason,
      actionNotes,
      adjustmentPaise,
    }: {
      id: string;
      action: 'ACCEPT_DRIVER' | 'ADJUST_LEDGER' | 'FLAG_FOR_REVIEW';
      actionReason: string;
      actionNotes: string;
      adjustmentPaise?: number;
    }) => {
      const headers = createIdempotencyHeader('cash_resolve', id);
      try {
        const res = await apiClient.post(
          `/admin/cash-collections/${id}/resolve`,
          {
            action,
            reasonCode: actionReason,
            notes: actionNotes,
            adjustmentPaise,
          },
          { headers }
        );
        return res.data;
      } catch (err: unknown) {
        // Fallback for deposit if adjust ledger
        if (action === 'ADJUST_LEDGER' && adjustmentPaise && selectedDiscrepancy?.driverId) {
          const depositRes = await apiClient.post(
            `/admin/drivers/${selectedDiscrepancy.driverId}/cash-deposits`,
            { amountPaise: adjustmentPaise, reference: actionNotes || 'Cash Collection Adjustment' },
            { headers }
          );
          return depositRes.data;
        }
        throw err;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-cash-collections'] });
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      queryClient.invalidateQueries({ queryKey: ['admin-ledger'] });
      setFeedback({
        type: 'success',
        message: `Discrepancy ${variables.id} successfully updated with action: ${variables.action}.`,
      });
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err) || 'Failed to process cash action. Please check your role permissions.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  const openActionModal = (
    item: CashCollectionDiscrepancy,
    action: 'ACCEPT_DRIVER' | 'ADJUST_LEDGER' | 'FLAG_FOR_REVIEW'
  ) => {
    setSelectedDiscrepancy(item);
    setActionType(action);
    setReasonCode('CASH_MISMATCH_VERIFIED');
    setNotes('');
    setAdjustmentInr((Math.abs(item.differencePaise) / 100).toFixed(2));
    setFeedback(null);
  };

  const closeModal = () => {
    setSelectedDiscrepancy(null);
    setActionType(null);
    setNotes('');
  };

  const handleActionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDiscrepancy || !actionType) return;

    let adjPaise: number | undefined;
    if (actionType === 'ADJUST_LEDGER') {
      try {
        adjPaise = parseInrInputToPaise(adjustmentInr);
        if (adjPaise <= 0) {
          setFeedback({ type: 'error', message: 'Adjustment amount must be positive.' });
          return;
        }
      } catch {
        setFeedback({ type: 'error', message: 'Please enter a valid rupee amount.' });
        return;
      }
    }

    resolveMutation.mutate({
      id: selectedDiscrepancy.id,
      action: actionType,
      actionReason: reasonCode,
      actionNotes: notes,
      adjustmentPaise: adjPaise,
    });
  };

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
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Driver Cash Collection Discrepancies
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Review and reconcile mismatches between customer cash fares and driver-declared cash receipts.
            </p>
          </div>
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

      {/* Discrepancies Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Driver Partner</th>
              <th className="px-6 py-3.5">Ride Reference</th>
              <th className="px-6 py-3.5">Expected Fare</th>
              <th className="px-6 py-3.5">Reported Cash</th>
              <th className="px-6 py-3.5">Discrepancy</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Operational Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Auditing cash collection discrepancies...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-rose-600">
                  <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-rose-500" />
                  <span>Failed to load cash discrepancies. {getErrorMessage(error)}</span>
                </td>
              </tr>
            ) : discrepancies.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                  Zero cash collection discrepancies flagged across all active drivers.
                </td>
              </tr>
            ) : (
              discrepancies.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900">{c.driverName}</p>
                    <span className="text-[11px] font-mono text-slate-400">{c.driverPhoneMasked || c.driverId}</span>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-indigo-700">{c.rideId}</td>
                  <td className="px-6 py-4 font-mono text-slate-700">
                    {formatPaiseToInr(c.expectedFarePaise)}
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-slate-900">
                    {formatPaiseToInr(c.reportedCollectedPaise)}
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-rose-600">
                    -{formatPaiseToInr(Math.abs(c.differencePaise))}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.status === 'ACCEPTED_DRIVER'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : c.status === 'ADJUSTED_LEDGER'
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                            : c.status === 'FLAGGED'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      onClick={() => openActionModal(c, 'ACCEPT_DRIVER')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-semibold transition"
                      title="Accept driver-reported amount as final"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => openActionModal(c, 'ADJUST_LEDGER')}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-semibold transition"
                      title="Post compensating adjustment to driver balance"
                    >
                      Adjust
                    </button>
                    <button
                      onClick={() => openActionModal(c, 'FLAG_FOR_REVIEW')}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-semibold transition"
                      title="Flag discrepancy for fraud & audit review"
                    >
                      <Flag className="h-3 w-3 inline" /> Flag
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation & Adjustment Modal */}
      {selectedDiscrepancy && actionType && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {actionType === 'ACCEPT_DRIVER' && 'Confirm Accept Driver Receipt'}
                {actionType === 'ADJUST_LEDGER' && 'Execute Compensating Ledger Adjustment'}
                {actionType === 'FLAG_FOR_REVIEW' && 'Flag Cash Discrepancy for Audit'}
              </h3>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Driver Partner:</span>
                <span className="font-semibold text-slate-900">{selectedDiscrepancy.driverName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Expected Fare:</span>
                <span className="font-mono">{formatPaiseToInr(selectedDiscrepancy.expectedFarePaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Driver Reported Cash:</span>
                <span className="font-mono font-bold text-slate-900">
                  {formatPaiseToInr(selectedDiscrepancy.reportedCollectedPaise)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-600 font-medium">Variance (Shortfall):</span>
                <span className="font-mono font-bold text-rose-600">
                  -{formatPaiseToInr(Math.abs(selectedDiscrepancy.differencePaise))}
                </span>
              </div>
            </div>

            <form onSubmit={handleActionSubmit} className="space-y-3">
              {actionType === 'ADJUST_LEDGER' && (
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Adjustment Amount (₹ INR)
                  </label>
                  <input
                    type="text"
                    value={adjustmentInr}
                    onChange={(e) => setAdjustmentInr(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Debit or deposit amount to be compensated into driver ledger balance.
                  </p>
                </div>
              )}

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Resolution Audit Reason
                </label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                >
                  <option value="CASH_MISMATCH_VERIFIED">Driver Cash Shortfall Verified</option>
                  <option value="CUSTOMER_DISCOUNT_DISPUTE">Customer Applied Coupon / Cash Discount</option>
                  <option value="BANK_DEPOSIT_RECONCILED">Driver Verified Bank Deposit Slip</option>
                  <option value="FLAGGED_POLICY_VIOLATION">Suspected Platform Policy Infraction</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Operational Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Mandatory notes for finance & compliance review..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolveMutation.isPending}
                  className={`px-4 py-2 rounded-lg text-white font-semibold transition disabled:opacity-60 ${
                    actionType === 'FLAG_FOR_REVIEW'
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {resolveMutation.isPending ? 'Processing...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
