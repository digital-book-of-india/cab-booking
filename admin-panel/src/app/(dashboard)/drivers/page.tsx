'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { DriverApprovalStatus } from '@/types';
import { formatToIST } from '@/lib/currency';
import {
  Eye,
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  UserCheck,
  Clock,
  Ban,
  CheckCircle2,
  FileText,
  Phone,
  MapPin,
  Car,
  ChevronRight,
  Shield,
  Layers,
} from 'lucide-react';

interface DriverListItem {
  driverId: string;
  userId?: string;
  name: string;
  phone: string;
  approvalStatus: DriverApprovalStatus;
  onlineStatus: 'ONLINE' | 'OFFLINE';
  city?: string;
  submittedAt?: string | null;
  createdAt: string;
}

const STATUS_TABS: { label: string; status: DriverApprovalStatus }[] = [
  { label: 'Pending Review', status: 'PENDING' },
  { label: 'Approved Fleet', status: 'APPROVED' },
  { label: 'Rejected Applications', status: 'REJECTED' },
  { label: 'Suspended Accounts', status: 'SUSPENDED' },
];

export default function DriversPage() {
  const [activeTab, setActiveTab] = useState<DriverApprovalStatus>('PENDING');
  const [drivers, setDrivers] = useState<DriverListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/admin/drivers', {
        params: {
          approvalStatus: activeTab,
          q: searchQuery.trim() || undefined,
        },
      });

      const raw = res.data?.data;
      const list = Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw)
        ? raw
        : [];

      // Normalize items
      const normalized = list.map((d: any) => ({
        driverId: d.driverId || d.id,
        userId: d.userId,
        name: d.name || 'Unnamed Driver',
        phone: d.phone || d.phoneMasked || '—',
        approvalStatus: d.approvalStatus || activeTab,
        onlineStatus: d.onlineStatus || 'OFFLINE',
        city: d.city || 'Delhi NCR',
        submittedAt: d.submittedAt,
        createdAt: d.createdAt || new Date().toISOString(),
      }));

      setDrivers(normalized);
    } catch (err: any) {
      console.error('Failed to load drivers:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchQuery]);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Driver Compliance & KYC Directory</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Inspection Desk
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Audit onboarding submissions, verify private presigned documents, and manage commercial platform licensing.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={fetchDrivers}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 shadow-xs transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            <span>Refresh</span>
          </button>

          <Link
            href="/vehicles/categories"
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-sm shadow-indigo-200"
          >
            <Car className="h-4 w-4" />
            <span>Fleet Categories</span>
          </Link>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs">
        {/* Status Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto bg-slate-100 p-1 rounded-xl">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.status}
              onClick={() => setActiveTab(tab.status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                activeTab === tab.status
                  ? 'bg-white text-indigo-700 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[260px]">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search driver by name, phone, city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition"
          />
        </div>
      </div>

      {/* Drivers List Table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-4">Driver Partner</th>
                <th className="px-6 py-4">Contact</th>
                <th className="px-6 py-4">Operating Metro</th>
                <th className="px-6 py-4">Approval State</th>
                <th className="px-6 py-4">Applied At</th>
                <th className="px-6 py-4 text-right">KYC Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 space-y-2">
                    <div className="h-6 w-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p>Loading compliance records...</p>
                  </td>
                </tr>
              ) : drivers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 space-y-2">
                    <Shield className="h-8 w-8 text-slate-300 mx-auto" />
                    <p className="font-semibold text-slate-700">No driver records found in this category.</p>
                    <p className="text-[11px] text-slate-500">Select a different status tab or modify your search filters.</p>
                  </td>
                </tr>
              ) : (
                drivers.map((d) => (
                  <tr key={d.driverId} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4">
                      <p className="font-bold text-slate-900 text-xs">{d.name}</p>
                      <span className="text-[10px] text-slate-400 font-mono">ID: {d.driverId}</span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-indigo-700 font-medium">{d.phone}</td>
                    <td className="px-6 py-4 text-xs text-slate-600 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      <span>{d.city || 'Delhi NCR'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          d.approvalStatus === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : d.approvalStatus === 'REJECTED'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : d.approvalStatus === 'SUSPENDED'
                            ? 'bg-slate-100 text-slate-600 border border-slate-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {d.approvalStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {formatToIST(d.submittedAt || d.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/drivers/${d.driverId}`}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold transition"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Inspect Desk</span>
                        <ChevronRight className="h-3 w-3 text-indigo-500" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}