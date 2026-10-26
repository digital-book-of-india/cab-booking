'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { AdminSession } from '@/types';
import { formatToIST } from '@/lib/currency';
import { Laptop, Trash2, ShieldCheck } from 'lucide-react';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = async () => {
    try {
      const res = await apiClient.get('/auth/sessions');
      setSessions(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleRevoke = async (sessionId: string) => {
    if (!confirm('Revoke this administrative session immediately?')) return;
    await apiClient.delete(`/auth/sessions/${sessionId}`);
    fetchSessions();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Active Admin Sessions</h1>
        <p className="text-xs text-slate-500 mt-1">Review devices and IP addresses currently logged in with administrative access.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Device / Client</th>
              <th className="px-6 py-3.5">Origin IP</th>
              <th className="px-6 py-3.5">Created</th>
              <th className="px-6 py-3.5">Last Active</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">Loading active sessions...</td></tr>
            ) : (
              sessions.map((s) => (
                <tr key={s.sessionId} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <Laptop className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 text-xs">{s.userAgent}</p>
                        {s.isCurrent && (
                          <span className="inline-flex items-center text-[10px] font-bold text-emerald-600">
                            Current Session
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">{s.ipAddress}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(s.createdAt)}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(s.lastActiveAt)}</td>
                  <td className="px-6 py-4 text-right">
                    {!s.isCurrent && (
                      <button
                        onClick={() => handleRevoke(s.sessionId)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                        title="Revoke Token"
                      >
                        <Trash2 className="h-4 w-4" />
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
  );
}