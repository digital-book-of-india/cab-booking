'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { SettlementBatch, LedgerEntry } from '@/types';
import { formatPaiseToInr, formatToIST, parseInrInputToPaise } from '@/lib/currency';
import { ArrowLeft, Play, Plus, BookOpen, CheckCircle2 } from 'lucide-react';

export default function SettlementsPage() {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdjustModal, setShowAdjustModal] = useState(false);

  // Form states for manual append-only ledger adjustment
  const [ownerType, setOwnerType] = useState<'DRIVER' | 'CUSTOMER'>('DRIVER');
  const [ownerId, setOwnerId] = useState('drv_101');
  const [amountInr, setAmountInr] = useState('50.00');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [reasonCode, setReasonCode] = useState('TOLL_REIMBURSEMENT');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      const [batchRes, ledgerRes] = await Promise.all([
        apiClient.get('/admin/settlements'),
        apiClient.get('/admin/ledger/entries'),
      ]);
      setBatches(batchRes.data.data);
      setLedgerEntries(ledgerRes.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunSettlementBatch = async () => {
    if (!confirm('Run driver settlement batch for current eligible earnings?')) return;
    await apiClient.post(
      '/admin/settlements/run',
      {},
      {
        headers: {
          'Idempotency-Key': `idemp_st_run_${Date.now()}`,
        },
      }
    );
    fetchData();
  };

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await apiClient.post(
        '/admin/ledger/adjustments',
        {
          ownerType,
          ownerId,
          amountPaise: parseInrInputToPaise(amountInr),
          direction,
          reasonCode,
          notes,
        },
        {
          headers: {
            'Idempotency-Key': `idemp_adj_${Date.now()}`,
          },
        }
      );

      setShowAdjustModal(false);
      setNotes('');
      fetchData();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header & Batch Trigger */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Driver Settlements & Immutable Ledger</h1>
          <p className="text-xs text-slate-400 mt-1">
            Execute driver settlement payout batches and record append-only ledger adjustments.
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowAdjustModal(true)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition"
          >
            <Plus className="h-4 w-4" />
            <span>Manual Ledger Adjustment</span>
          </button>
          <button
            onClick={handleRunSettlementBatch}
            className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
          >
            <Play className="h-4 w-4" />
            <span>Run Settlement Batch</span>
          </button>
        </div>
      </div>

      {/* Settlement Batches Table */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Settlement Batches</h3>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-800/40 text-xs font-semibold uppercase text-slate-400">
              <tr>
                <th className="px-6 py-3">Batch ID</th>
                <th className="px-6 py-3">Billing Cycle Period</th>
                <th className="px-6 py-3">Fleet Size</th>
                <th className="px-6 py-3">Gross Fare</th>
                <th className="px-6 py-3">Commission (10%)</th>
                <th className="px-6 py-3">Net Payout</th>
                <th className="px-6 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-500">Loading payout batches...</td></tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.batchId} className="hover:bg-slate-800/30">
                    <td className="px-6 py-4 font-mono font-bold text-indigo-400 text-xs">{b.batchId}</td>
                    <td className="px-6 py-4 text-xs text-slate-300">{b.period}</td>
                    <td className="px-6 py-4 text-xs font-semibold">{b.driverCount} Drivers</td>
                    <td className="px-6 py-4 font-mono text-xs">{formatPaiseToInr(b.totalGrossPaise)}</td>
                    <td className="px-6 py-4 font-mono text-xs text-rose-400">-{formatPaiseToInr(b.totalCommissionPaise)}</td>
                    <td className="px-6 py-4 font-mono font-bold text-emerald-400 text-xs">{formatPaiseToInr(b.totalNetPayablePaise)}</td>
                    <td className="px-6 py-4 text-right">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Append-Only Ledger Activity Stream */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Immutable Ledger Audit Activity</h3>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-800/40 text-xs font-semibold uppercase text-slate-400">
              <tr>
                <th className="px-6 py-3">Entry ID</th>
                <th className="px-6 py-3">Owner</th>
                <th className="px-6 py-3">Entry Classification</th>
                <th className="px-6 py-3">Direction</th>
                <th className="px-6 py-3">Amount</th>
                <th className="px-6 py-3">Reason Code</th>
                <th className="px-6 py-3 text-right">Logged At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-500">Loading ledger audit log...</td></tr>
              ) : (
                ledgerEntries.map((l) => (
                  <tr key={l.entryId} className="hover:bg-slate-800/30">
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">{l.entryId}</td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-200">{l.ownerName}</p>
                      <span className="text-[10px] text-slate-500 font-mono">{l.ownerId}</span>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-indigo-400">{l.entryType}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        l.direction === 'CREDIT' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {l.direction}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-slate-100 text-xs">{formatPaiseToInr(l.amountPaise)}</td>
                    <td className="px-6 py-4 text-xs text-slate-300">{l.reasonCode}</td>
                    <td className="px-6 py-4 text-right text-xs text-slate-400">{formatToIST(l.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Ledger Adjustment Form Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
            <h3 className="text-base font-bold text-white">Manual Ledger Adjustment</h3>
            <form onSubmit={handleAdjustmentSubmit} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400">Account Owner Type</label>
                <select
                  value={ownerType}
                  onChange={(e) => setOwnerType(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none"
                >
                  <option value="DRIVER">Driver Partner Account</option>
                  <option value="CUSTOMER">Customer Account</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400">Target Owner ID</label>
                <input
                  type="text"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white font-mono focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-400">Adjustment Amount (₹)</label>
                  <input
                    type="text"
                    value={amountInr}
                    onChange={(e) => setAmountInr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white font-mono focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-400">Entry Direction</label>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="CREDIT">Credit (Payable)</option>
                    <option value="DEBIT">Debit (Deduction)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400">Mandatory Adjustment Reason</label>
                <input
                  type="text"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  placeholder="e.g. TOLL_REIMBURSEMENT"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400">Audit Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Provide accounting justification for manual adjustment..."
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition"
                >
                  {submitting ? 'Appending Entry...' : 'Append Immutable Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}