'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  Maximize2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  FileText,
  AlertTriangle,
  Calendar,
  Hash,
  Shield,
  Eye,
} from 'lucide-react';

export interface DriverDocItem {
  id: string;
  type: string;
  status?: string | null;
  documentNumberLast4?: string | null;
  expiresAt?: string | Date | null;
  rejectionReason?: string | null;
  createdAt: string | Date;
  downloadUrl?: string;
}

interface DocumentInspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: DriverDocItem | null;
  driverName: string;
  onApprove: (docId: string) => Promise<void>;
  onReject: (docId: string, reason: string) => Promise<void>;
}

const DOC_NAMES: { [key: string]: string } = {
  DRIVING_LICENSE: 'Commercial Driving License',
  VEHICLE_REGISTRATION: 'Vehicle Registration Certificate (RC)',
  VEHICLE_INSURANCE: 'Commercial Motor Insurance Policy',
  AADHAAR_FRONT: 'Aadhaar Card (Identity Proof)',
  PAN_CARD: 'Permanent Account Number (PAN)',
  POLICE_VERIFICATION: 'Police Clearance Certificate',
};

const QUICK_REJECTION_REASONS = [
  'Document expired or expiring within 15 days',
  'Blurry / unreadable text or cropped borders',
  'Name mismatch with driver profile application',
  'Document is not issued by a recognized authority',
  'Suspicious document or image tampering detected',
];

export default function DocumentInspectionModal({
  isOpen,
  onClose,
  document,
  driverName,
  onApprove,
  onReject,
}: DocumentInspectionModalProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState(QUICK_REJECTION_REASONS[0]);
  const [actionLoading, setActionLoading] = useState(false);

  // Reset zoom & rotation whenever document changes
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setImageError(false);
    setIsRejecting(false);
  }, [document]);

  if (!isOpen || !document) return null;

  const docTitle = DOC_NAMES[document.type] || document.type.replace(/_/g, ' ');
  const isExpired = document.expiresAt ? new Date(document.expiresAt) < new Date() : false;

  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleReset = () => {
    setScale(1);
    setRotation(0);
  };

  const handleApproveClick = async () => {
    setActionLoading(true);
    try {
      await onApprove(document.id);
      onClose();
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectClick = async () => {
    if (!rejectionReason.trim()) return;
    setActionLoading(true);
    try {
      await onReject(document.id, rejectionReason.trim());
      onClose();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">{docTitle}</h2>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    document.status === 'APPROVED'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : document.status === 'REJECTED'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  {document.status || 'PENDING'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Applicant: <strong className="text-slate-900">{driverName}</strong>
                {document.documentNumberLast4 && (
                  <span className="ml-2 font-mono text-indigo-600 font-semibold">
                    (Ending in ****{document.documentNumberLast4})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {document.downloadUrl && (
              <a
                href={document.downloadUrl}
                target="_blank"
                rel="noreferrer"
                title="Open original document"
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Toolbar & Metadata Strip */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Metadata */}
          <div className="flex items-center space-x-4 text-slate-600">
            {document.expiresAt && (
              <div className="flex items-center space-x-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <span>
                  Expires:{' '}
                  <span className={isExpired ? 'text-rose-600 font-bold' : 'text-slate-800'}>
                    {new Date(document.expiresAt).toLocaleDateString()}
                  </span>
                </span>
                {isExpired && (
                  <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                    EXPIRED
                  </span>
                )}
              </div>
            )}
            {document.rejectionReason && (
              <div className="text-rose-600 text-[11px] truncate max-w-xs font-medium">
                Reason: {document.rejectionReason}
              </div>
            )}
          </div>

          {/* Canvas Controls */}
          <div className="flex items-center space-x-1.5 bg-white border border-slate-200 p-1 rounded-xl shadow-xs">
            <button
              onClick={handleZoomOut}
              disabled={scale <= 0.5}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-mono px-1.5 text-slate-700 min-w-[42px] text-center font-semibold">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={scale >= 3}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <div className="h-3 w-px bg-slate-200 mx-1" />
            <button
              onClick={handleRotate}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
              title="Rotate 90° Clockwise"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleReset}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-[10px] font-semibold transition"
              title="Reset View"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Image Inspection Canvas */}
        <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center p-6 min-h-[350px] relative">
          {document.downloadUrl && !imageError ? (
            <div
              className="transition-transform duration-200 origin-center max-w-full"
              style={{
                transform: `scale(${scale}) rotate(${rotation}deg)`,
              }}
            >
              <img
                src={document.downloadUrl}
                alt={docTitle}
                onError={() => setImageError(true)}
                className="max-h-[500px] w-auto object-contain rounded-xl shadow-xl border border-slate-300"
              />
            </div>
          ) : (
            /* Crisp Document Record Card if image missing or mock */
            <div
              className="transition-transform duration-200 origin-center max-w-md w-full"
              style={{
                transform: `scale(${scale}) rotate(${rotation}deg)`,
              }}
            >
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-6 text-slate-800 space-y-4 shadow-xl font-mono">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center space-x-2">
                    <Shield className="h-5 w-5 text-indigo-600" />
                    <span className="font-bold text-xs uppercase tracking-wider text-slate-900">
                      Official Document Record
                    </span>
                  </div>
                  <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 font-semibold px-2 py-0.5 rounded">
                    ENCRYPTED_VAULT
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Document Type:</span>
                    <span className="text-indigo-700 font-bold">{docTitle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Document Identifier:</span>
                    <span className="text-slate-900 font-semibold">
                      {document.documentNumberLast4 ? `XXXX-XXXX-${document.documentNumberLast4}` : 'UNSPECIFIED'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Holder Name:</span>
                    <span className="text-slate-900 font-semibold">{driverName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Validity:</span>
                    <span className={isExpired ? 'text-rose-600 font-bold' : 'text-emerald-700 font-bold'}>
                      {document.expiresAt
                        ? `${new Date(document.expiresAt).toLocaleDateString()} (${isExpired ? 'EXPIRED' : 'VALID'})`
                        : 'NO_EXPIRY_STATED'}
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-500 text-center font-sans">
                  Secure Document Payload verified by Driver Onboarding Module
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer: Verification Decision Bar */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          {!isRejecting ? (
            <>
              <div className="text-xs text-slate-600">
                Current status:{' '}
                <strong className="text-slate-900 font-bold">{document.status || 'PENDING'}</strong>
              </div>

              <div className="flex items-center space-x-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsRejecting(true)}
                  disabled={actionLoading}
                  className="flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  <span>Reject Document</span>
                </button>

                <button
                  type="button"
                  onClick={handleApproveClick}
                  disabled={actionLoading || document.status === 'APPROVED'}
                  className="flex-1 sm:flex-initial flex items-center justify-center space-x-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-md shadow-emerald-200 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{document.status === 'APPROVED' ? 'Approved' : 'Approve Document'}</span>
                </button>
              </div>
            </>
          ) : (
            /* Rejection Sub-Form */
            <div className="w-full space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-rose-600" /> Mandatory Rejection Reason
                </label>
                <button
                  onClick={() => setIsRejecting(false)}
                  className="text-xs text-slate-500 hover:text-slate-900 font-semibold"
                >
                  Back
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-rose-500"
                >
                  {QUICK_REJECTION_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleRejectClick}
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shrink-0 disabled:opacity-50 shadow-xs"
                >
                  {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
