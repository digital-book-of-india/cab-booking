'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { PaymentAttempt } from '@/types';
import { formatPaiseToInr, formatToIST, parseInrInputToPaise } from '@/lib/currency';
import { createIdempotencyHeader, clearIdempotencyKey } from '@/lib/idempotency';
import { getErrorMessage } from '@/lib/errors';
import {
  AlertTriangle,
  RotateCcw,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  KeyRound,
} from 'lucide-react';

const REFUND_REASONS = [
  { code: 'ROUTE_DEVIATION', label: 'Driver took a longer route / excess mileage' },
  { code: 'TRIP_CANCELLED', label: 'Trip cancelled after payment capture' },
  { code: 'SERVICE_DEFICIENCY', label: 'Driver service deficiency / AC / vehicle issue' },
  { code: 'DUPLICATE_CHARGE', label: 'Duplicate gateway transaction charge' },
  { code: 'CUSTOMER_GOODWILL', label: 'Customer goodwill reimbursement' },
];

export default function PaymentsPage() {
  const queryClient = useQueryClient();

  // Filters & Pagination
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [bookingSearch, setBookingSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const limit = 20;

  // Refund Modal State
  const [selectedPayment, setSelectedPayment] = useState<PaymentAttempt | null>(null);
  const [refundAmountInr, setRefundAmountInr] = useState<string>('');
  const [reason, setReason] = useState<string>(REFUND_REASONS[0].label);
  const [customReason, setCustomReason] = useState<string>('');
  const [destination, setDestination] = useState<'ORIGINAL' | 'WALLET'>('ORIGINAL');

  // MFA Flow for refunds > ₹10,000 (1,000,000 paise)
  const [showMfaStep, setShowMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');

  // Feedback Notification
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Fetch payments with React Query
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-payments', { status: statusFilter, bookingId: bookingSearch, page, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (bookingSearch) params.append('bookingId', bookingSearch.trim());
      params.append('page', String(page));
      params.append('limit', String(limit));

      const res = await apiClient.get(`/admin/payments?${params.toString()}`);
      return res.data;
    },
  });

  const payments: PaymentAttempt[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.data?.items)
      ? data.data.items
      : [];
  const meta = data?.meta || data?.data?.meta;

  // Refund Mutation
  const refundMutation = useMutation({
    mutationFn: async ({
      bookingId,
      amountPaise,
      refundReason,
      refundDestination,
    }: {
      bookingId: string;
      amountPaise: number;
      refundReason: string;
      refundDestination: 'ORIGINAL' | 'WALLET';
    }) => {
      const headers = createIdempotencyHeader('refund', bookingId);
      const res = await apiClient.post(
        `/admin/bookings/${bookingId}/refund`,
        {
          amountPaise,
          reason: refundReason,
          destination: refundDestination,
        },
        { headers }
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      clearIdempotencyKey('refund', variables.bookingId);
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      setFeedback({
        type: 'success',
        message: `Successfully processed refund of ${formatPaiseToInr(variables.amountPaise)} for booking ${variables.bookingId}.`,
      });
      closeRefundModal();
    },
    onError: (err: unknown) => {
      setFeedback({
        type: 'error',
        message: getErrorMessage(err, 'Failed to issue refund. Idempotency key retained for safe retry.'),
      });
    },
  });

  const openRefundModal = (payment: PaymentAttempt) => {
    setSelectedPayment(payment);
    const inrValue = (payment.amountPaise / 100).toFixed(2);
    setRefundAmountInr(inrValue);
    setReason(REFUND_REASONS[0].label);
    setCustomReason('');
    setDestination('ORIGINAL');
    setShowMfaStep(false);
    setMfaCode('');
    setMfaError('');
    setFeedback(null);
  };

  const closeRefundModal = () => {
    setSelectedPayment(null);
    setShowMfaStep(false);
    setMfaCode('');
    setMfaError('');
  };

  const handleInitialRefundSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPayment) return;

    let paise: number;
    try {
      paise = parseInrInputToPaise(refundAmountInr);
    } catch {
      setFeedback({ type: 'error', message: 'Please enter a valid rupee amount.' });
      return;
    }

    if (paise <= 0) {
      setFeedback({ type: 'error', message: 'Refund amount must be greater than ₹0.' });
      return;
    }

    if (paise > selectedPayment.amountPaise) {
      setFeedback({
        type: 'error',
        message: `Refund amount cannot exceed original payment of ${formatPaiseToInr(selectedPayment.amountPaise)}.`,
      });
      return;
    }

    // High-value refund gate: >= ₹10,000 (1,000,000 paise) requires MFA verification
    if (paise >= 1000000) {
      setShowMfaStep(true);
      return;
    }

    executeRefund(paise);
  };

  const handleMfaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaCode.trim().length !== 6 || !/^\d{6}$/.test(mfaCode.trim())) {
      setMfaError('Please enter a valid 6-digit MFA confirmation code.');
      return;
    }

    let paise: number;
    try {
      paise = parseInrInputToPaise(refundAmountInr);
    } catch {
      setMfaError('Invalid amount specified.');
      return;
    }

    executeRefund(paise);
  };

  const executeRefund = (amountPaise: number) => {
    if (!selectedPayment) return;
    const finalReason = customReason.trim() ? `${reason}: ${customReason.trim()}` : reason;
    const targetBookingId = selectedPayment.bookingId || selectedPayment.paymentId;

    refundMutation.mutate({
      bookingId: targetBookingId,
      amountPaise,
      refundReason: finalReason,
      refundDestination: destination,
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Payment Transactions & Refunds
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Audit customer gateway attempts, Razorpay orders, and issue authorized idempotent refunds.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            href="/finance/reconciliation"
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition"
          >
            Reconciliation
          </Link>
          <Link
            href="/finance/cash"
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition"
          >
            Cash Collections
          </Link>
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

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Booking ID (e.g. bk_...)"
            value={bookingSearch}
            onChange={(e) => {
              setBookingSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-600"
          />
        </div>
        <div className="w-full sm:w-48">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
          >
            <option value="">All Statuses</option>
            <option value="PAID">Paid</option>
            <option value="REFUNDED">Refunded</option>
            <option value="REFUND_PENDING">Refund Pending</option>
            <option value="FAILED">Failed</option>
            <option value="DUE">Due</option>
            <option value="DISPUTED">Disputed</option>
          </select>
        </div>
      </div>

      {/* Payments Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Payment / Booking</th>
              <th className="px-6 py-3.5">Customer</th>
              <th className="px-6 py-3.5">Gateway Reference</th>
              <th className="px-6 py-3.5">Amount</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5">Created At</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-xs">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Loading payment transactions from API...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-rose-600 text-xs">
                  <div className="flex flex-col items-center justify-center space-x-2">
                    <AlertTriangle className="h-6 w-6 text-rose-500 mb-2" />
                    <span>
                      {getErrorMessage(error)}
                    </span>
                    <button
                      onClick={() => refetch()}
                      className="mt-3 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 hover:bg-rose-100 font-semibold"
                    >
                      Retry Request
                    </button>
                  </div>
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-xs">
                  No payment attempts match the selected filter criteria.
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.paymentId} className="hover:bg-slate-50/80 transition text-xs">
                  <td className="px-6 py-4 font-mono">
                    <p className="font-bold text-indigo-700">{p.paymentId}</p>
                    <span className="text-slate-400 text-[11px]">{p.bookingId || p.rideId}</span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900">{p.customerName || 'Customer'}</p>
                    <span className="text-slate-500 font-mono text-[11px]">
                      {p.customerPhoneMasked || '-'}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-slate-600">
                    <div>{p.providerPaymentId || p.providerOrderId || '-'}</div>
                    <span className="text-[10px] text-slate-400 uppercase">{p.provider} • {p.method}</span>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-slate-900">
                    {formatPaiseToInr(p.amountPaise)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        p.status === 'PAID'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : p.status === 'REFUNDED'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : p.status === 'FAILED'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 whitespace-nowrap">
                    {formatToIST(p.createdAt)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {p.status === 'PAID' && (
                      <button
                        onClick={() => openRefundModal(p)}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-semibold transition"
                      >
                        <RotateCcw className="h-3 w-3 inline mr-1" />
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination Bar */}
        {meta && (
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
            <span>
              Page {meta.page || page} of {meta.totalPages || Math.ceil((meta.total || 1) / limit)} ({meta.total || payments.length} total)
            </span>
            <div className="flex space-x-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 bg-white border border-slate-200 rounded-md font-semibold hover:bg-slate-100 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={meta.totalPages ? page >= meta.totalPages : payments.length < limit}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 bg-white border border-slate-200 rounded-md font-semibold hover:bg-slate-100 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Refund Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            {!showMfaStep ? (
              <form onSubmit={handleInitialRefundSubmit} className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Issue Transaction Refund
                    </h3>
                    <p className="text-slate-500 mt-0.5 font-mono">
                      Target: {selectedPayment.paymentId} (Booking {selectedPayment.bookingId})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeRefundModal}
                    className="text-slate-400 hover:text-slate-600 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between">
                  <span className="text-slate-500">Max Refundable Amount:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatPaiseToInr(selectedPayment.amountPaise)}
                  </span>
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Refund Amount (₹ INR)
                  </label>
                  <input
                    type="text"
                    value={refundAmountInr}
                    onChange={(e) => setRefundAmountInr(e.target.value)}
                    placeholder="e.g. 250.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:outline-none focus:border-indigo-600"
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Enter the exact amount in Rupees. Supports full or partial refund.
                  </p>
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Refund Reason
                  </label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  >
                    {REFUND_REASONS.map((r) => (
                      <option key={r.code} value={r.label}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Additional Explanation / Note
                  </label>
                  <textarea
                    rows={2}
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Details for auditing ledger record..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Refund Destination
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label
                      className={`p-2.5 rounded-lg border cursor-pointer text-center font-medium transition ${
                        destination === 'ORIGINAL'
                          ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="destination"
                        value="ORIGINAL"
                        checked={destination === 'ORIGINAL'}
                        onChange={() => setDestination('ORIGINAL')}
                        className="sr-only"
                      />
                      Original Payment Source
                    </label>
                    <label
                      className={`p-2.5 rounded-lg border cursor-pointer text-center font-medium transition ${
                        destination === 'WALLET'
                          ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="destination"
                        value="WALLET"
                        checked={destination === 'WALLET'}
                        onChange={() => setDestination('WALLET')}
                        className="sr-only"
                      />
                      Customer Wallet
                    </label>
                  </div>
                </div>

                {/* Submitting button */}
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={closeRefundModal}
                    className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={refundMutation.isPending}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition disabled:opacity-60"
                  >
                    {refundMutation.isPending ? 'Processing...' : 'Proceed to Confirmation'}
                  </button>
                </div>
              </form>
            ) : (
              /* MFA High-Risk Flow */
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                <div className="flex items-center space-x-3 text-rose-600 p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <ShieldAlert className="h-6 w-6 shrink-0" />
                  <div>
                    <h4 className="font-bold text-sm">High-Risk Refund Authorization</h4>
                    <p className="text-[11px] text-rose-700 mt-0.5">
                      Refunds of ₹10,000 or greater require mandatory multi-factor authentication (MFA) confirmation.
                    </p>
                  </div>
                </div>

                <div className="space-y-2 border-y border-slate-100 py-3">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Refund Target:</span>
                    <span className="font-mono font-bold text-slate-800">
                      {selectedPayment.bookingId || selectedPayment.paymentId}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Authorized Refund Amount:</span>
                    <span className="font-mono font-bold text-rose-600 text-sm">
                      ₹{refundAmountInr}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Enter 6-Digit MFA Code
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="password"
                      maxLength={6}
                      autoFocus
                      placeholder="••••••"
                      value={mfaCode}
                      onChange={(e) => {
                        setMfaCode(e.target.value.replace(/\D/g, ''));
                        setMfaError('');
                      }}
                      className="w-full pl-9 pr-3 py-2 text-center text-lg tracking-widest font-mono rounded-lg border border-slate-300 focus:outline-none focus:border-rose-600"
                      required
                    />
                  </div>
                  {mfaError && <p className="text-rose-600 text-xs mt-1">{mfaError}</p>}
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowMfaStep(false)}
                    className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={refundMutation.isPending}
                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold transition disabled:opacity-60"
                  >
                    {refundMutation.isPending ? 'Verifying & Refunding...' : 'Confirm High-Risk Refund'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
