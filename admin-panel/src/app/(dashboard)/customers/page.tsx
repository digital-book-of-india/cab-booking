'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { CustomerListItem, AccountStatus } from '@/types';
import { formatToIST } from '@/lib/currency';
import {
  Users,
  Search,
  UserCheck,
  UserX,
  ShieldAlert,
  ArrowRight,
  AlertTriangle,
  X,
  RefreshCw,
  Phone,
  Calendar,
  CheckCircle2,
} from 'lucide-react';

type FilterTab = 'ALL' | 'ACTIVE' | 'SUSPENDED' | 'RESTRICTED';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [statusModalUser, setStatusModalUser] = useState<CustomerListItem | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/admin/users', {
        params: { role: 'CUSTOMER' },
      });
      const data = res.data?.data?.items || res.data?.data || [];
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleStatusToggle = async () => {
    if (!statusModalUser || statusReason.trim().length < 3) return;
    setUpdatingStatus(true);
    setActionError(null);

    const nextStatus: AccountStatus =
      statusModalUser.accountStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

    try {
      await apiClient.patch(`/admin/users/${statusModalUser.userId}/status`, {
        status: nextStatus,
        reason: statusReason.trim(),
      });

      // Update local state
      setCustomers((prev) =>
        prev.map((c) =>
          c.userId === statusModalUser.userId ? { ...c, accountStatus: nextStatus } : c
        )
      );
      setStatusModalUser(null);
      setStatusReason('');
    } catch (err: any) {
      setActionError(
        err?.response?.data?.error?.message || err?.message || 'Failed to update account status.'
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  const maskPhone = (phone: string) => {
    if (!phone) return '—';
    if (phone.length <= 6) return phone;
    const start = phone.slice(0, 5);
    const end = phone.slice(-3);
    return `${start}••••${end}`;
  };

  const filteredCustomers = useMemo(() => {
    return customers.filter((customer) => {
      // Tab filter
      if (activeTab === 'ACTIVE' && customer.accountStatus !== 'ACTIVE') return false;
      if (activeTab === 'SUSPENDED' && customer.accountStatus !== 'SUSPENDED') return false;
      if (activeTab === 'RESTRICTED' && !customer.bookingRestriction) return false;

      // Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = customer.name?.toLowerCase().includes(q);
        const phoneMatch = customer.phone.includes(q);
        const idMatch = customer.userId.toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch && !idMatch) return false;
      }

      return true;
    });
  }, [customers, activeTab, searchQuery]);

  const activeCount = customers.filter((c) => c.accountStatus === 'ACTIVE').length;
  const suspendedCount = customers.filter((c) => c.accountStatus === 'SUSPENDED').length;
  const restrictedCount = customers.filter((c) => !!c.bookingRestriction).length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <Users className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Customer Management</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Search rider accounts, inspect ride histories, manage suspensions, and review booking risk restrictions.
          </p>
        </div>

        <button
          onClick={fetchCustomers}
          disabled={loading}
          className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Active Riders</span>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <UserCheck className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{activeCount}</p>
          <span className="text-[11px] text-slate-400">Permitted to book rides</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Suspended Accounts</span>
            <div className="rounded-lg bg-rose-50 p-2 text-rose-600">
              <UserX className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{suspendedCount}</p>
          <span className="text-[11px] text-slate-400">Sessions revoked</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Booking Restricted</span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{restrictedCount}</p>
          <span className="text-[11px] text-slate-400">Debt or risk flags applied</span>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, phone, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-xs text-slate-800 placeholder-slate-400 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 rounded-lg border border-slate-200 bg-slate-100/80 p-1">
          {(
            [
              { key: 'ALL', label: 'All' },
              { key: 'ACTIVE', label: 'Active' },
              { key: 'SUSPENDED', label: 'Suspended' },
              { key: 'RESTRICTED', label: 'Restricted' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === t.key
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table Card */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-6 py-3.5">Customer / Rider</th>
                <th className="px-6 py-3.5">Contact (Masked)</th>
                <th className="px-6 py-3.5">Account Status</th>
                <th className="px-6 py-3.5">Booking Risk</th>
                <th className="px-6 py-3.5">Member Since</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-xs text-slate-400">
                    <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin text-indigo-600" />
                    Loading customer directory...
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-xs text-slate-400">
                    <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                    No customers found matching the criteria.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => {
                  const isSuspended = c.accountStatus === 'SUSPENDED';
                  const isRestricted = !!c.bookingRestriction;

                  return (
                    <tr key={c.userId} className="transition hover:bg-slate-50/70">
                      {/* Name & ID */}
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 font-semibold text-xs text-indigo-700">
                            {c.name ? c.name.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{c.name || 'Anonymous Rider'}</p>
                            <span className="font-mono text-[11px] text-slate-400">{c.userId}</span>
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-1.5 text-xs text-slate-600">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-mono">{maskPhone(c.phone)}</span>
                        </div>
                      </td>

                      {/* Account Status */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            isSuspended
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {isSuspended ? 'Suspended' : 'Active'}
                        </span>
                      </td>

                      {/* Booking Risk */}
                      <td className="px-6 py-4">
                        {isRestricted ? (
                          <span className="inline-flex items-center space-x-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                            <ShieldAlert className="h-3 w-3" />
                            <span>{c.bookingRestriction}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 text-[11px] font-medium text-slate-400">
                            <CheckCircle2 className="h-3.5 w-3.5 text-slate-300" />
                            <span>None (Standard)</span>
                          </span>
                        )}
                      </td>

                      {/* Created At */}
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-1.5 text-xs text-slate-500">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{formatToIST(c.createdAt)}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => {
                              setStatusModalUser(c);
                              setStatusReason('');
                              setActionError(null);
                            }}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition border ${
                              isSuspended
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                            }`}
                          >
                            {isSuspended ? 'Reactivate' : 'Suspend'}
                          </button>

                          <Link
                            href={`/customers/${c.userId}`}
                            className="inline-flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 shadow-xs"
                          >
                            <span>Profile</span>
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Suspend / Reactivate Confirmation Modal */}
      {statusModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center space-x-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  statusModalUser.accountStatus === 'ACTIVE'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {statusModalUser.accountStatus === 'ACTIVE'
                    ? 'Suspend Customer Account'
                    : 'Reactivate Customer Account'}
                </h3>
                <p className="text-xs text-slate-500">
                  {statusModalUser.name || 'Anonymous Rider'} ({statusModalUser.userId})
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-600">
              {statusModalUser.accountStatus === 'ACTIVE'
                ? 'Suspending this account will immediately revoke all active mobile sessions and block future booking requests until reactivated.'
                : 'Reactivating this account will restore full access and allow the customer to book rides again.'}
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700">
                Reason for this action <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="E.g., Flagged for payment fraud, abusive cancellations, or verified identity..."
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-[10px] text-slate-400">Must be at least 3 characters.</span>
            </div>

            {actionError && (
              <div className="mt-3 rounded-lg bg-rose-50 border border-rose-200 p-2 text-xs text-rose-700">
                {actionError}
              </div>
            )}

            <div className="mt-6 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setStatusModalUser(null)}
                disabled={updatingStatus}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleStatusToggle}
                disabled={updatingStatus || statusReason.trim().length < 3}
                className={`rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50 ${
                  statusModalUser.accountStatus === 'ACTIVE'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {updatingStatus
                  ? 'Processing...'
                  : statusModalUser.accountStatus === 'ACTIVE'
                  ? 'Confirm Suspension'
                  : 'Confirm Reactivation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
