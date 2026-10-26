'use client';

import { useEffect, useState, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import { SosIncident } from '@/types';
import { formatToIST } from '@/lib/currency';
import { ShieldAlert } from 'lucide-react';

const RESOLUTION_CATEGORIES = [
  { code: 'FALSE_ALARM', label: 'False Alarm (Accidental Trigger)' },
  { code: 'RESOLVED_ON_SCENE', label: 'Resolved on Scene by Ops Desk' },
  { code: 'POLICE_ASSISTED', label: 'Local Police Dispatched & Assisting' },
  { code: 'ESCALATED_EXTERNALLY', label: 'Escalated to External Emergency Medical/Legal Team' },
];

export default function SosConsolePage() {
  const [incidents, setIncidents] = useState<SosIncident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<SosIncident | null>(null);
  const [resolutionCategory, setResolutionCategory] = useState(RESOLUTION_CATEGORIES[0].code);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  const fetchIncidents = async () => {
    try {
      const res = await apiClient.get('/admin/sos');
      setIncidents(res.data.data);
      if (res.data.data.length > 0 && !selectedIncident) {
        setSelectedIncident(res.data.data[0]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current || !selectedIncident) return;

    import('leaflet').then((L) => {
      if (!mapInstanceRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current).setView([selectedIncident.currentLat, selectedIncident.currentLng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        mapInstanceRef.current = map;
      }

      const map = mapInstanceRef.current;
      if (!map) return;

      L.marker([selectedIncident.currentLat, selectedIncident.currentLng]).addTo(map)
        .bindPopup(`<strong>EMERGENCY SOS</strong><br/>Vehicle: ${selectedIncident.vehicleRegistration}`)
        .openPopup();
    });
  }, [selectedIncident]);

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident) return;
    setSubmitting(true);

    try {
      await apiClient.post(`/admin/sos/${selectedIncident.incidentId}/resolve`, {
        resolutionCategory,
        resolutionSummary,
      });
      setSelectedIncident(null);
      fetchIncidents();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-rose-100 text-rose-600 rounded-lg">
            <ShieldAlert className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">Realtime Safety & SOS Emergency Desk</h1>
            <p className="text-xs text-rose-700 font-medium">Live operational command console for in-trip SOS alerts.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden h-[450px] shadow-xs relative">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>

        {selectedIncident ? (
          <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4 text-xs text-slate-700">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-rose-600 text-sm">Active Emergency #{selectedIncident.incidentId}</h3>
                <p className="text-slate-500 mt-0.5">Triggered: {formatToIST(selectedIncident.triggeredAt)}</p>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                {selectedIncident.status}
              </span>
            </div>

            <div className="space-y-2">
              <p><span className="text-slate-500">Passenger:</span> <strong className="text-slate-900">{selectedIncident.customerName}</strong> ({selectedIncident.customerPhoneMasked})</p>
              <p><span className="text-slate-500">Driver Partner:</span> <strong className="text-slate-900">{selectedIncident.driverName}</strong> ({selectedIncident.driverPhoneMasked})</p>
              <p><span className="text-slate-500">Vehicle:</span> {selectedIncident.vehicleModel} (<code className="text-indigo-600 font-semibold">{selectedIncident.vehicleRegistration}</code>)</p>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <span className="font-semibold text-slate-800 block mb-1">Emergency Contacts:</span>
              {selectedIncident.emergencyContacts.map((c, i) => (
                <div key={i} className="flex justify-between py-1 text-slate-600">
                  <span>{c.name}</span>
                  <span className="font-mono text-indigo-600 font-semibold">{c.phone}</span>
                </div>
              ))}
            </div>

            {selectedIncident.status === 'OPEN' && (
              <form onSubmit={handleResolveSubmit} className="pt-2 border-t border-slate-100 space-y-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600">Resolution Category</label>
                  <select
                    value={resolutionCategory}
                    onChange={(e) => setResolutionCategory(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                    required
                  >
                    {RESOLUTION_CATEGORIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600">Resolution Summary</label>
                  <textarea
                    rows={2}
                    value={resolutionSummary}
                    onChange={(e) => setResolutionSummary(e.target.value)}
                    placeholder="Document action taken and outcome..."
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition"
                >
                  {submitting ? 'Resolving...' : 'Confirm Resolution & Close Alert'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 rounded-xl border border-slate-200 bg-white flex items-center justify-center">
            Zero active emergency incidents reported.
          </div>
        )}
      </div>
    </div>
  );
}