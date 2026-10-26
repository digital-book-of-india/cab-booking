'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { DriverProfile } from '@/types';
import { formatToIST } from '@/lib/currency';
import { ArrowLeft, XCircle, RotateCcw, Ban, FileText, CheckCircle2 } from 'lucide-react';

const REJECTION_CODES = [
  { code: 'DOC_EXPIRED', label: 'Document Expired' },
  { code: 'BLURRY_IMAGE', label: 'Blurry / Illegible Image' },
  { code: 'INVALID_IDENTITY', label: 'Name or Identity Mismatch' },
  { code: 'VEHICLE_MISMATCH', label: 'Vehicle Details Mismatch' },
  { code: 'OTHER', label: 'Other Regulatory Policy Issue' },
];

export default function DriverDetailPage({ params }: { params: Promise<{ driverId: string }> }) {
  const resolvedParams = use(params);
  const driverId = resolvedParams.driverId;

  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalAction, setModalAction] = useState<'REJECT' | 'RESUBMIT' | 'SUSPEND' | null>(null);
  const [selectedReason, setSelectedReason] = useState(REJECTION_CODES[0].code);
  const [notes, setNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null);

  const fetchDriver = async () => {
    try {
      const res = await apiClient.get(`/admin/drivers/${driverId}`);
      setDriver(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDriver();
  }, [driverId]);

  const handleApprove = async () => {
    if (!confirm('Approve driver onboarding and activate vehicle for service?')) return;
    setActionLoading(true);
    try {
      await apiClient.patch(`/admin/drivers/${driverId}/approval`, {
        approvalStatus: 'APPROVED',
      });
      fetchDriver();
    } finally {
      setActionLoading(false);
    }
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const targetStatus =
        modalAction === 'REJECT'
          ? 'REJECTED'
          : modalAction === 'SUSPEND'
          ? 'SUSPENDED'
          : 'PENDING';

      await apiClient.patch(`/admin/drivers/${driverId}/approval`, {
        approvalStatus: targetStatus,
        reasonCode: selectedReason,
        notes,
      });

      setModalAction(null);
      fetchDriver();
    } finally {
      setActionLoading(false);
    }
  };

  const loadDocumentPreview = async (docId: string) => {
    const res = await apiClient.get(`/admin/drivers/${driverId}/documents/${docId}/url`);
    setPreviewDocUrl(res.data.data.url);
  };

  if (loading) return <div className="text-slate-400 text-sm">Loading driver KYC details...</div>;
  if (!driver) return <div className="text-rose-600 text-sm">Driver not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/drivers" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{driver.name}</h1>
            <p className="text-xs text-slate-500 mt-0.5">Phone: {driver.phoneMasked} - Status: {driver.approvalStatus}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {driver.approvalStatus !== 'APPROVED' && (
            <button
              onClick={handleApprove}
              disabled={actionLoading}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Approve Driver</span>
            </button>
          )}

          <button
            onClick={() => setModalAction('RESUBMIT')}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Request Resubmission</span>
          </button>

          <button
            onClick={() => setModalAction('REJECT')}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 text-xs font-semibold transition"
          >
            <XCircle className="h-4 w-4" />
            <span>Reject KYC</span>
          </button>

          <button
            onClick={() => setModalAction('SUSPEND')}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:text-rose-700 text-xs font-semibold transition"
          >
            <Ban className="h-4 w-4" />
            <span>Suspend</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {driver.documents.map((doc) => (
          <div key={doc.id} className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-700">{doc.type.replace('_', ' ')}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400">Ends with {doc.documentNumberLast4}</span>
            </div>

            <p className="text-xs text-slate-500">
              Expires On: <span className="text-slate-800 font-semibold">{formatToIST(doc.expiresAt)}</span>
            </p>

            <button
              onClick={() => loadDocumentPreview(doc.id)}
              className="w-full flex items-center justify-center space-x-2 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
            >
              <FileText className="h-4 w-4" />
              <span>Inspect Presigned Document</span>
            </button>
          </div>
        ))}
      </div>

      {previewDocUrl && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-white border border-slate-200 rounded-2xl overflow-hidden p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Document High-Res Viewer</h3>
              <button onClick={() => setPreviewDocUrl(null)} className="text-slate-400 hover:text-slate-900 text-xs font-bold">Close</button>
            </div>
            <div className="h-96 rounded-xl overflow-hidden bg-slate-50 flex items-center justify-center border border-slate-200">
              <img src={previewDocUrl} alt="KYC Document Preview" className="h-full w-full object-contain" />
            </div>
          </div>
        </div>
      )}

      {modalAction && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              {modalAction === 'REJECT' ? 'Reject Driver Application' : modalAction === 'RESUBMIT' ? 'Request Document Resubmission' : 'Suspend Driver Account'}
            </h3>

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">
                  Mandatory Reason Code
                </label>
                <select
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                >
                  {REJECTION_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">
                  Audit Notes
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Explain the regulatory or compliance reason for this decision..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalAction(null)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition"
                >
                  {actionLoading ? 'Saving...' : 'Confirm Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}