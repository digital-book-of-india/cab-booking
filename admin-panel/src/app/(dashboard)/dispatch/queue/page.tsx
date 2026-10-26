'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import { DispatchQueueItem } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';
import { ManualAssignModal } from '@/components/dispatch/ManualAssignModal';
import {
  RefreshCw,
  Clock,
  Car,
  AlertCircle,
  CheckCircle2,
  Phone,
  UserCheck,
  Search,
  Filter,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  RotateCw,
} from 'lucide-react';

export default function DispatchQueuePage() {
  const [queue, setQueue] = useState<DispatchQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DISPATCHING' | 'REQUESTED'>('ALL');
  const [selectedBooking, setSelectedBooking] = useState<DispatchQueueItem | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Live timer tick every 1000ms
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const showToast = (text: string) => {
    setToastMessage(text);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchQueueData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/dispatch/queue');
      const raw = res.data?.data?.items || res.data?.data || [];
      const items: DispatchQueueItem[] = Array.isArray(raw) ? raw : [];
      setQueue(items);
    } catch (err: any) {
      console.error('Failed to load dispatch queue:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Realtime Socket listener: refresh queue when bookings change
  useEffect(() => {
    fetchQueueData();

    const socket = getSocket();
    const handleOpsBooking = () => {
      fetchQueueData();
    };

    socket.on('ops:booking', handleOpsBooking);
    socket.on('booking:status', handleOpsBooking);

    return () => {
      socket.off('ops:booking', handleOpsBooking);
      socket.off('booking:status', handleOpsBooking);
    };
  }, [fetchQueueData]);

  // Helper: Mask phone
  const maskPhone = (phone?: string | null) => {
    if (!phone) return '—';
    if (phone.length <= 6) return phone;
    return `${phone.slice(0, 5)}••••${phone.slice(-3)}`;
  };

  // Helper: Format waiting duration
  const getWaitingDuration = (requestedAt?: string) => {
    const reqMs = new Date(requestedAt || new Date()).getTime();
    const diffSec = Math.max(0, Math.floor((currentTime - reqMs) / 1000));

    const minutes = Math.floor(diffSec / 60);
    const seconds = diffSec % 60;

    let text = `${diffSec}s`;
    if (minutes > 0) {
      text = `${minutes}m ${seconds}s`;
    }

    let color = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    let urgency = 'NORMAL';

    if (diffSec >= 180) {
      color = 'bg-rose-50 text-rose-700 border-rose-200 font-bold animate-pulse';
      urgency = 'CRITICAL';
    } else if (diffSec >= 60) {
      color = 'bg-amber-50 text-amber-700 border-amber-200 font-semibold';
      urgency = 'MODERATE';
    }

    return { text, color, urgency, totalSeconds: diffSec };
  };

  // Handle Retry Dispatch
  const handleRetryDispatch = async (bookingId: string) => {
    setRetryingId(bookingId);
    try {
      await apiClient.post(`/bookings/${bookingId}/dispatch/retry`);
      showToast(`Dispatch search restarted for ${bookingId}`);
      await fetchQueueData();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Retry dispatch failed';
      showToast(msg);
    } finally {
      setRetryingId(null);
    }
  };

  // Filtered Queue
  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const idMatch = item.bookingId.toLowerCase().includes(q);
        const nameMatch = item.customerName?.toLowerCase().includes(q);
        const pickupMatch = item.pickup?.label?.toLowerCase().includes(q);
        const dropMatch = item.drop?.label?.toLowerCase().includes(q);
        if (!idMatch && !nameMatch && !pickupMatch && !dropMatch) return false;
      }

      return true;
    });
  }, [queue, statusFilter, searchQuery]);

  // Queue Analytics
  const analytics = useMemo(() => {
    const total = queue.length;
    let maxWait = 0;
    let sumWait = 0;

    queue.forEach((item) => {
      const reqMs = new Date(item.requestedAt || item.createdAt || new Date()).getTime();
      const sec = Math.max(0, Math.floor((currentTime - reqMs) / 1000));
      if (sec > maxWait) maxWait = sec;
      sumWait += sec;
    });

    const avgWait = total > 0 ? Math.round(sumWait / total) : 0;
    const criticalCount = queue.filter((item) => {
      const sec = Math.floor((currentTime - new Date(item.requestedAt || item.createdAt || new Date()).getTime()) / 1000);
      return sec >= 180;
    }).length;

    return {
      total,
      maxWaitText: maxWait >= 60 ? `${Math.floor(maxWait / 60)}m ${maxWait % 60}s` : `${maxWait}s`,
      avgWaitText: avgWait >= 60 ? `${Math.floor(avgWait / 60)}m ${avgWait % 60}s` : `${avgWait}s`,
      criticalCount,
    };
  }, [queue, currentTime]);

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-2.5 rounded-xl bg-slate-900 text-white px-4 py-3 text-xs font-semibold shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Active Dispatch Queue
            </h1>
            <span className="inline-flex items-center space-x-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-200">
              <span className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse" />
              <span>{queue.length} Pending</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Monitor unassigned customer rides, dispatch timeout delays, and execute manual driver allocation overrides.
          </p>
        </div>

        <button
          onClick={fetchQueueData}
          disabled={loading}
          className="inline-flex items-center space-x-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-slate-400 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Analytics KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium text-slate-500">Unassigned Rides</span>
          <p className="mt-2 text-2xl font-bold text-slate-900">{analytics.total}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Awaiting driver accept</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium text-slate-500">Average Wait Time</span>
          <p className="mt-2 text-2xl font-bold text-indigo-600">{analytics.avgWaitText}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Since rider requested</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium text-slate-500">Longest Queue Delay</span>
          <p className="mt-2 text-2xl font-bold text-amber-600">{analytics.maxWaitText}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Highest waiting passenger</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium text-slate-500">High Delay Rides</span>
          <div className="mt-2 flex items-center space-x-2">
            <span className="text-2xl font-bold text-rose-600">{analytics.criticalCount}</span>
            {analytics.criticalCount > 0 && (
              <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                Action Required
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Exceeding 3 min wait</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by Booking ID, Rider name, or Location..."
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition"
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100 p-1 text-xs font-semibold">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`rounded-lg px-3 py-1.5 transition ${
              statusFilter === 'ALL'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({queue.length})
          </button>
          <button
            onClick={() => setStatusFilter('DISPATCHING')}
            className={`rounded-lg px-3 py-1.5 transition ${
              statusFilter === 'DISPATCHING'
                ? 'bg-white text-amber-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Dispatching ({queue.filter((q) => q.status === 'DISPATCHING').length})
          </button>
          <button
            onClick={() => setStatusFilter('REQUESTED')}
            className={`rounded-lg px-3 py-1.5 transition ${
              statusFilter === 'REQUESTED'
                ? 'bg-white text-indigo-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Requested ({queue.filter((q) => q.status === 'REQUESTED').length})
          </button>
        </div>
      </div>

      {/* Queue Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-6 py-3.5">Booking ID</th>
                <th className="px-6 py-3.5">Passenger</th>
                <th className="px-6 py-3.5">Route</th>
                <th className="px-6 py-3.5">Category & Fare</th>
                <th className="px-6 py-3.5">Live Waiting Time</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && queue.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin text-indigo-500" />
                    Fetching active dispatch queue...
                  </td>
                </tr>
              ) : filteredQueue.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                    No pending unassigned rides in dispatch queue.
                  </td>
                </tr>
              ) : (
                filteredQueue.map((item) => {
                  const wait = getWaitingDuration(item.requestedAt);
                  const isRetrying = retryingId === item.bookingId;

                  return (
                    <tr key={item.bookingId} className="transition hover:bg-slate-50/70">
                      {/* Booking ID */}
                      <td className="px-6 py-4 font-mono font-bold text-indigo-600">
                        {item.bookingId}
                        <span className="block text-[10px] font-normal text-slate-400 font-sans">
                          Round #{item.redispatchCount ?? 1}
                        </span>
                      </td>

                      {/* Passenger */}
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">{item.customerName || 'Rider'}</p>
                        <div className="flex items-center space-x-1 text-slate-500 font-mono text-[11px]">
                          <Phone className="h-3 w-3 text-slate-400" />
                          <span>{maskPhone(item.customerPhone)}</span>
                        </div>
                      </td>

                      {/* Route */}
                      <td className="px-6 py-4 max-w-xs">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-1.5 truncate">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="truncate text-slate-800" title={item.pickup.label || 'Pickup'}>
                              {item.pickup.label || 'Pickup location'}
                            </span>
                          </div>
                          <div className="flex items-center space-x-1.5 truncate">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
                            <span className="truncate text-slate-600" title={item.drop.label || 'Drop'}>
                              {item.drop.label || 'Drop location'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Category & Fare */}
                      <td className="px-6 py-4">
                        <span className="font-semibold text-slate-900">
                          {formatPaiseToInr(item.estimatedFarePaise)}
                        </span>
                        <span className="block text-[11px] text-slate-500 font-medium">
                          {item.categoryName || 'Standard'}
                        </span>
                      </td>

                      {/* Live Waiting Timer */}
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`inline-flex items-center space-x-1 rounded-full px-2.5 py-0.5 text-xs border ${wait.color}`}
                          >
                            <Clock className="h-3 w-3" />
                            <span>{wait.text}</span>
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center space-x-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold border ${
                            item.status === 'DISPATCHING'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              item.status === 'DISPATCHING' ? 'bg-amber-500 animate-ping' : 'bg-indigo-500'
                            }`}
                          />
                          <span>{item.status}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            onClick={() => handleRetryDispatch(item.bookingId)}
                            disabled={isRetrying}
                            className="inline-flex items-center space-x-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition shadow-xs disabled:opacity-50"
                            title="Retry automatic driver matching"
                          >
                            <RotateCw className={`h-3 w-3 ${isRetrying ? 'animate-spin' : ''}`} />
                            <span>Retry</span>
                          </button>

                          <button
                            onClick={() => setSelectedBooking(item)}
                            className="inline-flex items-center space-x-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700"
                          >
                            <UserCheck className="h-3 w-3" />
                            <span>Assign Driver</span>
                          </button>
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

      {/* Manual Driver Assignment Modal */}
      <ManualAssignModal
        isOpen={Boolean(selectedBooking)}
        onClose={() => setSelectedBooking(null)}
        booking={selectedBooking}
        onSuccess={(bookingId) => {
          showToast(`Driver successfully assigned to booking ${bookingId}`);
          fetchQueueData();
        }}
      />
    </div>
  );
}