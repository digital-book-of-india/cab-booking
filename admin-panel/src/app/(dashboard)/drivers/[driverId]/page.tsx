'use client';

import React, { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { formatToIST } from '@/lib/currency';
import DocumentInspectionModal, { DriverDocItem } from '@/components/drivers/DocumentInspectionModal';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Ban,
  FileText,
  ShieldCheck,
  AlertTriangle,
  Car,
  Phone,
  MapPin,
  Eye,
  X,
  AlertCircle,
} from 'lucide-react';

interface DriverVehicle {
  id: string;
  registrationNumber: string;
  categoryId: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

interface DriverDetailData {
  driverId: string;
  name: string | null;
  phone: string | null;
  accountStatus: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  onlineStatus: 'ONLINE' | 'OFFLINE';
  city: string | null;
  submittedAt: string | null;
  decisionReason: string | null;
  documents: DriverDocItem[];
  vehicles: DriverVehicle[];
}

const REJECTION_PRESETS = [
  'Incomplete KYC documentation submitted',
  'Forged or tampered documents detected',
  'Commercial driver license does not meet state guidelines',
  'Criminal background or police verification failure',
  'Regulatory non-compliance with municipal transport norms',
];

export default function DriverDetailPage({ params }: { params: Promise<{ driverId: string }> }) {
  const resolvedParams = use(params);
  const driverId = resolvedParams.driverId;

  const [driver, setDriver] = useState<DriverDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Document modal inspection
  const [inspectingDoc, setInspectingDoc] = useState<DriverDocItem | null>(null);

  // Overall decision modal state
  const [decisionModal, setDecisionModal] = useState<{
    type: 'REJECT' | 'REQUEST_RESUBMISSION' | 'SUSPEND';
  } | null>(null);
  const [decisionReason, setDecisionReason] = useState(REJECTION_PRESETS[0]);
  const [customReason, setCustomReason] = useState('');

  // Toast banner
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4500);
  };

  const fetchDriver = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/admin/drivers/${driverId}`);
      setDriver(res.data?.data || res.data);
    } catch (err: unknown) {
      const apiErr = err as { message?: string };
      console.warn('Failed to load driver KYC:', apiErr?.message || err);
      showToast('Failed to load driver KYC inspection details', 'error');
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchDriver();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchDriver]);

  // Overall Approve Onboarding
  const handleApproveDriver = async () => {
    if (!driver) return;
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/drivers/${driverId}/approve`);
      showToast(`Driver ${driver.name || driverId} has been approved for live operations!`, 'success');
      fetchDriver();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const msg = apiErr.response?.data?.error?.message || apiErr.message || 'Failed to approve driver.';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Rejection / Resubmission / Suspension
  const handleDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionModal) return;

    const combinedReason = customReason.trim()
      ? `${decisionReason}: ${customReason.trim()}`
      : decisionReason;

    setActionLoading(true);
    try {
      if (decisionModal.type === 'REJECT') {
        await apiClient.post(`/admin/drivers/${driverId}/reject`, { reason: combinedReason });
        showToast('Driver onboarding application rejected.', 'success');
      } else if (decisionModal.type === 'REQUEST_RESUBMISSION') {
        await apiClient.post(`/admin/drivers/${driverId}/request-resubmission`, { reason: combinedReason });
        showToast('Document resubmission notice dispatched to driver.', 'success');
      } else if (decisionModal.type === 'SUSPEND') {
        await apiClient.post(`/admin/drivers/${driverId}/suspend`, { reason: combinedReason });
        showToast('Driver account suspended immediately.', 'success');
      }
      setDecisionModal(null);
      setCustomReason('');
      fetchDriver();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const msg = apiErr.response?.data?.error?.message || apiErr.message || 'Action failed.';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Document Individual Approve
  const handleApproveDoc = async (docId: string) => {
    setActionLoading(true);
    try {
      await apiClient.patch(`/admin/drivers/${driverId}/documents/${docId}/review`, {
        status: 'APPROVED',
      });
      showToast('Document approved successfully.', 'success');
      fetchDriver();
      if (inspectingDoc?.id === docId) {
        setInspectingDoc(null);
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const msg = apiErr.response?.data?.error?.message || apiErr.message || 'Failed to approve document.';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Document Individual Reject
  const handleRejectDoc = async (docId: string, reason: string) => {
    setActionLoading(true);
    try {
      await apiClient.patch(`/admin/drivers/${driverId}/documents/${docId}/review`, {
        status: 'REJECTED',
        rejectionReason: reason,
      });
      showToast('Document rejected.', 'success');
      fetchDriver();
      if (inspectingDoc?.id === docId) {
        setInspectingDoc(null);
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const msg = apiErr.response?.data?.error?.message || apiErr.message || 'Failed to reject document.';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Review Vehicle Verification
  const handleVehicleVerification = async (vehicleId: string, status: 'VERIFIED' | 'REJECTED') => {
    let reason = undefined;
    if (status === 'REJECTED') {
      const entered = prompt('Enter vehicle verification rejection reason:');
      if (!entered) return;
      reason = entered;
    }

    setActionLoading(true);
    try {
      await apiClient.patch(`/admin/vehicles/${vehicleId}/verification`, {
        status,
        reason,
      });
      showToast(`Vehicle verification status updated to ${status}.`, 'success');
      fetchDriver();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const msg = apiErr.response?.data?.error?.message || apiErr.message || 'Failed to update vehicle verification.';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-slate-500 space-y-3">
        <div className="h-8 w-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-semibold">Loading driver KYC inspection desk...</p>
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="p-10 text-center bg-white border border-rose-200 rounded-2xl space-y-3 text-rose-600 text-sm shadow-xs">
        <AlertTriangle className="h-10 w-10 mx-auto text-rose-500" />
        <h2 className="text-base font-bold text-slate-900">Driver profile not found</h2>
        <p className="text-xs text-slate-500">The requested driver profile could not be located in the fleet registry.</p>
        <Link href="/drivers" className="inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs">
          Return to Drivers Directory
        </Link>
      </div>
    );
  }

  const pendingDocsCount = driver.documents.filter((d) => d.status === 'PENDING').length;
  const approvedDocsCount = driver.documents.filter((d) => d.status === 'APPROVED').length;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-[99999] flex items-center space-x-2.5 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md animate-slideDown ${
            toast.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toast.text}</span>
          {toast.type === 'success' && (
            <Link
              href="/settings/audit-logs"
              className="ml-2 inline-flex items-center space-x-1 font-bold text-emerald-700 hover:text-emerald-900 underline text-xs whitespace-nowrap"
            >
              <span>View Audit Trail →</span>
            </Link>
          )}
          <button onClick={() => setToast(null)} className="p-1 text-slate-400 hover:text-slate-600 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Top Navigation & Profile Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-6 rounded-2xl bg-white border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-4">
          <Link
            href="/drivers"
            className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">{driver.name || 'Unnamed Driver'}</h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  driver.approvalStatus === 'APPROVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : driver.approvalStatus === 'REJECTED'
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : driver.approvalStatus === 'SUSPENDED'
                    ? 'bg-slate-100 text-slate-700 border border-slate-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                }`}
              >
                {driver.approvalStatus}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
              <span className="flex items-center gap-1 font-mono text-slate-700">
                <Phone className="h-3.5 w-3.5 text-indigo-600" /> {driver.phone || '—'}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-slate-400" /> {driver.city || 'Delhi NCR'}
              </span>
              <span>•</span>
              <span className="font-mono text-slate-400 text-[11px]">ID: {driver.driverId}</span>
              {driver.submittedAt && (
                <>
                  <span>•</span>
                  <span>Submitted {formatToIST(driver.submittedAt)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Global Compliance Action Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setDecisionModal({ type: 'SUSPEND' })}
            disabled={actionLoading || driver.approvalStatus === 'SUSPENDED'}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold transition disabled:opacity-40"
          >
            <Ban className="h-3.5 w-3.5 inline mr-1 text-slate-500" />
            Suspend
          </button>

          <button
            onClick={() => setDecisionModal({ type: 'REQUEST_RESUBMISSION' })}
            disabled={actionLoading}
            className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-semibold transition disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5 inline mr-1 text-amber-600" />
            Resubmit Docs
          </button>

          <button
            onClick={() => setDecisionModal({ type: 'REJECT' })}
            disabled={actionLoading || driver.approvalStatus === 'REJECTED'}
            className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition disabled:opacity-40"
          >
            <XCircle className="h-3.5 w-3.5 inline mr-1 text-rose-600" />
            Reject Application
          </button>

          <button
            onClick={handleApproveDriver}
            disabled={actionLoading || driver.approvalStatus === 'APPROVED'}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-md shadow-emerald-200 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
            {driver.approvalStatus === 'APPROVED' ? 'Approved & Live' : 'Approve Onboarding'}
          </button>
        </div>
      </div>

      {/* Decision Reason Banner if set */}
      {driver.decisionReason && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start space-x-2.5">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong className="block text-amber-900 font-semibold">Historical Decision Note:</strong>
            <span>{driver.decisionReason}</span>
          </div>
        </div>
      )}

      {/* Compliance Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="text-xs text-slate-500 font-semibold mb-1">Total Documents</div>
          <div className="text-2xl font-black text-slate-900">{driver.documents.length}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Uploaded KYC attachments</div>
        </div>

        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/60 shadow-xs">
          <div className="text-xs text-amber-700 font-semibold mb-1">Pending Audit</div>
          <div className="text-2xl font-black text-amber-800">{pendingDocsCount}</div>
          <div className="text-[10px] text-amber-600/80 mt-0.5">Awaiting staff sign-off</div>
        </div>

        <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-xs">
          <div className="text-xs text-emerald-700 font-semibold mb-1">Verified Documents</div>
          <div className="text-2xl font-black text-emerald-800">{approvedDocsCount}</div>
          <div className="text-[10px] text-emerald-600/80 mt-0.5">Validated compliance proofs</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="text-xs text-slate-500 font-semibold mb-1">Assigned Vehicles</div>
          <div className="text-2xl font-black text-indigo-600">{driver.vehicles.length}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Fleet registration link</div>
        </div>
      </div>

      {/* Section 1: Presigned Documents Inspection Desk */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              KYC Compliance Documents
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect uploaded identification and transport proofs with the interactive zoom & rotation inspection desk.
            </p>
          </div>
        </div>

        {driver.documents.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-slate-200 bg-white text-center text-slate-500 text-xs">
            <FileText className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">No KYC documents uploaded yet.</p>
            <p className="text-[11px] mt-1 text-slate-400">Driver partner has not submitted onboarding proofs.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {driver.documents.map((doc) => {
              const isExpired = doc.expiresAt ? new Date(doc.expiresAt) < new Date() : false;

              return (
                <div
                  key={doc.id}
                  className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-4 hover:border-indigo-300 hover:shadow-md transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-900 text-sm tracking-tight">
                        {doc.type.replace(/_/g, ' ')}
                      </h3>
                      {doc.documentNumberLast4 && (
                        <p className="text-[11px] font-mono text-indigo-600">
                          ID: ****{doc.documentNumberLast4}
                        </p>
                      )}
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        doc.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : doc.status === 'REJECTED'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {doc.status || 'PENDING'}
                    </span>
                  </div>

                  <div className="space-y-1 text-xs text-slate-600 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Validity:</span>
                      <span className={isExpired ? 'text-rose-600 font-bold' : 'text-slate-800'}>
                        {doc.expiresAt
                          ? `${new Date(doc.expiresAt).toLocaleDateString()} ${isExpired ? '(EXPIRED)' : ''}`
                          : 'No expiry stated'}
                      </span>
                    </div>

                    {doc.rejectionReason && (
                      <div className="text-rose-600 text-[11px] pt-1">
                        Rejection reason: {doc.rejectionReason}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      onClick={() => setInspectingDoc(doc)}
                      className="flex-1 py-2 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center justify-center space-x-1.5 transition"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Inspect Document</span>
                    </button>

                    {doc.status !== 'APPROVED' && (
                      <button
                        onClick={() => handleApproveDoc(doc.id)}
                        className="p-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition"
                        title="Quick Approve Document"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 2: Vehicle Inspection & Verification Desk */}
      <div className="space-y-3 pt-2">
        <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Car className="h-5 w-5 text-indigo-600" />
          Vehicle Assignment & Fleet Inspection
        </h2>

        {driver.vehicles.length === 0 ? (
          <div className="p-6 rounded-2xl border border-dashed border-slate-200 bg-white text-center text-slate-500 text-xs">
            No vehicle currently mapped to this driver profile.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {driver.vehicles.map((v) => (
              <div
                key={v.id}
                className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-4 hover:border-slate-300 transition"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-sm font-bold text-slate-900 tracking-wider bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                        {v.registrationNumber}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Vehicle ID: {v.id}</p>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      v.verificationStatus === 'VERIFIED'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : v.verificationStatus === 'REJECTED'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {v.verificationStatus}
                  </span>
                </div>

                <div className="flex items-center space-x-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => handleVehicleVerification(v.id, 'VERIFIED')}
                    disabled={actionLoading || v.verificationStatus === 'VERIFIED'}
                    className="flex-1 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold transition disabled:opacity-40"
                  >
                    Verify Vehicle
                  </button>
                  <button
                    onClick={() => handleVehicleVerification(v.id, 'REJECTED')}
                    disabled={actionLoading || v.verificationStatus === 'REJECTED'}
                    className="flex-1 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition disabled:opacity-40"
                  >
                    Reject Vehicle
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Document Inspection & Zoom/Rotate Modal */}
      <DocumentInspectionModal
        isOpen={!!inspectingDoc}
        onClose={() => setInspectingDoc(null)}
        document={inspectingDoc}
        driverName={driver.name || 'Driver'}
        onApprove={handleApproveDoc}
        onReject={handleRejectDoc}
      />

      {/* Overall Decision Modal */}
      {decisionModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {decisionModal.type === 'REJECT'
                  ? 'Reject Driver Application'
                  : decisionModal.type === 'SUSPEND'
                  ? 'Suspend Driver Account'
                  : 'Request Document Resubmission'}
              </h3>
              <button
                onClick={() => setDecisionModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleDecisionSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Preset Policy Reason *
                </label>
                <select
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                >
                  {REJECTION_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Specific Officer Notes (Optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Additional context or instructions for the driver partner..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDecisionModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className={`px-4 py-2 rounded-xl text-white text-xs font-bold transition shadow-xs ${
                    decisionModal.type === 'REJECT'
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {actionLoading ? 'Submitting...' : 'Confirm Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}