'use client';

import { use, useEffect, useState, useRef, useCallback } from 'react';
import type L from 'leaflet';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { RideRecord, RideReceipt } from '@/types';
import { formatPaiseToInr, formatToIST } from '@/lib/currency';
import { ArrowLeft, Printer, XCircle, MapPin, CheckCircle, Clock } from 'lucide-react';

const CANCELLATION_REASONS = [
  { code: 'DRIVER_UNRESPONSIVE', label: 'Driver Unresponsive / Stalled' },
  { code: 'CUSTOMER_REQUEST', label: 'Customer Requested Ops Cancellation' },
  { code: 'DISPATCH_EXHAUSTED', label: 'Dispatch Attempts Exhausted' },
  { code: 'OPS_SAFETY_OVERRIDE', label: 'Operational Safety Intervention' },
];

export default function RideDetailPage({ params }: { params: Promise<{ rideId: string }> }) {
  const resolvedParams = use(params);
  const rideId = resolvedParams.rideId;

  const [ride, setRide] = useState<RideRecord | null>(null);
  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [cancelReason, setCancelReason] = useState(CANCELLATION_REASONS[0].code);
  const [feeDecision, setFeeDecision] = useState<'WAIVE' | 'APPLY_STANDARD_FEE'>('WAIVE');
  const [cancelNotes, setCancelNotes] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const fetchRideData = useCallback(async () => {
    try {
      const res = await apiClient.get(`/admin/rides/${rideId}`);
      setRide(res.data.data);
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    fetchRideData();
  }, [fetchRideData]);

  // Render Leaflet route polyline
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current || !ride?.routePolyline) return;

    import('leaflet').then((L) => {
      if (!mapInstanceRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current).setView(ride.routePolyline![0], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        mapInstanceRef.current = map;
      }

      const map = mapInstanceRef.current;
      if (!map) return;

      const polyline = L.polyline(ride.routePolyline!, { color: '#6366f1', weight: 4 }).addTo(map);
      map.fitBounds(polyline.getBounds(), { padding: [40, 40] });

      L.marker(ride.routePolyline![0]).addTo(map).bindPopup('Pickup: ' + ride.pickup.label);
      L.marker(ride.routePolyline![ride.routePolyline!.length - 1]).addTo(map).bindPopup('Drop: ' + ride.drop.label);
    });
  }, [ride]);

  const loadReceipt = async () => {
    if (!ride) return;
    const res = await apiClient.get(`/admin/bookings/${ride.bookingId}/receipt`);
    setReceipt(res.data.data);
    setShowReceiptModal(true);
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ride) return;
    setCancelLoading(true);

    try {
      await apiClient.post(`/admin/bookings/${ride.bookingId}/cancel`, {
        reasonCode: cancelReason,
        feeDecision,
        notes: cancelNotes,
      });
      setShowCancelModal(false);
      fetchRideData();
    } finally {
      setCancelLoading(false);
    }
  };

  if (loading) return <div className="text-slate-400 text-sm">Loading trip parameters...</div>;
  if (!ride) return <div className="text-rose-400 text-sm">Ride record not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/rides" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Trip #{ride.id}</h1>
            <p className="text-xs text-slate-400 mt-0.5">Booking: {ride.bookingId} • Status: {ride.status}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadReceipt}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition"
          >
            <Printer className="h-4 w-4" />
            <span>Print Receipt</span>
          </button>

          {ride.status !== 'COMPLETED' && ride.status !== 'CANCELLED' && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600 hover:text-white rounded-lg text-xs font-semibold transition"
            >
              <XCircle className="h-4 w-4" />
              <span>Cancel Trip</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid: Route Map & Transition Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden h-96 shadow-xl relative">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>

        <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Transition Timeline</h3>
          <div className="space-y-3 text-xs">
            <div className="flex items-center space-x-2 text-slate-300">
              <Clock className="h-4 w-4 text-slate-500" />
              <span>Requested: {formatToIST(ride.requestedAt)}</span>
            </div>
            {ride.acceptedAt && (
              <div className="flex items-center space-x-2 text-slate-300">
                <CheckCircle className="h-4 w-4 text-indigo-400" />
                <span>Driver Accepted: {formatToIST(ride.acceptedAt)}</span>
              </div>
            )}
            {ride.arrivedAt && (
              <div className="flex items-center space-x-2 text-slate-300">
                <MapPin className="h-4 w-4 text-sky-400" />
                <span>Driver Arrived: {formatToIST(ride.arrivedAt)}</span>
              </div>
            )}
            {ride.startedAt && (
              <div className="flex items-center space-x-2 text-slate-300">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                <span>Trip Started (OTP Verified): {formatToIST(ride.startedAt)}</span>
              </div>
            )}
            {ride.completedAt && (
              <div className="flex items-center space-x-2 text-slate-300">
                <CheckCircle className="h-4 w-4 text-emerald-500 font-bold" />
                <span>Completed: {formatToIST(ride.completedAt)}</span>
              </div>
            )}
            {ride.cancelledAt && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-300 space-y-1">
                <p className="font-semibold">Cancelled: {formatToIST(ride.cancelledAt)}</p>
                <p className="text-[10px] text-rose-400">{ride.cancellationReason}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fare Breakdown Card */}
      <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl">
        <h3 className="text-sm font-bold text-white mb-4">Itemized Fare Breakdown</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800">
            <span className="text-slate-400">Base Fare</span>
            <p className="font-mono text-sm font-bold text-slate-100 mt-1">{formatPaiseToInr(ride.fare.baseFarePaise)}</p>
          </div>
          <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800">
            <span className="text-slate-400">Distance Charges</span>
            <p className="font-mono text-sm font-bold text-slate-100 mt-1">{formatPaiseToInr(ride.fare.distanceFarePaise)}</p>
          </div>
          <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800">
            <span className="text-slate-400">Duration Charges</span>
            <p className="font-mono text-sm font-bold text-slate-100 mt-1">{formatPaiseToInr(ride.fare.timeFarePaise)}</p>
          </div>
          <div className="p-3 bg-indigo-950/40 rounded-xl border border-indigo-800/40">
            <span className="text-indigo-300 font-semibold">Final Total</span>
            <p className="font-mono text-base font-bold text-indigo-400 mt-1">{formatPaiseToInr(ride.fare.finalTotalPaise)}</p>
          </div>
        </div>
      </div>

      {/* Printable Receipt Modal */}
      {showReceiptModal && receipt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Ride Statement / Receipt</h3>
              <button onClick={() => setShowReceiptModal(false)} className="text-slate-400 hover:text-white text-xs">Close</button>
            </div>
            <div className="text-xs space-y-2">
              <p><span className="text-slate-400">Receipt ID:</span> {receipt.receiptId}</p>
              <p><span className="text-slate-400">Passenger:</span> {receipt.customerName}</p>
              <p><span className="text-slate-400">Driver Partner:</span> {receipt.driverName} ({receipt.vehicleDetails})</p>
              <p><span className="text-slate-400">Route:</span> {receipt.pickupAddress} &rarr; {receipt.dropAddress}</p>
              <p><span className="text-slate-400">Net Fare Paid:</span> <strong className="text-emerald-400 font-mono">{formatPaiseToInr(receipt.fare.finalTotalPaise)}</strong></p>
            </div>
            <button
              onClick={() => window.print()}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
            >
              Print / Save PDF
            </button>
          </div>
        </div>
      )}

      {/* Ops Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Administrative Cancellation</h3>
            <form onSubmit={handleCancelSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Mandatory Cancellation Reason
                </label>
                <select
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                  required
                >
                  {CANCELLATION_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Fee Policy Decision
                </label>
                <select
                  value={feeDecision}
                  onChange={(e) => setFeeDecision(e.target.value as 'WAIVE' | 'APPLY_STANDARD_FEE')}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value="WAIVE">Waive Cancellation Fee</option>
                  <option value="APPLY_STANDARD_FEE">Apply Standard Cancellation Fee</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Audit Notes
                </label>
                <textarea
                  rows={2}
                  value={cancelNotes}
                  onChange={(e) => setCancelNotes(e.target.value)}
                  placeholder="Record reason for operator intervention..."
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={cancelLoading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition"
                >
                  {cancelLoading ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}