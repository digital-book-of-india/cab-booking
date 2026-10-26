'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { DriverProfile, DriverApprovalStatus } from '@/types';
import { formatToIST } from '@/lib/currency';
import { Eye, ShieldAlert } from 'lucide-react';

const STATUS_TABS: { label: string; status: DriverApprovalStatus }[] = [
  { label: 'Pending Review', status: 'PENDING' },
  { label: 'Approved Fleet', status: 'APPROVED' },
  { label: 'Rejected Applications', status: 'REJECTED' },
  { label: 'Suspended Accounts', status: 'SUSPENDED' },
];

export default function DriversPage() {
  const [activeTab, setActiveTab] = useState<DriverApprovalStatus>('PENDING');
  const [drivers, setDrivers] = useState<DriverProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDrivers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/admin/drivers');
      setDrivers(res.data.data.filter((d: DriverProfile) => d.approvalStatus === activeTab));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, [activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Driver Compliance & KYC Directory</h1>
          <p className="text-xs text-slate-500 mt-1">Audit onboarding submissions, verify private presigned documents, and manage platform access.</p>
        </div>
        <Link
          href="/drivers/expiring-docs"
          className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 text-xs font-semibold shadow-xs transition"
        >
          <ShieldAlert className="h-4 w-4" />
          <span>Document Expiry Monitor</span>
        </Link>
      </div>

      <div className="flex space-x-2 border-b border-slate-200">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.status}
            onClick={() => setActiveTab(tab.status)}
            className={`pb-3 px-3 text-xs font-semibold transition border-b-2 ${
              activeTab === tab.status
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Driver Partner</th>
              <th className="px-6 py-3.5">Contact (Masked)</th>
              <th className="px-6 py-3.5">Assigned Vehicle</th>
              <th className="px-6 py-3.5">Rating</th>
              <th className="px-6 py-3.5">Applied At</th>
              <th className="px-6 py-3.5 text-right">KYC Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Loading driver records...</td></tr>
            ) : drivers.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">No driver records found in this category.</td></tr>
            ) : (
              drivers.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{d.name}</p>
                    <span className="text-[10px] text-slate-400 font-mono">ID: {d.id}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-600">{d.phoneMasked}</td>
                  <td className="px-6 py-4 text-xs text-slate-700">{d.vehicleDetails || '—'}</td>
                  <td className="px-6 py-4 font-semibold text-amber-500 text-xs">★ {d.rating}</td>
                  <td className="px-6 py-4 text-xs text-slate-500">{formatToIST(d.createdAt)}</td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/drivers/${d.id}`}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition text-xs font-semibold"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Audit KYC</span>
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