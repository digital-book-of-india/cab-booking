'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { FeatureFlag } from '@/types';
import { formatToIST } from '@/lib/currency';
import { ToggleLeft, ToggleRight } from 'lucide-react';

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlag, setSelectedFlag] = useState<FeatureFlag | null>(null);
  const [targetState, setTargetState] = useState<boolean>(false);
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchFlags = async () => {
    try {
      const res = await apiClient.get('/admin/feature-flags');
      setFlags(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const openToggleModal = (flag: FeatureFlag) => {
    setSelectedFlag(flag);
    setTargetState(!flag.enabled);
    setChangeReason('');
  };

  const handleToggleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFlag) return;
    setSaving(true);

    try {
      await apiClient.patch(`/admin/feature-flags/${selectedFlag.key}`, {
        enabled: targetState,
        changeReason,
      });
      setSelectedFlag(null);
      fetchFlags();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Platform Feature Flags</h1>
          <p className="text-xs text-slate-400 mt-1">
            Safely enable or disable core runtime platform capabilities with mandatory audit reason logging.
          </p>
        </div>
        <div className="flex space-x-2">
          <Link href="/settings/roles" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition">
            RBAC Matrix
          </Link>
          <Link href="/settings/audit-logs" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition">
            Audit Activity Log
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-800/40 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-6 py-3">Capability / Key</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Current State</th>
              <th className="px-6 py-3">Last Updated</th>
              <th className="px-6 py-3 text-right">Runtime Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Checking active flags...</td></tr>
            ) : (
              flags.map((f) => (
                <tr key={f.key} className="hover:bg-slate-800/30">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-100">{f.name}</p>
                    <code className="text-[10px] font-mono text-indigo-400">{f.key}</code>
                    <p className="text-xs text-slate-400 mt-1">{f.description}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                      {f.category}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      f.enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500'
                    }`}>
                      {f.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-400">
                    <p>{formatToIST(f.updatedAt)}</p>
                    <span className="text-[10px] text-slate-500">By: {f.lastUpdatedBy}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => openToggleModal(f)}
                      className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        f.enabled ? 'bg-slate-800 hover:bg-slate-700 text-rose-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      }`}
                    >
                      {f.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                      <span>{f.enabled ? 'Disable' : 'Enable'}</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mandatory Change Reason Modal */}
      {selectedFlag && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
            <h3 className="text-base font-bold text-white">
              {targetState ? 'Enable Feature Flag' : 'Disable Feature Flag'}
            </h3>
            <p className="text-slate-400">
              Modifying key <code className="text-indigo-400 font-mono">{selectedFlag.key}</code>
            </p>

            <form onSubmit={handleToggleSubmit} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400">
                  Mandatory Change Justification
                </label>
                <textarea
                  rows={3}
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Record formal operational or engineering reason for this toggle..."
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedFlag(null)}
                  className="px-4 py-2 font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`px-4 py-2 rounded-lg font-semibold text-white transition ${
                    targetState ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
                  }`}
                >
                  {saving ? 'Updating...' : 'Confirm Toggle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}