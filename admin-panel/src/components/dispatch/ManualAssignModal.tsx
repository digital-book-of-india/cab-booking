'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  UserCheck,
  Car,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { DispatchQueueItem } from '@/types';
import { formatPaiseToInr } from '@/lib/currency';

interface ManualAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: DispatchQueueItem | null;
  onSuccess: (bookingId: string) => void;
}

interface AvailableDriver {
  driverId: string;
  userId?: string;
  name: string;
  phone?: string | null;
  onlineStatus: string;
  activeRideId: string | null;
  location?: { lat: number; lng: number } | null;
  headingDegrees?: number | null;
  vehicle?: {
    vehicleId: string;
    make: string;
    model: string;
    registrationNumber: string;
    categoryId: string;
  } | null;
}

const PRESET_REASONS = [
  'Dispatch Timeout (No Automated Driver Acceptance)',
  'High Priority / VIP Rider Manual Allocation',
  'Nearest Available Driver Manual Dispatch',
  'Zone Balancing & Fleet Reassignment Override',
  'Customer Support Direct Escalation Request',
];

export function ManualAssignModal({
  isOpen,
  onClose,
  booking,
  onSuccess,
}: ManualAssignModalProps) {
  const [drivers, setDrivers] = useState<AvailableDriver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [reason, setReason] = useState(PRESET_REASONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch online available drivers
  useEffect(() => {
    if (!isOpen || !booking) return;

    let isMounted = true;
    const timer = setTimeout(() => {
      setLoadingDrivers(true);
      setError(null);
      setSelectedDriverId('');
    }, 0);

    apiClient
      .get('/admin/drivers/live')
      .then((res) => {
        if (!isMounted) return;
        const raw = res.data?.data?.items || res.data?.data || [];
        const items: AvailableDriver[] = Array.isArray(raw) ? raw : [];

        // Filter drivers who are online and not on an active ride
        const available = items.filter(
          (d) => d.onlineStatus === 'ONLINE' && !d.activeRideId
        );
        setDrivers(available);

        // Pre-select matching category driver if available
        const matching = available.find(
          (d) => d.vehicle?.categoryId === booking.categoryId
        );
        if (matching) {
          setSelectedDriverId(matching.driverId);
        } else if (available.length > 0) {
          setSelectedDriverId(available[0].driverId);
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const errorMsg = (err as Error)?.message || 'Failed to load live online drivers. Please retry.';
        console.warn('Failed to fetch available drivers:', errorMsg);
        setError('Failed to load live online drivers. Please retry.');
      })
      .finally(() => {
        if (isMounted) setLoadingDrivers(false);
      });

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, booking]);

  if (!isOpen || !booking) return null;

  const maskPhone = (phone?: string | null) => {
    if (!phone) return '—';
    if (phone.length <= 6) return phone;
    return `${phone.slice(0, 5)}••••${phone.slice(-3)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverId) {
      setError('Please select an eligible driver from the list.');
      return;
    }

    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setError('Reason must be at least 3 characters long.');
      return;
    }
    if (cleanReason.length > 300) {
      setError('Reason must not exceed 300 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiClient.post(
        `/admin/bookings/${booking.bookingId}/assign-driver`,
        {
          driverId: selectedDriverId,
          reason: cleanReason,
        },
        {
          headers: {
            'Idempotency-Key': `idemp_assign_${booking.bookingId}_${Date.now()}`,
          },
        }
      );

      onSuccess(booking.bookingId);
      onClose();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; error?: { message?: string }; message?: string };
      const msg =
        apiErr?.response?.data?.error?.message ||
        apiErr?.error?.message ||
        apiErr?.message ||
        'Assignment failed. The driver may have become unavailable or the booking changed state.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Manual Driver Assignment Override
              </h2>
              <p className="text-xs text-slate-500 font-mono">
                Booking: <span className="font-bold text-indigo-600">{booking.bookingId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Booking Brief Card */}
        <div className="px-6 py-4 bg-slate-50/70 border-b border-slate-100">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-[11px] font-semibold uppercase text-slate-400">Rider</span>
              <p className="font-bold text-slate-900 mt-0.5">
                {booking.customerName || 'Customer'}
              </p>
              <p className="font-mono text-slate-500">{maskPhone(booking.customerPhone)}</p>
            </div>

            <div className="text-right">
              <span className="text-[11px] font-semibold uppercase text-slate-400">
                Category & Fare
              </span>
              <p className="font-bold text-slate-900 mt-0.5">
                {formatPaiseToInr(booking.estimatedFarePaise)}
              </p>
              <span className="inline-block rounded-md bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700 text-[11px]">
                {booking.categoryName || 'Cab'}
              </span>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200/60 text-xs space-y-1">
            <div className="flex items-center space-x-2 truncate">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate text-slate-700 font-medium" title={booking.pickup.label || 'Pickup'}>
                {booking.pickup.label || 'Pickup location'}
              </span>
            </div>
            <div className="flex items-center space-x-2 truncate">
              <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
              <span className="truncate text-slate-700 font-medium" title={booking.drop.label || 'Destination'}>
                {booking.drop.label || 'Drop location'}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 flex items-start space-x-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Driver Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-700">
                Select Available Driver <span className="text-rose-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400">
                {drivers.length} online drivers available
              </span>
            </div>

            {loadingDrivers ? (
              <div className="flex items-center justify-center py-8 text-xs text-slate-400 space-x-2 rounded-xl border border-dashed border-slate-200">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                <span>Locating available fleet drivers...</span>
              </div>
            ) : drivers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                <Car className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                No online, idle drivers found. Drivers must be Online with no active ride.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {drivers.map((d) => {
                  const isSelected = d.driverId === selectedDriverId;
                  const isCategoryMatch = d.vehicle?.categoryId === booking.categoryId;

                  return (
                    <div
                      key={d.driverId}
                      onClick={() => setSelectedDriverId(d.driverId)}
                      className={`cursor-pointer rounded-xl p-3 border transition flex items-center justify-between ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-600'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Car className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-xs text-slate-900">{d.name}</span>
                            {isCategoryMatch && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800">
                                Matching Category
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2 text-[11px] text-slate-500 font-mono">
                            <span>
                              {d.vehicle?.make} {d.vehicle?.model}
                            </span>
                            <span>•</span>
                            <span className="font-bold text-slate-700">
                              {d.vehicle?.registrationNumber || 'No Plate'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right flex items-center space-x-2">
                        <input
                          type="radio"
                          name="selectedDriver"
                          checked={isSelected}
                          onChange={() => setSelectedDriverId(d.driverId)}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reason Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Audit Override Reason <span className="text-rose-500">*</span>
              </label>
              <span
                className={`text-[11px] ${
                  reason.length > 300 ? 'text-rose-600 font-bold' : 'text-slate-400'
                }`}
              >
                {reason.length}/300 chars
              </span>
            </div>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State justification for manually overriding dispatch queue..."
              className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none transition"
              disabled={submitting}
              required
            />

            {/* Quick Templates */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESET_REASONS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setReason(preset)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition text-left"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedDriverId || reason.trim().length < 3}
              className="inline-flex items-center space-x-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Assigning Driver...</span>
                </>
              ) : (
                <>
                  <UserCheck className="h-4 w-4" />
                  <span>Confirm & Assign Driver</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
