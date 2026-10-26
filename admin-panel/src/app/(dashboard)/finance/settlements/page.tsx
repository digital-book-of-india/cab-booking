'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { formatPaiseToInr, formatToIST, parseInrInputToPaise } from '@/lib/currency';
import { createIdempotencyHeader, clearIdempotencyKey } from '@/lib/idempotency';
import { getErrorMessage } from '@/lib/errors';
import {
  Play,
  RefreshCw,
  BookOpen,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  PlusCircle,
} from 'lucide-react';


interface LedgerRow {
  entryId?: string;
  _id?: string;
  publicId?: string;
  bookingId?: string;
  account?: string;
  ownerType?: string;
  ownerId?: string;
  driverId?: string;
  kind?: string;
  entryType?: string;
  reasonCode?: string;
  notes?: string;
  direction?: 'CREDIT' | 'DEBIT';
  amountPaise?: number;
  balanceAfterPaise?: number;
  createdAt?: string;
  at?: string;
}

interface SettlementItem {
  settlementId: string;
  driverId: string;
  driverName?: string;
  period?: { from: string; to: string } | string;
  earningsPaise: number;
  cashDeductedPaise: number;
  netPayoutPaise: number;
  status: 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
  payoutReference?: string;
  createdAt: string;
  approvedAt?: string;
  paidAt?: string;
}

export default function SettlementsPage() {
  const queryClient = useQueryClient();

  // Active view tab
  const [activeTab, setActiveTab] = useState<'settlements' | 'ledger'>('settlements');

  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [driverFilter, setDriverFilter] = useState<string>('');
  const [settlementPage, setSettlementPage] = useState<number>(1);
  const [ledgerPage, setLedgerPage] = useState<number>(1);
  const limit = 20;

  // Modals & Action states
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchTargetDriver, setBatchTargetDriver] = useState('');
  const [batchAll, setBatchAll] = useState(true);

  const [showMarkPaidModal, setShowMarkPaidModal] = useState<SettlementItem | null>(null);
  const [payoutReference, setPayoutReference] = useState('');

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositDriverId, setDepositDriverId] = useState('');
  const [depositAmountInr, setDepositAmountInr] = useState('');
  const [depositReference, setDepositReference] = useState('');

  // Notifications
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Settlements Query
  const settlementsQuery = useQuery({
    queryKey: ['admin-settlements', { status: statusFilter, driverId: driverFilter, page: settlementPage, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (driverFilter) params.append('driverId', driverFilter.trim());
      params.append('page', String(settlementPage));
      params.append('limit', String(limit));

      const res = await apiClient.get(`/admin/settlements?${params.toString()}`);
      return res.data;
    },
  });

  // Ledger Query
  const ledgerQuery = useQuery({
    queryKey: ['admin-ledger', { driverId: driverFilter, page: ledgerPage, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (driverFilter) params.append('driverId', driverFilter.trim());
      params.append('page', String(ledgerPage));
      params.append('limit', String(limit));

      const res = await apiClient.get(`/admin/ledger?${params.toString()}`);
      return res.data;
    },
    enabled: activeTab === 'ledger',
  });

  const settlements: SettlementItem[] = Array.isArray(settlementsQuery.data?.data)
    ? settlementsQuery.data.data
    : Array.isArray(settlementsQuery.data?.data?.items)
      ? settlementsQuery.data.data.items
      : [];

  const ledgerEntries: LedgerRow[] = Array.isArray(ledgerQuery.data?.data)
    ? ledgerQuery.data.data
    : Array.isArray(ledgerQuery.data?.data?.items)
      ? ledgerQuery.data.data.items
      : [];

  // Generate / Batch Settlement Mutation
  const generateSettlementMutation = useMutation({
    mutationFn: async ({ all, driverId }: { all: boolean; driverId?: string }) => {
      const scope = all ? 'batch_all' : driverId || 'single';
      const headers = createIdempotencyHeader('settlement_gen', scope);
      const payload: { all?: boolean; driverId?: string } = all ? { all: true } : { driverId };
      const res = await apiClient.post('/admin/settlements', payload, { headers });
      return res.data;
    },
    onSuccess: (_, variables) => {
      const scope = variables.all ? 'batch_all' : variables.driverId || 'single';
      clearIdempotencyKey('settlement_gen', scope);
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      setFeedback({
        type: 'success',
        message: 'Settlement run executed successfully. Draft settlements have been generated.',
      });
      setShowBatchModal(false);
      setBatchTargetDriver('');
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err) || 'Failed to run settlements.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  // Approve Settlement Mutation
  const approveMutation = useMutation({
    mutationFn: async (settlementId: string) => {
      const res = await apiClient.post(`/admin/settlements/${settlementId}/approve`);
      return res.data;
    },
    onSuccess: (_, settlementId) => {
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      queryClient.invalidateQueries({ queryKey: ['admin-ledger'] });
      setFeedback({
        type: 'success',
        message: `Settlement ${settlementId} approved. Net balances posted to immutable double-entry ledger.`,
      });
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err) || 'Failed to approve settlement.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  // Mark Paid Mutation
  const markPaidMutation = useMutation({
    mutationFn: async ({
      settlementId,
      refNumber,
    }: {
      settlementId: string;
      refNumber: string;
    }) => {
      const res = await apiClient.post(`/admin/settlements/${settlementId}/mark-paid`, {
        payoutReference: refNumber,
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      setFeedback({
        type: 'success',
        message: `Settlement ${variables.settlementId} recorded as PAID with reference ${variables.refNumber}.`,
      });
      setShowMarkPaidModal(null);
      setPayoutReference('');
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err) || 'Failed to mark settlement paid.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  // Cancel Settlement Mutation
  const cancelMutation = useMutation({
    mutationFn: async (settlementId: string) => {
      const res = await apiClient.post(`/admin/settlements/${settlementId}/cancel`);
      return res.data;
    },
    onSuccess: (_, settlementId) => {
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      setFeedback({
        type: 'success',
        message: `Draft settlement ${settlementId} was cancelled.`,
      });
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err) || 'Failed to cancel settlement.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  // Cash Deposit Adjustment Mutation (authorized ledger adjustment)
  const depositMutation = useMutation({
    mutationFn: async ({
      driverId,
      amountPaise,
      reference,
    }: {
      driverId: string;
      amountPaise: number;
      reference: string;
    }) => {
      const headers = createIdempotencyHeader('cash_deposit', driverId);
      const res = await apiClient.post(
        `/admin/drivers/${driverId}/cash-deposits`,
        { amountPaise, reference },
        { headers }
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      clearIdempotencyKey('cash_deposit', variables.driverId);
      queryClient.invalidateQueries({ queryKey: ['admin-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      setFeedback({
        type: 'success',
        message: `Recorded cash deposit of ${formatPaiseToInr(variables.amountPaise)} for driver ${variables.driverId}.`,
      });
      setShowDepositModal(false);
      setDepositDriverId('');
      setDepositAmountInr('');
      setDepositReference('');
    },
    onError: (err: unknown) => {
      const msg = getErrorMessage(err) || 'Failed to record cash deposit.';
      setFeedback({ type: 'error', message: msg });
    },
  });

  const handleDepositSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositDriverId.trim()) {
      setFeedback({ type: 'error', message: 'Driver ID is required.' });
      return;
    }
    let amountPaise: number;
    try {
      amountPaise = parseInrInputToPaise(depositAmountInr);
    } catch {
      setFeedback({ type: 'error', message: 'Invalid deposit amount specified.' });
      return;
    }
    if (amountPaise <= 0) {
      setFeedback({ type: 'error', message: 'Amount must be greater than zero.' });
      return;
    }

    depositMutation.mutate({
      driverId: depositDriverId.trim(),
      amountPaise,
      reference: depositReference.trim() || 'Direct Cash Collection',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Driver Settlements & Immutable Ledger
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Execute batch settlements, approve draft payouts, and audit append-only double-entry ledger transactions.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowDepositModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <PlusCircle className="h-3.5 w-3.5 text-indigo-600" />
            <span>Record Cash Deposit</span>
          </button>
          <button
            onClick={() => setShowBatchModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <Play className="h-3.5 w-3.5" />
            <span>Run Settlement Batch</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('settlements')}
          className={`pb-3 transition border-b-2 ${
            activeTab === 'settlements'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Settlements Queue
        </button>
        <button
          onClick={() => setActiveTab('ledger')}
          className={`pb-3 transition border-b-2 flex items-center space-x-1.5 ${
            activeTab === 'ledger'
              ? 'border-indigo-600 text-indigo-600 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>Immutable Ledger (Append-Only)</span>
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

      {/* Tab: Settlements */}
      {activeTab === 'settlements' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
            <input
              type="text"
              placeholder="Filter by Driver ID (e.g. drv_...)"
              value={driverFilter}
              onChange={(e) => {
                setDriverFilter(e.target.value);
                setSettlementPage(1);
              }}
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-600"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setSettlementPage(1);
              }}
              className="w-full sm:w-48 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
            >
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="APPROVED">Approved</option>
              <option value="PAID">Paid</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Settlements Table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3.5">Settlement ID</th>
                  <th className="px-6 py-3.5">Driver</th>
                  <th className="px-6 py-3.5">Earnings</th>
                  <th className="px-6 py-3.5">Cash Deducted</th>
                  <th className="px-6 py-3.5">Net Payout</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {settlementsQuery.isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      <div className="flex items-center justify-center space-x-2">
                        <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                        <span>Loading settlements...</span>
                      </div>
                    </td>
                  </tr>
                ) : settlementsQuery.isError ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-rose-600">
                      Error loading settlements from backend.
                    </td>
                  </tr>
                ) : settlements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                      Zero driver settlements recorded. Click &quot;Run Settlement Batch&quot; to draft.
                    </td>
                  </tr>
                ) : (
                  settlements.map((s) => (
                    <tr key={s.settlementId} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-4 font-mono font-bold text-indigo-700">
                        {s.settlementId}
                        <span className="block text-[10px] text-slate-400 font-normal">
                          {formatToIST(s.createdAt)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">{s.driverName || 'Driver'}</p>
                        <span className="font-mono text-slate-400 text-[11px]">{s.driverId}</span>
                      </td>
                      <td className="px-6 py-4 font-mono font-semibold text-emerald-600">
                        {formatPaiseToInr(s.earningsPaise)}
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500">
                        -{formatPaiseToInr(s.cashDeductedPaise)}
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-slate-900">
                        {formatPaiseToInr(s.netPayoutPaise)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            s.status === 'PAID'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : s.status === 'APPROVED'
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : s.status === 'DRAFT'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {s.status}
                        </span>
                        {s.payoutReference && (
                          <span className="block font-mono text-[10px] text-slate-400 mt-0.5">
                            Ref: {s.payoutReference}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        {s.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => approveMutation.mutate(s.settlementId)}
                              disabled={approveMutation.isPending}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-semibold transition"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => cancelMutation.mutate(s.settlementId)}
                              disabled={cancelMutation.isPending}
                              className="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {s.status === 'APPROVED' && (
                          <button
                            onClick={() => {
                              setShowMarkPaidModal(s);
                              setPayoutReference('');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition"
                          >
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Ledger */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center space-x-3 text-xs text-indigo-900">
            <ShieldCheck className="h-5 w-5 text-indigo-600 shrink-0" />
            <div>
              <h4 className="font-bold">Append-Only Financial Ledger Rules</h4>
              <p className="text-indigo-700 text-[11px] mt-0.5">
                The platform ledger is strictly double-entry and immutable. Entries cannot be edited or deleted.
                Adjustments are executed strictly as compensating ledger transactions authorized by the server.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-3.5">Entry / ID</th>
                  <th className="px-6 py-3.5">Account / Owner</th>
                  <th className="px-6 py-3.5">Kind / Reason</th>
                  <th className="px-6 py-3.5">Direction</th>
                  <th className="px-6 py-3.5">Amount</th>
                  <th className="px-6 py-3.5">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-mono">
                {ledgerQuery.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-sans">
                      Loading ledger entries...
                    </td>
                  </tr>
                ) : ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-sans">
                      No ledger transactions found.
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((l: LedgerRow, i: number) => (
                    <tr key={l.entryId || l._id || i} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-3.5 font-bold text-slate-800">
                        {l.entryId || l.publicId || `tx_${i + 1}`}
                        {l.bookingId && <span className="block text-slate-400 text-[10px]">{l.bookingId}</span>}
                      </td>
                      <td className="px-6 py-3.5 font-sans">
                        <span className="font-semibold text-slate-900 block">{l.account || l.ownerType || 'DRIVER'}</span>
                        <span className="text-slate-400 text-[10px] font-mono">{l.ownerId || l.driverId || '-'}</span>
                      </td>
                      <td className="px-6 py-3.5 font-sans">
                        <span className="font-medium text-slate-700">{l.kind || l.entryType || l.reasonCode || 'ACCRUAL'}</span>
                        {l.notes && <p className="text-[10px] text-slate-400">{l.notes}</p>}
                      </td>
                      <td className="px-6 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            l.direction === 'CREDIT'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {l.direction || ((l.amountPaise ?? 0) >= 0 ? 'CREDIT' : 'DEBIT')}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 font-bold text-slate-900">
                        {formatPaiseToInr(Math.abs(l.amountPaise ?? 0))}
                      </td>
                      <td className="px-6 py-3.5 text-slate-500 font-sans text-[11px]">
                        {formatToIST(l.createdAt || l.at || '')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>

            </table>
            <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50 text-xs">
              <span className="text-slate-500">Page {ledgerPage}</span>
              <div className="space-x-2">
                <button
                  onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
                  disabled={ledgerPage === 1}
                  className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 font-medium"
                >
                  Previous
                </button>
                <button
                  onClick={() => setLedgerPage((p) => p + 1)}
                  disabled={ledgerEntries.length < limit}
                  className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 font-medium"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Batch Settlement Execution */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Execute Settlement Payout Run</h3>
            <p className="text-slate-500">
              Generate net payout calculations netting driver earnings against held cash.
            </p>

            <div className="space-y-3">
              <label className="flex items-center space-x-2 cursor-pointer font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={batchAll}
                  onChange={(e) => setBatchAll(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span>Settle all active drivers with open balances</span>
              </label>

              {!batchAll && (
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Specific Driver ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. drv_101"
                    value={batchTargetDriver}
                    onChange={(e) => setBatchTargetDriver(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono"
                    required={!batchAll}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={generateSettlementMutation.isPending}
                onClick={() =>
                  generateSettlementMutation.mutate({
                    all: batchAll,
                    driverId: batchAll ? undefined : batchTargetDriver.trim(),
                  })
                }
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-60"
              >
                {generateSettlementMutation.isPending ? 'Generating Drafts...' : 'Execute Settlement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Mark Paid */}
      {showMarkPaidModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Record Payout Sent</h3>
            <p className="text-slate-500">
              Record external bank transfer or UPI payout completion for settlement {showMarkPaidModal.settlementId}.
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between">
              <span className="text-slate-600">Net Payable:</span>
              <span className="font-mono font-bold text-emerald-700 text-sm">
                {formatPaiseToInr(showMarkPaidModal.netPayoutPaise)}
              </span>
            </div>

            <div>
              <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                Bank Payout Reference (UTR / IMPS)
              </label>
              <input
                type="text"
                placeholder="e.g. NEFT UTR 1234567890"
                value={payoutReference}
                onChange={(e) => setPayoutReference(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono"
                required
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMarkPaidModal(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={markPaidMutation.isPending || !payoutReference.trim()}
                onClick={() =>
                  markPaidMutation.mutate({
                    settlementId: showMarkPaidModal.settlementId,
                    refNumber: payoutReference.trim(),
                  })
                }
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
              >
                {markPaidMutation.isPending ? 'Recording...' : 'Confirm Paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Record Cash Deposit (Authorized Ledger Operation) */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Record Driver Cash Deposit</h3>
            <p className="text-slate-500">
              Record verified cash handed over by a driver partner to finance ops.
            </p>

            <form onSubmit={handleDepositSubmit} className="space-y-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Driver ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. drv_101"
                  value={depositDriverId}
                  onChange={(e) => setDepositDriverId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Deposit Amount (₹ INR)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1500.00"
                  value={depositAmountInr}
                  onChange={(e) => setDepositAmountInr(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Deposit Slip / Receipt Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bank slip #88213"
                  value={depositReference}
                  onChange={(e) => setDepositReference(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDepositModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={depositMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-60"
                >
                  {depositMutation.isPending ? 'Recording...' : 'Record Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
