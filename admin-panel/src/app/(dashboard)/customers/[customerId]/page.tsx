'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Phone,
  Mail,
  Calendar,
  Wallet,
  Car,
  Star,
  Clock,
  Copy,
  Check,
  RefreshCw,
  Ban,
  ChevronLeft,
  ChevronRight,
  Activity,
  CheckCircle2,
  XCircle,
  Receipt,
  UserX,
  UserCheck,
  X,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { CustomerDetail, AccountStatus } from '@/types';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import { RestrictionDrawer } from '@/components/customers/RestrictionDrawer';

interface RideHistoryItem {
  bookingId: string;
  rideId: string | null;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  pickupLabel: string | null;
  dropLabel: string | null;
  estimatedFarePaise: number;
  finalFarePaise: number | null;
  requestedAt: string;
  driverId: string | null;
}

export default function CustomerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const customerId = (params?.customerId as string) || '';

  // Core Data State
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [walletData, setWalletData] = useState<{ balancePaise: number; entries: any[] } | null>(null);
  const [rides, setRides] = useState<RideHistoryItem[]>([]);
  const [rideMeta, setRideMeta] = useState<{ page: number; limit: number; total: number; totalPages: number }>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  // UI State
  const [loading, setLoading] = useState(true);
  const [ridesLoading, setRidesLoading] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // Status Modal State
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusReason, setStatusReason] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Notification Toast / Flash
  const [flashMessage, setFlashMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showFlash = (type: 'success' | 'error', text: string) => {
    setFlashMessage({ type, text });
    setTimeout(() => setFlashMessage(null), 4000);
  };

  // 1. Fetch Customer Detail & Wallet Info
  const fetchCustomerData = async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const [userRes, walletRes] = await Promise.allSettled([
        apiClient.get(`/admin/users/${customerId}`),
        apiClient.get(`/admin/wallets/${customerId}`),
      ]);

      if (userRes.status === 'fulfilled') {
        const u = userRes.value.data?.data || userRes.value.data;
        setCustomer(u);
      } else {
        console.warn('Error fetching user detail:', userRes.reason);
      }

      if (walletRes.status === 'fulfilled') {
        const w = walletRes.value.data?.data || walletRes.value.data;
        setWalletData(w);
      } else {
        // Wallet might not be initialized yet; fallback cleanly
        setWalletData({ balancePaise: 0, entries: [] });
      }
    } catch (err: any) {
      console.error('Failed to load customer profile:', err);
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch Customer's Paginated Ride History
  const fetchRides = async (page = 1) => {
    if (!customerId) return;
    setRidesLoading(true);
    try {
      const res = await apiClient.get('/admin/bookings', {
        params: {
          customerId,
          page,
          limit: 10,
        },
      });

      const rawData = res.data?.data;
      const items: RideHistoryItem[] = Array.isArray(rawData)
        ? rawData
        : Array.isArray(rawData?.items)
        ? rawData.items
        : [];
      const meta = res.data?.meta || { page, limit: 10, total: items.length, totalPages: 1 };

      setRides(items);
      setRideMeta({
        page: Number(meta.page) || 1,
        limit: Number(meta.limit) || 10,
        total: Number(meta.total) ?? items.length,
        totalPages: Math.max(1, Math.ceil((Number(meta.total) ?? items.length) / (Number(meta.limit) || 10))),
      });
    } catch (err: any) {
      console.error('Failed to load ride history:', err);
    } finally {
      setRidesLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerData();
    fetchRides(1);
  }, [customerId]);

  // Handle Account Suspension / Reactivation
  const handleAccountStatusUpdate = async () => {
    if (!customer || statusReason.trim().length < 3) return;
    setUpdatingStatus(true);
    setStatusError(null);

    const nextStatus: AccountStatus = customer.accountStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

    try {
      await apiClient.patch(`/admin/users/${customer.userId}/status`, {
        status: nextStatus,
        reason: statusReason.trim(),
      });

      setCustomer((prev) => (prev ? { ...prev, accountStatus: nextStatus } : prev));
      setStatusModalOpen(false);
      setStatusReason('');
      showFlash(
        'success',
        `Customer account successfully ${nextStatus === 'SUSPENDED' ? 'suspended' : 'reactivated'}.`
      );
    } catch (err: any) {
      setStatusError(
        err?.response?.data?.error?.message ||
          err?.error?.message ||
          err?.message ||
          'Failed to change user status.'
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Masked Phone Helper
  const maskPhone = (phone?: string) => {
    if (!phone) return '—';
    if (phone.length <= 6) return phone;
    return `${phone.slice(0, 5)}••••${phone.slice(-3)}`;
  };

  // Copy Customer ID
  const copyCustomerId = () => {
    if (!customerId) return;
    navigator.clipboard.writeText(customerId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Status Badge Colors
  const getRideStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'CANCELLED':
      case 'NO_SHOW':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'IN_PROGRESS':
      case 'DRIVER_ASSIGNED':
      case 'DRIVER_ARRIVING':
      case 'DRIVER_ARRIVED':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'REQUESTED':
      case 'DISPATCHING':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center space-y-3">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-sm font-medium text-slate-500">Loading customer profile & history...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
        <h2 className="mt-3 text-base font-bold text-rose-900">Customer Not Found</h2>
        <p className="mt-1 text-xs text-rose-700">
          The requested customer with ID <code className="font-mono font-bold">{customerId}</code> does not exist or has been deleted.
        </p>
        <Link
          href="/customers"
          className="mt-4 inline-flex items-center space-x-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Customers Directory</span>
        </Link>
      </div>
    );
  }

  const isRestricted = Boolean(customer.customer?.bookingRestricted);
  const restrictionReason = customer.customer?.bookingRestrictionReason;
  const restrictionDate = customer.customer?.bookingRestrictedAt;
  const isSuspended = customer.accountStatus === 'SUSPENDED';

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Alert */}
      {flashMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center space-x-2.5 rounded-xl px-4 py-3 text-xs font-semibold shadow-lg transition-all animate-in fade-in slide-in-from-bottom-3 duration-200 ${
            flashMessage.type === 'success'
              ? 'bg-emerald-900 text-white'
              : 'bg-rose-900 text-white'
          }`}
        >
          {flashMessage.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          )}
          <span>{flashMessage.text}</span>
        </div>
      )}

      {/* Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/customers"
          className="group inline-flex items-center space-x-2 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Customer Directory</span>
        </Link>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              fetchCustomerData();
              fetchRides(rideMeta.page);
            }}
            className="inline-flex items-center space-x-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition shadow-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Profile Header Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          {/* Left Avatar & Identity */}
          <div className="flex items-start space-x-4">
            <div className="relative">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 font-bold text-2xl text-white shadow-md">
                {customer.name ? customer.name.charAt(0).toUpperCase() : 'C'}
              </div>
              <span
                className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${
                  isSuspended ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
                title={isSuspended ? 'Account Suspended' : 'Account Active'}
              />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900">
                  {customer.name || 'Anonymous Rider'}
                </h1>

                {/* Account Status Badge */}
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                    isSuspended
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                >
                  {isSuspended ? 'Suspended' : 'Active Account'}
                </span>

                {/* Booking Restriction Badge */}
                {isRestricted ? (
                  <span className="inline-flex items-center space-x-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                    <ShieldAlert className="h-3 w-3" />
                    <span>Booking Restricted</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    <ShieldCheck className="h-3 w-3" />
                    <span>Booking Clean</span>
                  </span>
                )}
              </div>

              {/* ID & Meta Row */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
                <div className="flex items-center space-x-1 font-mono">
                  <span>ID: {customer.userId}</span>
                  <button
                    onClick={copyCustomerId}
                    className="p-1 text-slate-400 hover:text-slate-600 transition"
                    title="Copy customer ID"
                  >
                    {copiedId ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>

                <div className="flex items-center space-x-1">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-mono font-medium text-slate-700">{customer.phone}</span>
                </div>

                {customer.customer?.email && (
                  <div className="flex items-center space-x-1">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    <span>{customer.customer.email}</span>
                  </div>
                )}

                <div className="flex items-center space-x-1">
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <span>Joined {formatToIST(customer.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Manage Restrictions Drawer Button */}
            <button
              onClick={() => setIsDrawerOpen(true)}
              className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2.5 text-xs font-semibold shadow-xs transition border ${
                isRestricted
                  ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <span>{isRestricted ? 'Manage Restrictions' : 'Add Restriction'}</span>
            </button>

            {/* Suspend / Reactivate Button */}
            <button
              onClick={() => {
                setStatusModalOpen(true);
                setStatusReason('');
                setStatusError(null);
              }}
              className={`inline-flex items-center space-x-2 rounded-xl px-4 py-2.5 text-xs font-semibold shadow-xs transition border ${
                isSuspended
                  ? 'bg-emerald-600 text-white border-transparent hover:bg-emerald-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
              }`}
            >
              {isSuspended ? (
                <>
                  <UserCheck className="h-4 w-4" />
                  <span>Reactivate Account</span>
                </>
              ) : (
                <>
                  <UserX className="h-4 w-4" />
                  <span>Suspend Account</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Active Restriction Banner (if restricted) */}
      {isRestricted && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start space-x-3">
              <Ban className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-amber-900">
                  Rider Booking Privileges Are Currently Restricted
                </h3>
                <p className="mt-0.5 text-xs text-amber-800">
                  Reason: &quot;{restrictionReason || 'Administrative restriction applied'}&quot;
                  {restrictionDate && ` • Placed on ${formatToIST(restrictionDate)}`}
                </p>
                <p className="mt-1 text-[11px] text-amber-700/80">
                  Customer cannot create new instant rides or schedule bookings until restriction is lifted.
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsDrawerOpen(true)}
              className="inline-flex items-center space-x-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 transition shrink-0"
            >
              <span>Lift Restriction</span>
            </button>
          </div>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {/* Total Rides */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Total Rides</span>
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
              <Car className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">
            {customer.bookingCount ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Total bookings requested</p>
        </div>

        {/* Wallet Balance */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Wallet Balance</span>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">
            {formatPaiseToInr(walletData?.balancePaise ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Prepaid ledger credits</p>
        </div>

        {/* Total Spent */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Total Spent</span>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-xl font-bold text-slate-900">
            {formatPaiseToInr(customer.totalSpentPaise ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Completed rides volume</p>
        </div>

        {/* Customer Rating */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Rider Rating</span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <Star className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className="text-xl font-bold text-slate-900">
              {customer.customer?.ratingAvg ? `${customer.customer.ratingAvg} ★` : '5.0 ★'}
            </span>
            <span className="text-[11px] text-slate-400">
              ({customer.customer?.ratingCount ?? 0} reviews)
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Average driver rating</p>
        </div>

        {/* Live Active Sessions */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Active Sessions</span>
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-center space-x-2">
            <span className="text-xl font-bold text-slate-900">{customer.liveSessions ?? 0}</span>
            {customer.liveSessions > 0 && (
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Authenticated devices</p>
        </div>
      </div>

      {/* Ride History Section */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900">Ride History</h2>
            <p className="text-xs text-slate-500">
              Past booking trips, trip routes, status and fare breakdown
            </p>
          </div>
          <div className="mt-2 sm:mt-0 flex items-center space-x-2">
            <span className="text-xs text-slate-500">
              Total {rideMeta.total} {rideMeta.total === 1 ? 'ride' : 'rides'}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-3.5">Booking ID</th>
                <th className="px-6 py-3.5">Date & Time</th>
                <th className="px-6 py-3.5">Route</th>
                <th className="px-6 py-3.5">Fare</th>
                <th className="px-6 py-3.5">Payment</th>
                <th className="px-6 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ridesLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin text-indigo-500" />
                    Fetching rides...
                  </td>
                </tr>
              ) : rides.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <Car className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                    No bookings found for this customer.
                  </td>
                </tr>
              ) : (
                rides.map((ride) => {
                  const fareAmount = ride.finalFarePaise ?? ride.estimatedFarePaise;
                  return (
                    <tr key={ride.bookingId} className="transition hover:bg-slate-50/70">
                      {/* Booking ID */}
                      <td className="px-6 py-4">
                        <span className="font-mono font-semibold text-slate-900">
                          {ride.bookingId}
                        </span>
                        {ride.rideId && (
                          <span className="block font-mono text-[10px] text-slate-400">
                            Ride: {ride.rideId.slice(0, 8)}...
                          </span>
                        )}
                      </td>

                      {/* Date & Time */}
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-1.5 text-xs text-slate-600">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          <span>{formatToIST(ride.requestedAt)}</span>
                        </div>
                      </td>

                      {/* Route */}
                      <td className="px-6 py-4 max-w-xs">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-1.5 truncate">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="truncate text-slate-800" title={ride.pickupLabel || 'Pickup location'}>
                              {ride.pickupLabel || 'Pickup location'}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1.5 truncate">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
                            <span className="truncate text-slate-600" title={ride.dropLabel || 'Drop location'}>
                              {ride.dropLabel || 'Drop location'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Fare */}
                      <td className="px-6 py-4">
                        <span className="font-semibold text-slate-900">
                          {fareAmount ? formatPaiseToInr(fareAmount) : '—'}
                        </span>
                        {ride.finalFarePaise === null && (
                          <span className="block text-[10px] text-slate-400">Estimated</span>
                        )}
                      </td>

                      {/* Payment */}
                      <td className="px-6 py-4">
                        <div className="space-y-0.5">
                          <span className="inline-block font-medium text-slate-700">
                            {ride.paymentMethod || 'ONLINE'}
                          </span>
                          <span
                            className={`block text-[10px] font-semibold ${
                              ride.paymentStatus === 'PAID'
                                ? 'text-emerald-600'
                                : ride.paymentStatus === 'FAILED'
                                ? 'text-rose-600'
                                : 'text-slate-400'
                            }`}
                          >
                            {ride.paymentStatus}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${getRideStatusBadge(
                            ride.status
                          )}`}
                        >
                          {ride.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {rideMeta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-6 py-3">
            <span className="text-xs text-slate-500">
              Page {rideMeta.page} of {rideMeta.totalPages} ({rideMeta.total} total rides)
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => fetchRides(rideMeta.page - 1)}
                disabled={rideMeta.page <= 1 || ridesLoading}
                className="inline-flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>
              <button
                onClick={() => fetchRides(rideMeta.page + 1)}
                disabled={rideMeta.page >= rideMeta.totalPages || ridesLoading}
                className="inline-flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Restriction Drawer Component */}
      <RestrictionDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        customerId={customer.userId}
        customerName={customer.name}
        isCurrentlyRestricted={isRestricted}
        currentReason={restrictionReason}
        restrictedAt={restrictionDate}
        onSuccess={(updated) => {
          setCustomer((prev) =>
            prev
              ? {
                  ...prev,
                  customer: {
                    ...prev.customer,
                    email: prev.customer?.email ?? null,
                    ratingAvg: prev.customer?.ratingAvg ?? null,
                    ratingCount: prev.customer?.ratingCount ?? 0,
                    bookingRestricted: updated.bookingRestricted,
                    bookingRestrictionReason: updated.reason,
                    bookingRestrictedAt: updated.restrictedAt,
                  },
                }
              : prev
          );
          showFlash(
            'success',
            updated.bookingRestricted
              ? 'Booking restriction applied successfully.'
              : 'Booking restriction lifted successfully.'
          );
        }}
      />

      {/* Account Status Modal (Suspend / Reactivate) */}
      {statusModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setStatusModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    isSuspended ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {isSuspended ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isSuspended ? 'Reactivate Account' : 'Suspend Account'}
                </h3>
              </div>
              <button
                onClick={() => setStatusModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-600">
                {isSuspended
                  ? `Are you sure you want to reactivate ${customer.name || 'this customer'}? They will be able to log in and use the platform immediately.`
                  : `Are you sure you want to suspend ${customer.name || 'this customer'}? Every active login session will be immediately terminated.`}
              </p>

              {statusError && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 flex items-start space-x-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{statusError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mandatory Audit Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder="Explain why this account status change is being made..."
                  className="w-full rounded-lg border border-slate-200 p-2.5 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                  disabled={updatingStatus}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end space-x-2.5">
              <button
                type="button"
                onClick={() => setStatusModalOpen(false)}
                disabled={updatingStatus}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAccountStatusUpdate}
                disabled={updatingStatus || statusReason.trim().length < 3}
                className={`inline-flex items-center space-x-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSuspended
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {updatingStatus ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : isSuspended ? (
                  <span>Reactivate Account</span>
                ) : (
                  <span>Suspend Account</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
