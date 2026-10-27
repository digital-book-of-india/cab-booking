// 'use client';

// import { useEffect, useState } from 'react';
// import { apiClient } from '@/lib/api-client';
// import { AdminSession } from '@/types';
// import { formatToIST } from '@/lib/currency';
// import { Laptop, Trash2 } from 'lucide-react';

// export default function SessionsPage() {
//   const [sessions, setSessions] = useState<AdminSession[]>([]);
//   const [loading, setLoading] = useState(true);

//   const fetchSessions = async () => {
//     try {
//       const res = await apiClient.get('/auth/sessions');
//       setSessions(res.data.data);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchSessions();
//   }, []);

//   const handleRevoke = async (sessionId: string) => {
//     if (!confirm('Revoke this administrative session immediately?')) return;
//     await apiClient.delete(`/auth/sessions/${sessionId}`);
//     fetchSessions();
//   };

//   return (
//     <div className="space-y-6">
//       <div>
//         <h1 className="text-xl font-bold text-slate-900 tracking-tight">Active Admin Sessions</h1>
//         <p className="text-xs text-slate-500 mt-1">Review devices and IP addresses currently logged in with administrative access.</p>
//       </div>

//       <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
//         <table className="w-full text-left text-sm text-slate-700">
//           <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
//             <tr>
//               <th className="px-6 py-3.5">Device / Client</th>
//               <th className="px-6 py-3.5">Origin IP</th>
//               <th className="px-6 py-3.5">Created</th>
//               <th className="px-6 py-3.5">Last Active</th>
//               <th className="px-6 py-3.5 text-right">Action</th>
//             </tr>
//           </thead>
//           <tbody className="divide-y divide-slate-100">
//             {loading ? (
//               <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">Loading active sessions...</td></tr>
//             ) : (
//               sessions.map((s) => (
//                 <tr key={s.sessionId} className="hover:bg-slate-50/80 transition">
//                   <td className="px-6 py-4">
//                     <div className="flex items-center space-x-3">
//                       <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
//                         <Laptop className="h-4 w-4" />
//                       </div>
//                       <div>
//                         <p className="font-semibold text-slate-900 text-xs">{s.userAgent}</p>
//                         {s.isCurrent && (
//                           <span className="inline-flex items-center text-[10px] font-bold text-emerald-600">
//                             Current Session
//                           </span>
//                         )}
//                       </div>
//                     </div>
//                   </td>
//                   <td className="px-6 py-4 font-mono text-xs text-slate-600">{s.ipAddress}</td>
//                   <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(s.createdAt)}</td>
//                   <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(s.lastActiveAt)}</td>
//                   <td className="px-6 py-4 text-right">
//                     {!s.isCurrent && (
//                       <button
//                         onClick={() => handleRevoke(s.sessionId)}
//                         className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
//                         title="Revoke Token"
//                       >
//                         <Trash2 className="h-4 w-4" />
//                       </button>
//                     )}
//                   </td>
//                 </tr>
//               ))
//             )}
//           </tbody>
//         </table>
//       </div>
//     </div>
//   );
// }


'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { AdminSession } from '@/types';
import { formatToIST } from '@/lib/currency';
import { Laptop, Trash2 } from 'lucide-react';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchSessions = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await apiClient.get('/auth/sessions');
      const data = res.data?.data;

      if (!Array.isArray(data)) {
        throw new Error('Invalid sessions response from server.');
      }

      setSessions(data);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError('Failed to load active sessions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchSessions();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleRevoke = async (sessionId: string) => {
    const confirmed = window.confirm(
      'Revoke this administrative session immediately?'
    );

    if (!confirmed) return;

    setRevokingId(sessionId);
    setError(null);

    try {
      await apiClient.delete(
        `/auth/sessions/${encodeURIComponent(sessionId)}`
      );
      await fetchSessions();
    } catch (err) {
      console.error('Failed to revoke session:', err);
      setError('Failed to revoke the session. Please try again.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Active Admin Sessions
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Review devices and IP addresses currently logged in with
          administrative access.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
        >
          {error}
          <button
            type="button"
            onClick={() => void fetchSessions()}
            className="ml-2 font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
              <tr
>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  Loading active sessions...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  No active sessions found.
                </td>
              </tr>
            ) : (
              sessions.map((s) => (
                <tr
                  key={s.sessionId}
                  className="transition hover:bg-slate-50/80"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                        <Laptop className="h-4 w-4" />
                      </div>

                      <div className="min-w-0">
                        <p className="break-words text-xs font-semibold text-slate-900">
                          {s.userAgent || 'Unknown device'}
                        </p>

                        {s.isCurrent && (
                          <span className="inline-flex items-center text-[10px] font-bold text-emerald-600">
                            Current Session
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-4 font-mono text-xs text-slate-600">
                    {s.ipAddress || 'Unknown'}
                  </td>

                  <td className="px-6 py-4 text-xs text-slate-500">
                    {formatToIST(s.createdAt)}
                  </td>

                  <td className="px-6 py-4 text-xs text-slate-500">
                    {formatToIST(s.lastActiveAt)}
                  </td>

                  <td className="px-6 py-4 text-right">
                    {!s.isCurrent && (
                      <button
                        type="button"
                        onClick={() => void handleRevoke(s.sessionId)}
                        disabled={revokingId !== null}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Revoke session"
                        aria-label={`Revoke session ${s.sessionId}`}
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
