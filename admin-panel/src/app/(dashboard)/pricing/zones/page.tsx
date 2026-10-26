'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { ServiceZone } from '@/types';
import { formatToIST } from '@/lib/currency';
import { MapPin, Plus, CheckCircle2, Clock, Globe } from 'lucide-react';

export default function ServiceZonesPage() {
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [cityName, setCityName] = useState('New Delhi');
  const [operatingHoursStart, setOperatingHoursStart] = useState('00:00');
  const [operatingHoursEnd, setOperatingHoursEnd] = useState('23:59');

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  const fetchZones = async () => {
    try {
      const res = await apiClient.get('/admin/zones');
      setZones(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
  }, []);

  // Render Leaflet map with zone polygons
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    import('leaflet').then((L) => {
      if (!mapInstanceRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current).setView([28.6139, 77.2090], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        mapInstanceRef.current = map;
      }

      const map = mapInstanceRef.current;
      if (!map) return;

      zones.forEach((z) => {
        if (z.polygon && z.polygon.length > 0) {
          L.polygon(z.polygon, {
            color: z.active ? '#6366f1' : '#64748b',
            fillColor: z.active ? '#6366f1' : '#64748b',
            fillOpacity: 0.25,
            weight: 2,
          }).addTo(map).bindPopup(`<strong>${z.name}</strong><br/>Hours: ${z.operatingHours.start} - ${z.operatingHours.end}`);
        }
      });
    });
  }, [zones]);

  const toggleZoneActive = async (zone: ServiceZone) => {
    await apiClient.patch(`/admin/zones/${zone.id}`, { active: !zone.active });
    fetchZones();
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiClient.post('/admin/zones', {
      name,
      cityName,
      operatingHours: { start: operatingHoursStart, end: operatingHoursEnd },
    });
    setShowAddModal(false);
    setName('');
    fetchZones();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Service Zones & Geofencing</h1>
          <p className="text-xs text-slate-400 mt-1">Configure operational municipal zones, coverage boundaries, and active operating hours.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
        >
          <Plus className="h-4 w-4" />
          <span>Create Geofence Zone</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map Preview */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden h-[450px] shadow-xl relative">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>

        {/* Zones List */}
        <div className="space-y-4 overflow-y-auto max-h-[450px]">
          {loading ? (
            <div className="text-slate-500 text-xs">Loading operational zones...</div>
          ) : (
            zones.map((z) => (
              <div key={z.id} className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-100 text-sm">{z.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${z.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                    {z.active ? 'OPERATIONAL' : 'PAUSED'}
                  </span>
                </div>

                <div className="text-xs text-slate-400 space-y-1">
                  <div className="flex items-center space-x-2">
                    <Globe className="h-3.5 w-3.5 text-indigo-400" />
                    <span>City: {z.cityName}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                    <span>Operating Hours: {z.operatingHours.start} - {z.operatingHours.end}</span>
                  </div>
                </div>

                <button
                  onClick={() => toggleZoneActive(z)}
                  className={`w-full py-1.5 rounded-lg text-xs font-semibold transition ${
                    z.active ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-indigo-600 text-white hover:bg-indigo-500'
                  }`}
                >
                  {z.active ? 'Pause Operating Zone' : 'Activate Zone'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Create Geofence Zone</h3>
            <form onSubmit={handleCreateZone} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">Zone Name</label>
                <input
                  type="text"
                  placeholder="e.g. South Delhi Suburbs"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">Operating Hours</label>
                <div className="flex items-center space-x-2 mt-1">
                  <input
                    type="time"
                    value={operatingHoursStart}
                    onChange={(e) => setOperatingHoursStart(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                  />
                  <span className="text-slate-400 text-xs">to</span>
                  <input
                    type="time"
                    value={operatingHoursEnd}
                    onChange={(e) => setOperatingHoursEnd(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
                >
                  Save Zone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}