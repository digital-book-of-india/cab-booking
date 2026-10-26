'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { PaymentAttempt } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';
import { AlertTriangle } from 'lucide-react';

const REFUND_REASONS = [
  { code: 'TRIP_CANCELLATION', label: 'Trip Cancellation Billing Reversal' },
  { code: 'OVERCHARGED_ROUTE', label: 'Route Mileage Dispute Correction' },
  { code: 'SERVICE_DEFICIENCY', label: 'Driver Service Deficiency' },
  { code: 'GOODWILL_GESTURE', label: 'Customer Goodwill Reimbursement' },
];

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPayment, setSelectedPayment] = useState<PaymentAttempt | null>(null);
  const [reasonCode, setReasonCode] = useState(REFUND_REASONS[0].code);
  const [notes, setNotes] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchPayments = async () => {
    try {
      const res = await apiClient.get('/admin/payments');
      setPayments(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPayment) return;

    if (selectedPayment.amountPaise > 1000000 && mfaCode !== '123456') {
      alert('High-Risk Refund: Enter valid 6-digit MFA confirmation code (Mock default: 123456).');
      return;
    }

    setActionLoading(true);
    try {
      await apiClient.post(
        `/admin/payments/${selectedPayment.paymentId}/refund`,
        {
          amountPaise: selectedPayment.amountPaise,
          reasonCode,
          notes,
        },
        {
          headers: {
            'Idempotency-Key': `idemp_ref_${selectedPayment.paymentId}_${Date.now()}`,
          },
        }
      );

      setSelectedPayment(null);
      setMfaCode('');
      fetchPayments();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Payment Transactions & Refunds</h1>
          <p className="text-xs text-slate-500 mt-1">Audit customer gateway transactions, Razorpay IDs, and issue audited refunds.</p>
        </div>
        <div className="flex space-x-2">
          <Link href="/finance/reconciliation" className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition">
            Gateway Reconciliation
          </Link>
          <Link href="/finance/cash" className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition">
            Cash Collections
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Internal Payment ID</th>
              <th className="px-6 py-3.5">Passenger</th>
              <th className="px-6 py-3.5">Gateway Order / Payment Ref</th>
              <th className="px-6 py-3.5">Amount</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading payments...</td></tr>
            ) : (
              payments.map((p) => (
                <tr key={p.paymentId} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-mono font-bold text-indigo-700 text-xs">{p.paymentId}</p>
                    <span className="text-[11px] text-slate-400">Ride: {p.rideId}</span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{p.customerName}</p>
                    <span className="text-[11px] font-mono text-slate-500">{p.customerPhoneMasked}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">
                    <p>{p.providerPaymentId || '—'}</p>
                    <span className="text-[10px] text-slate-400">Order: {p.providerOrderId}</span>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-slate-900 text-xs">
                    {formatPaiseToInr(p.amountPaise)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      p.status === 'PAID' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {p.status === 'PAID' && (
                      <button
                        onClick={() => setSelectedPayment(p)}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold transition"
                      >
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedPayment && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Issue Gateway Refund</h3>
            <p className="text-xs text-slate-500">
              Transaction: <span className="font-mono text-indigo-700 font-semibold">{selectedPayment.paymentId}</span> • Amount: <strong className="text-slate-900 font-mono">{formatPaiseToInr(selectedPayment.amountPaise)}</strong>
            </p>

            {selectedPayment.amountPaise > 1000000 && (
              <div className="flex items-center space-x-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>High-Risk Transaction: Amounts above ₹10,000 require administrative step-up verification code.</span>
              </div>
            )}

            <form onSubmit={handleRefundSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Mandatory Refund Reason</label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                >
                  {REFUND_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Audit Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Record customer support reference or reason..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

              {selectedPayment.amountPaise > 1000000 && (
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-amber-700">Step-Up Confirmation Code</label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-mono tracking-widest text-slate-900 focus:outline-none focus:border-indigo-600"
                    required
                  />
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedPayment(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold transition"
                >
                  {actionLoading ? 'Processing...' : 'Authorize Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}