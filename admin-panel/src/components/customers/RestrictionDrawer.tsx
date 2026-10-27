'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Clock,
  CheckCircle2,
  Ban,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatToIST } from '@/lib/currency';

interface RestrictionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  customerName?: string | null;
  isCurrentlyRestricted: boolean;
  currentReason?: string | null;
  restrictedAt?: string | null;
  onSuccess: (updated: {
    bookingRestricted: boolean;
    reason: string | null;
    restrictedAt: string | null;
  }) => void;
}

const PRESET_REASONS = [
  'Repeated rider no-shows & cancellation abuse',
  'Unpaid ride balance dispute pending settlement',
  'Reported driver misconduct or safety violation',
  'Suspected fraud or payment chargeback risk',
  'Identity verification required before booking',
];

export function RestrictionDrawer({
  isOpen,
  onClose,
  customerId,
  customerName,
  isCurrentlyRestricted,
  currentReason,
  restrictedAt,
  onSuccess,
}: RestrictionDrawerProps) {
  const [action, setAction] = useState<'RESTRICT' | 'LIFT'>('RESTRICT');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when drawer opens or current status changes
  useEffect(() => {
    if (isOpen) {
      const nextAction = isCurrentlyRestricted ? 'LIFT' : 'RESTRICT';
      const timer = setTimeout(() => {
        setAction(nextAction);
        setReason('');
        setError(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isCurrentlyRestricted]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setError('Please provide a descriptive reason (at least 3 characters).');
      return;
    }
    if (cleanReason.length > 300) {
      setError('Reason must not exceed 300 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await apiClient.post(`/admin/customers/${customerId}/restrictions`, {
        action,
        reason: cleanReason,
      });

      const data = res.data?.data || res.data;
      onSuccess({
        bookingRestricted: action === 'RESTRICT',
        reason: action === 'RESTRICT' ? cleanReason : null,
        restrictedAt: data?.restrictedAt || (action === 'RESTRICT' ? new Date().toISOString() : null),
      });
      onClose();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; error?: { message?: string }; message?: string };
      const msg =
        apiErr?.response?.data?.error?.message ||
        apiErr?.error?.message ||
        apiErr?.message ||
        'Failed to update booking restriction status.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-md transform bg-white shadow-2xl transition-all duration-300 ease-in-out border-l border-slate-200 flex flex-col">
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center space-x-2.5">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  isCurrentlyRestricted
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-indigo-100 text-indigo-700'
                }`}
              >
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Booking Restrictions
                </h2>
                <p className="text-xs text-slate-500 font-mono">
                  {customerName || 'Customer'}: {customerId.slice(0, 8)}...
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              aria-label="Close drawer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Current Status Box */}
            <div
              className={`rounded-xl p-4 border ${
                isCurrentlyRestricted
                  ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                  : 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
              }`}
            >
              <div className="flex items-start space-x-3">
                {isCurrentlyRestricted ? (
                  <Ban className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                ) : (
                  <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                )}
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-xs tracking-wider uppercase">
                      Current State:
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        isCurrentlyRestricted
                          ? 'bg-amber-200 text-amber-900'
                          : 'bg-emerald-200 text-emerald-900'
                      }`}
                    >
                      {isCurrentlyRestricted ? 'RESTRICTED' : 'STANDARD (NO RESTRICTION)'}
                    </span>
                  </div>
                  {isCurrentlyRestricted ? (
                    <div className="mt-2 text-xs space-y-1">
                      <p className="text-amber-800 font-medium">
                        Reason: &quot;{currentReason || 'No reason specified'}&quot;
                      </p>
                      {restrictedAt && (
                        <p className="text-[11px] text-amber-700/80 flex items-center space-x-1">
                          <Clock className="h-3 w-3 inline" />
                          <span>Applied on {formatToIST(restrictedAt)}</span>
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-700">
                      Rider can request rides, top-up wallet, and schedule bookings freely without
                      dispatch restrictions.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 flex items-start space-x-2.5 text-rose-700 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Action Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Select Action
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAction('RESTRICT')}
                    className={`flex items-center justify-center space-x-2 rounded-lg py-2.5 px-3 text-xs font-semibold border transition ${
                      action === 'RESTRICT'
                        ? 'bg-rose-50 border-rose-300 text-rose-700 shadow-xs ring-1 ring-rose-300'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Ban className="h-3.5 w-3.5" />
                    <span>Apply Restriction</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAction('LIFT')}
                    className={`flex items-center justify-center space-x-2 rounded-lg py-2.5 px-3 text-xs font-semibold border transition ${
                      action === 'LIFT'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-xs ring-1 ring-emerald-300'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Lift Restriction</span>
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {action === 'RESTRICT'
                    ? 'Restricting prevents rider from creating instant & scheduled bookings.'
                    : 'Lifting restores standard booking access immediately.'}
                </p>
              </div>

              {/* Mandatory Reason */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="restriction-reason"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Audit Reason <span className="text-rose-500">*</span>
                  </label>
                  <span
                    className={`text-[11px] ${
                      reason.length > 300
                        ? 'text-rose-600 font-bold'
                        : 'text-slate-400'
                    }`}
                  >
                    {reason.length}/300 chars
                  </span>
                </div>
                <textarea
                  id="restriction-reason"
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    action === 'RESTRICT'
                      ? 'Specify why booking is being restricted (e.g. repeated cancellations, safety complaints, payment fraud investigation)...'
                      : 'Specify why restriction is being lifted (e.g. customer verified phone, dispute settled)...'
                  }
                  className="w-full rounded-lg border border-slate-200 p-3 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none transition"
                  disabled={submitting}
                />
              </div>

              {/* Quick Presets */}
              {action === 'RESTRICT' && (
                <div>
                  <span className="block text-[11px] font-medium text-slate-500 mb-2">
                    Quick Templates:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_REASONS.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setReason(preset)}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition text-left"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || reason.trim().length < 3}
              className={`inline-flex items-center space-x-2 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed ${
                action === 'RESTRICT'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Updating...</span>
                </>
              ) : action === 'RESTRICT' ? (
                <>
                  <Ban className="h-3.5 w-3.5" />
                  <span>Confirm Restriction</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Confirm Lift</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
