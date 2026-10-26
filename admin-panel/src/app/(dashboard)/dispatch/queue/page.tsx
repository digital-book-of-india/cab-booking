'use client';

import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api-client';
import { getIdempotencyKey, IDEMPOTENCY_HEADER } from '@/lib/idempotency';
import { DispatchQueueItem, LiveDriverLocation } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';
import { RefreshCw, AlertCircle } from 'lucide-react';

const OVERRIDE_REASONS = [
  { code: 'DISPATCH_TIMEOUT', label: 'Dispatch Timeout (No Driver Accepted)' },
  { code: 'CUSTOMER_VIP_REQUEST', label: 'High Priority / VIP Dispatch' },
  { code: 'SYSTEM_REBALANCING', label: 'Zone Balancing Allocation' },
  { code: 'OPS_OVERRIDE', label: 'Manual Operational Reassignment' },
];

export default function DispatchQueuePage() {
  const [queue, setQueue] = useState<DispatchQueueItem[]>([]);
  const [onlineDrivers, setOnlineDrivers] = useState<LiveDriverLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBooking, setSelectedBooking] = useState<DispatchQueueItem | null>(null);
  const [targetDriverId, setTargetDriverId] = useState('');
  const [reasonCode, setReasonCode] = useState(OVERRIDE_REASONS[0].code);
  const [notes, setNotes] = useState('');
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchQueueData = async () => {
    try {
      const [queueRes, driversRes] = await Promise.all([
        apiClient.get('/admin/dispatch/queue'),
        apiClient.get('/admin/drivers/live'),
      ]);
      setQueue(queueRes.data.data);
      setOnlineDrivers(driversRes.data.data.filter((d: LiveDriverLocation) => !d.currentRideId));
      if (driversRes.data.data.length > 0) {
        setTargetDriverId(driversRes.data.data[0].driverId);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueData();
  }, []);

  const handleRetryDispatch = async (bookingId: string) => {
    await apiClient.post(`/bookings/${bookingId}/dispatch/retry`);
    fetchQueueData();
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;

    setConflictError(null);
    setActionLoading(true);

    try {
      await apiClient.post(
        `/admin/bookings/${selectedBooking.bookingId}/assign-driver`,
        {
          driverId: targetDriverId,
          reasonCode,
          notes,
        },
        {
          headers: {
            [IDEMPOTENCY_HEADER]: getIdempotencyKey('assign', selectedBooking.bookingId),
          },
        }
      );

      setSelectedBooking(null);
      fetchQueueData();
    } catch (err: unknown) {
      if (isAxiosError(err) && ((err.response?.data as { code?: string })?.code === 'RIDE_ALREADY_ASSIGNED' || err.response?.status === 409)) {
        setConflictError('Ride was accepted by another driver concurrently. Candidate queue refreshed.');
        fetchQueueData();
      } else {
        const errMsg = isAxiosError(err) ? (err.response?.data as { message?: string })?.message || err.message : err instanceof Error ? err.message : 'Assignment failed.';
        setConflictError(errMsg);
      }
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Active Dispatch Queue</h1>
          <p className="text-xs text-slate-500 mt-1">
            Monitor unassigned bookings, dispatch timeouts, and execute manual driver allocation overrides.
          </p>
        </div>
        <button
          onClick={fetchQueueData}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Refresh Queue</span>
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Booking ID</th>
              <th className="px-6 py-3.5">Passenger</th>
              <th className="px-6 py-3.5">Pickup Location</th>
              <th className="px-6 py-3.5">Destination</th>
              <th className="px-6 py-3.5">Estimated Fare</th>
              <th className="px-6 py-3.5">Status</th>
              <th className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">Checking dispatch state...</td></tr>
            ) : queue.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-400">No unassigned rides in dispatch queue.</td></tr>
            ) : (
              queue.map((item) => (
                <tr key={item.bookingId} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4 font-mono font-bold text-indigo-700 text-xs">{item.bookingId}</td>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900 text-xs">{item.customerName}</p>
                    <span className="text-[11px] font-mono text-slate-500">{item.customerPhoneMasked}</span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-700 max-w-xs truncate">{item.pickup.label}</td>
                  <td className="px-6 py-4 text-xs text-slate-700 max-w-xs truncate">{item.drop.label}</td>
                  <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">
                    {formatPaiseToInr(item.estimatedFarePaise)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                        item.status === 'DISPATCHING'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {item.status} ({item.dispatchAttempts} tries)
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => handleRetryDispatch(item.bookingId)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => setSelectedBooking(item)}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition"
                    >
                      Assign Driver
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedBooking && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Manual Driver Assignment Override</h3>
            <p className="text-xs text-slate-500">
              Assigning Booking <span className="font-mono text-indigo-700 font-semibold">{selectedBooking.bookingId}</span>
            </p>

            {conflictError && (
              <div className="flex items-center space-x-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{conflictError}</span>
              </div>
            )}

            <form onSubmit={handleAssignSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">
                  Select Eligible Online Driver
                </label>
                <select
                  value={targetDriverId}
                  onChange={(e) => setTargetDriverId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                >
                  {onlineDrivers.map((d) => (
                    <option key={d.driverId} value={d.driverId}>
                      {d.name} ({d.vehicleReg} • {d.category})
                    </option>
                  ))}
                  <option value="drv_conflict">[Test 409 Conflict Simulation]</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">
                  Mandatory Override Reason
                </label>
                <select
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                >
                  {OVERRIDE_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">
                  Audit Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Record justification for bypassing automated dispatch..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedBooking(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition"
                >
                  {actionLoading ? 'Assigning...' : 'Lock Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}