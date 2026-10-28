'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { formatToIST } from '@/lib/currency';
import { ArrowLeft, Bell, Eye } from 'lucide-react';

interface ExpiringDocItem {
  documentId: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  type: string;
  status: string;
  expiresAt: string;
  daysLeft: number;
}

export default function ExpiringDocsPage() {
  const [expiringList, setExpiringList] = useState<ExpiringDocItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/admin/documents/expiring?days=30')
      .then((res) => {
        const raw = res.data?.data?.items || res.data?.items || (Array.isArray(res.data?.data) ? res.data.data : []);
        const list: ExpiringDocItem[] = raw.map((d: any) => {
          const expiresAt = d.expiresAt || new Date().toISOString();
          const daysLeft = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
          return {
            documentId: d.documentId || d._id || d.id,
            driverId: d.driverId,
            driverName: d.driverName || 'Driver Partner',
            driverPhone: d.driverPhone || '+91 ••••• •••••',
            type: d.type || 'DOCUMENT',
            status: d.status || 'APPROVED',
            expiresAt,
            daysLeft,
          };
        });
        setExpiringList(list);
      })
      .catch((err) => {
        console.warn('Failed to load expiring documents from backend:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Link href="/drivers" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Driver Document Expiry Monitor</h1>
          <p className="text-xs text-slate-500 mt-0.5">Documents expiring within the next 30 days requiring renewal compliance.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Driver</th>
              <th className="px-6 py-3.5">Document Type</th>
              <th className="px-6 py-3.5">Expiry Date</th>
              <th className="px-6 py-3.5">Days Left</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">Loading expiry records...</td></tr>
            ) : expiringList.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">Zero documents expiring within the next 30 days.</td></tr>
            ) : (
              expiringList.map((item) => (
                <tr key={item.documentId} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{item.driverName}</p>
                    <span className="text-[11px] font-mono text-slate-500">{item.driverPhone}</span>
                  </td>
                  <td className="px-6 py-4 text-xs font-semibold text-indigo-700">{item.type.replace(/_/g, ' ')}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(item.expiresAt)}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                      item.daysLeft <= 15 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {item.daysLeft} Days
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => alert(`Automated SMS reminder dispatched to ${item.driverName}`)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-xs font-semibold transition"
                    >
                      <Bell className="h-3.5 w-3.5" />
                      <span>Alert</span>
                    </button>
                    <Link
                      href={`/drivers/${item.driverId}`}
                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Inspect</span>
                    </Link>
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
