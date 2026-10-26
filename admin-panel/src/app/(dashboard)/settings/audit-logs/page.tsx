'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { AuditLogEntry } from '@/types';
import { formatToIST } from '@/lib/currency';
import { Eye, Shield, FileText } from 'lucide-react';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspectedLog, setInspectedLog] = useState<AuditLogEntry | null>(null);

  const fetchAuditLogs = async () => {
    try {
      const res = await apiClient.get('/admin/audit-logs');
      setLogs(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Immutable Platform Audit Logs</h1>
        <p className="text-xs text-slate-500 mt-1">
          Complete traceability stream capturing actor identity, mutation actions, IP origins, and state JSON diffs.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Timestamp (IST)</th>
              <th className="px-6 py-3.5">Actor</th>
              <th className="px-6 py-3.5">Action Code</th>
              <th className="px-6 py-3.5">Target Resource</th>
              <th className="px-6 py-3.5">Origin IP</th>
              <th className="px-6 py-3.5 text-right">State Diff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Streaming audit records...</td></tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(log.timestamp)}</td>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{log.actorName}</p>
                    <span className="text-[10px] text-indigo-600 font-mono font-semibold">{log.actorRole}</span>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-xs text-indigo-700">{log.actionCode}</td>
                  <td className="px-6 py-4 text-xs text-slate-600">
                    <p className="font-medium text-slate-800">{log.targetResource}</p>
                    <span className="text-[10px] text-slate-400 font-mono">#{log.targetId}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{log.ipAddress}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => setInspectedLog(log)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Inspect Diff</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {inspectedLog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs text-slate-700 shadow-xl">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Audit Event State Diff</h3>
                <p className="text-[10px] text-slate-500 font-mono">Log ID: {inspectedLog.id} • Action: {inspectedLog.actionCode}</p>
              </div>
              <button onClick={() => setInspectedLog(null)} className="text-slate-400 hover:text-slate-800 text-xs font-bold">Close</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-semibold uppercase text-slate-500 block mb-1">Before Snapshot</span>
                <pre className="p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-[11px] overflow-x-auto text-rose-600">
                  {JSON.stringify(inspectedLog.beforeSnapshot || {}, null, 2)}
                </pre>
              </div>
              <div>
                <span className="font-semibold uppercase text-slate-500 block mb-1">After Snapshot</span>
                <pre className="p-3 bg-slate-50 rounded-xl border border-slate-200 font-mono text-[11px] overflow-x-auto text-emerald-600">
                  {JSON.stringify(inspectedLog.afterSnapshot || {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}