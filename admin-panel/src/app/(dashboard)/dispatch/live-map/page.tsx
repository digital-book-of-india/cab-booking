'use client';

import { useEffect, useState, useRef } from 'react';
import type L from 'leaflet';
import { apiClient } from '@/lib/api-client';
import { LiveDriverLocation } from '@/types';
import { Radio, RefreshCw } from 'lucide-react';

export default function LiveMapPage() {
  const [drivers, setDrivers] = useState<LiveDriverLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<LiveDriverLocation | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  const fetchLiveFleet = async () => {
    try {
      const res = await apiClient.get('/admin/drivers/live');
      setDrivers(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveFleet();
    const interval = setInterval(fetchLiveFleet, 10000); // 10s polling radar
    return () => clearInterval(interval);
  }, []);

  // Initialize Leaflet Map safely in client browser
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    import('leaflet').then((L) => {
      if (!mapInstanceRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current).setView([28.6139, 77.2090], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        mapInstanceRef.current = map;
      }

      const map = mapInstanceRef.current;
      if (!map) return;

      // Update driver markers
      drivers.forEach((drv) => {
        const iconHtml = `
          <div style="transform: rotate(${drv.headingDegrees}deg);" class="flex items-center justify-center h-8 w-8 rounded-full border-2 ${
            drv.currentRideId ? 'border-sky-400 bg-sky-950/90 text-sky-400' : 'border-emerald-400 bg-emerald-950/90 text-emerald-400'
          } shadow-lg shadow-black">
            <svg class="h-4 w-4 fill-current" viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>
        `;

        const customIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-driver-pin',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        if (markersRef.current[drv.driverId]) {
          markersRef.current[drv.driverId].setLatLng([drv.lat, drv.lng]);
          markersRef.current[drv.driverId].setIcon(customIcon);
        } else {
          const marker = L.marker([drv.lat, drv.lng], { icon: customIcon }).addTo(map);
          marker.on('click', () => setSelectedDriver(drv));
          markersRef.current[drv.driverId] = marker;
        }
      });
    });
  }, [drivers]);

  return (
    <div className="relative h-[calc(100vh-8rem)] rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-2xl flex flex-col">
      {/* Top Controls Overlay */}
      <div className="absolute top-4 left-4 z-20 flex items-center space-x-3 bg-slate-900/90 backdrop-blur-md px-4 py-2.5 rounded-xl border border-slate-800 shadow-xl">
        <Radio className="h-5 w-5 text-emerald-400 animate-pulse" />
        <div>
          <h2 className="text-sm font-bold text-white tracking-tight">Live Fleet Radar</h2>
          <p className="text-[10px] text-slate-400">Streaming active GPS positions • {drivers.length} online vehicles</p>
        </div>
        <button
          onClick={fetchLiveFleet}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          title="Refresh Radar"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
        </button>
      </div>

      {/* Selected Driver Inspection Drawer */}
      {selectedDriver && (
        <div className="absolute top-4 right-4 z-20 w-80 bg-slate-900/95 backdrop-blur-md p-5 rounded-2xl border border-slate-800 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white">{selectedDriver.name}</h3>
              <p className="text-xs text-slate-400 font-mono">{selectedDriver.phoneMasked}</p>
            </div>
            <button onClick={() => setSelectedDriver(null)} className="text-slate-400 hover:text-white text-xs">Close</button>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Vehicle:</span>
              <span className="font-medium text-slate-200">{selectedDriver.vehicleMakeModel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Registration:</span>
              <span className="font-mono text-indigo-400 font-semibold">{selectedDriver.vehicleReg}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Category:</span>
              <span className="text-slate-200">{selectedDriver.category}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Telemetry Speed:</span>
              <span className="text-emerald-400 font-bold">{selectedDriver.speedKmh} km/h</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Status:</span>
              <span className={`font-semibold ${selectedDriver.currentRideId ? 'text-sky-400' : 'text-emerald-400'}`}>
                {selectedDriver.currentRideId ? 'On Active Trip' : 'Available for Dispatch'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Map Canvas */}
      <div ref={mapContainerRef} className="h-full w-full z-10" />
    </div>
  );
}