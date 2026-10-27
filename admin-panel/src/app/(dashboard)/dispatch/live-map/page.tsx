'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  connectSocket,
  onDriverLocation,
  emitSimulateLocation,
  DriverLocationPayload,
} from '@/lib/socket';
import {
  Radio,
  RefreshCw,
  Car,
  Compass,
  Navigation,
  ZoomIn,
  Zap,
  X,
  Phone,
  Gauge,
  Wifi,
  WifiOff,
} from 'lucide-react';

export interface FleetDriver {
  driverId: string;
  userId?: string;
  name: string;
  phoneMasked: string;
  lat: number;
  lng: number;
  headingDegrees: number;
  speedKmh: number;
  vehicleMakeModel: string;
  vehicleReg: string;
  category: string;
  currentRideId: string | null;
  updatedAt: string;
}

type FilterStatus = 'ALL' | 'AVAILABLE' | 'ON_TRIP';

export default function LiveMapPage() {
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [lastTelemetryPing, setLastTelemetryPing] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<{ [driverId: string]: any }>({});
  const leafletRef = useRef<any>(null);
  const isSimulatingRef = useRef(false);

  // Helper: Mask phone number
  const maskPhone = (phone?: string | null) => {
    if (!phone) return '—';
    if (phone.length <= 6) return phone;
    return `${phone.slice(0, 5)}••••${phone.slice(-3)}`;
  };

  // Helper: Normalize raw API driver object
  const normalizeDriver = (d: any): FleetDriver => {
    const lat = d.location?.lat ?? d.lat ?? 28.6139;
    const lng = d.location?.lng ?? d.lng ?? 77.2090;
    const makeModel = d.vehicle
      ? `${d.vehicle.make || ''} ${d.vehicle.model || ''}`.trim()
      : d.vehicleMakeModel || 'Standard Cab';
    const reg = d.vehicle?.registrationNumber || d.vehicleReg || '—';

    return {
      driverId: d.driverId || d._id || d.userId,
      userId: d.userId,
      name: d.name || 'Fleet Driver',
      phoneMasked: maskPhone(d.phone || d.phoneMasked),
      lat,
      lng,
      headingDegrees: d.headingDegrees ?? 0,
      speedKmh: d.speedKmh ?? (d.speedMetersPerSecond ? Math.round(d.speedMetersPerSecond * 3.6) : 0),
      vehicleMakeModel: makeModel,
      vehicleReg: reg,
      category: d.vehicle?.categoryName || d.category || 'Prime Sedan',
      currentRideId: d.activeRideId || d.currentRideId || null,
      updatedAt: d.locationUpdatedAt || d.updatedAt || new Date().toISOString(),
    };
  };

  // 1. Initial REST fetch for active fleet
  const fetchLiveFleet = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/drivers/live');
      const rawItems = res.data?.data?.items || res.data?.data || [];
      const normalized: FleetDriver[] = Array.isArray(rawItems)
        ? rawItems.map(normalizeDriver)
        : [];
      setDrivers(normalized);
    } catch (err: any) {
      console.warn('Failed to load fleet:', err?.message || err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. Setup Socket.IO realtime connection & listeners
  useEffect(() => {
    fetchLiveFleet();

    const socket = connectSocket();

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    if (socket.connected) setSocketConnected(true);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Subscribe to real-time telemetry updates
    const unsubscribe = onDriverLocation((payload: DriverLocationPayload) => {
      setLastTelemetryPing(new Date().toLocaleTimeString());

      setDrivers((prev) => {
        const index = prev.findIndex(
          (d) => d.driverId === payload.driverId || d.userId === payload.driverId
        );

        if (index !== -1) {
          const updated = [...prev];
          const curr = updated[index];
          updated[index] = {
            ...curr,
            lat: payload.lat,
            lng: payload.lng,
            headingDegrees: payload.headingDegrees ?? curr.headingDegrees,
            speedKmh: payload.speedKmh ?? curr.speedKmh,
            updatedAt: payload.recordedAt || new Date().toISOString(),
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              driverId: payload.driverId,
              userId: payload.userId,
              name: 'Live Driver',
              phoneMasked: '—',
              lat: payload.lat,
              lng: payload.lng,
              headingDegrees: payload.headingDegrees ?? 0,
              speedKmh: payload.speedKmh ?? 30,
              vehicleMakeModel: 'Active Vehicle',
              vehicleReg: '—',
              category: 'Cab',
              currentRideId: null,
              updatedAt: payload.recordedAt || new Date().toISOString(),
            },
          ];
        }
      });
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unsubscribe();
    };
  }, [fetchLiveFleet]);

  // 3. Initialize Leaflet Map (client-side only)
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    let isMounted = true;

    import('leaflet').then((L) => {
      if (!isMounted) return;
      leafletRef.current = L;

      if (!mapInstanceRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current, {
          zoomControl: false,
        }).setView([28.6139, 77.2090], 12);

        L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
          {
            maxZoom: 19,
            attribution: '&copy; CartoDB &copy; OpenStreetMap contributors',
          }
        ).addTo(map);

        L.control.zoom({ position: 'bottomright' }).addTo(map);

        mapInstanceRef.current = map;
      }
    });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersRef.current = {};
      }
    };
  }, []);

  // 4. Update & Animate Leaflet Markers smoothly when drivers state changes
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    const currentDriverIds = new Set(drivers.map((d) => d.driverId));

    Object.keys(markersRef.current).forEach((id) => {
      if (!currentDriverIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    drivers.forEach((drv) => {
      const isOnTrip = Boolean(drv.currentRideId);
      const isSelected = drv.driverId === selectedDriverId;

      const markerHtml = `
        <div class="relative flex items-center justify-center cursor-pointer">
          <div class="absolute h-10 w-10 rounded-full animate-ping opacity-30 ${
            isOnTrip ? 'bg-sky-500' : 'bg-emerald-500'
          }"></div>
          
          <div style="transform: rotate(${drv.headingDegrees}deg); transition: transform 0.4s ease-out;" 
               class="relative flex items-center justify-center h-9 w-9 rounded-full border-2 shadow-xl ${
                 isSelected
                   ? 'border-indigo-400 bg-indigo-950 text-indigo-300 ring-4 ring-indigo-500/40'
                   : isOnTrip
                   ? 'border-sky-400 bg-sky-950 text-sky-400 shadow-sky-950/50'
                   : 'border-emerald-400 bg-emerald-950 text-emerald-400 shadow-emerald-950/50'
               }">
            <svg class="h-4 w-4 fill-current drop-shadow-sm" viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: markerHtml,
        className: 'smooth-radar-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      if (markersRef.current[drv.driverId]) {
        const marker = markersRef.current[drv.driverId];
        marker.setLatLng([drv.lat, drv.lng]);
        marker.setIcon(customIcon);
      } else {
        const marker = L.marker([drv.lat, drv.lng], { icon: customIcon }).addTo(map);
        marker.on('click', () => {
          setSelectedDriverId(drv.driverId);
          map.panTo([drv.lat, drv.lng], { animate: true, duration: 0.6 });
        });
        markersRef.current[drv.driverId] = marker;
      }
    });
  }, [drivers, selectedDriverId]);

  const centerOnDriver = (d: FleetDriver) => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setView([d.lat, d.lng], 15, { animate: true, duration: 0.8 });
  };

  const fitAllDrivers = () => {
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (!L || !map || drivers.length === 0) return;

    const bounds = L.latLngBounds(drivers.map((d) => [d.lat, d.lng]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14, animate: true });
  };

  const toggleSimulation = () => {
    if (isSimulatingRef.current) {
      isSimulatingRef.current = false;
      return;
    }
    isSimulatingRef.current = true;

    const interval = setInterval(() => {
      if (!isSimulatingRef.current) {
        clearInterval(interval);
        return;
      }

      setDrivers((current) => {
        if (current.length === 0) return current;
        const randomIdx = Math.floor(Math.random() * current.length);
        const drv = current[randomIdx];

        const dLat = (Math.random() - 0.48) * 0.0025;
        const dLng = (Math.random() - 0.48) * 0.0025;
        const newLat = drv.lat + dLat;
        const newLng = drv.lng + dLng;
        const newHeading = Math.round((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
        const newSpeed = Math.floor(25 + Math.random() * 30);

        emitSimulateLocation(drv.driverId, newLat, newLng, newHeading, newSpeed);

        return current.map((d, i) =>
          i === randomIdx
            ? {
                ...d,
                lat: newLat,
                lng: newLng,
                headingDegrees: newHeading,
                speedKmh: newSpeed,
                updatedAt: new Date().toISOString(),
              }
            : d
        );
      });
    }, 2500);
  };

  const filteredDrivers = useMemo(() => {
    return drivers.filter((d) => {
      if (filter === 'AVAILABLE') return !d.currentRideId;
      if (filter === 'ON_TRIP') return Boolean(d.currentRideId);
      return true;
    });
  }, [drivers, filter]);

  const selectedDriver = drivers.find((d) => d.driverId === selectedDriverId) || null;
  const availableCount = drivers.filter((d) => !d.currentRideId).length;
  const onTripCount = drivers.filter((d) => Boolean(d.currentRideId)).length;

  return (
    <div className="relative h-[calc(100vh-7.5rem)] rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs flex flex-col">
      {/* Top Header Controls Overlay */}
      <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-3">
        <div className="flex items-center space-x-3 rounded-xl border border-slate-200/80 bg-white/95 backdrop-blur-md px-4 py-2.5 shadow-lg">
          <div className="relative">
            <Radio className="h-5 w-5 text-emerald-600 animate-pulse" />
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 tracking-tight">
                Live Fleet Radar
              </h1>
              <span
                className={`inline-flex items-center space-x-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  socketConnected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {socketConnected ? (
                  <>
                    <Wifi className="h-2.5 w-2.5" />
                    <span>SOCKET LIVE</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-2.5 w-2.5" />
                    <span>DISCONNECTED</span>
                  </>
                )}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Streaming real-time telemetry • {drivers.length} online vehicles
            </p>
          </div>
          <button
            onClick={fetchLiveFleet}
            disabled={loading}
            className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition"
            title="Reload Fleet via REST"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
          </button>
        </div>

        {/* Fleet Filter Tabs */}
        <div className="hidden sm:flex items-center rounded-xl border border-slate-200/80 bg-white/95 backdrop-blur-md p-1 shadow-lg text-xs font-semibold">
          <button
            onClick={() => setFilter('ALL')}
            className={`rounded-lg px-3 py-1.5 transition ${
              filter === 'ALL'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({drivers.length})
          </button>
          <button
            onClick={() => setFilter('AVAILABLE')}
            className={`flex items-center space-x-1.5 rounded-lg px-3 py-1.5 transition ${
              filter === 'AVAILABLE'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Available ({availableCount})</span>
          </button>
          <button
            onClick={() => setFilter('ON_TRIP')}
            className={`flex items-center space-x-1.5 rounded-lg px-3 py-1.5 transition ${
              filter === 'ON_TRIP'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            <span>On Trip ({onTripCount})</span>
          </button>
        </div>

        {/* Fit Bounds & Dev Simulation Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={fitAllDrivers}
            className="inline-flex items-center space-x-1.5 rounded-xl border border-slate-200/80 bg-white/95 backdrop-blur-md px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-lg"
            title="Auto-fit Map Bounds to all drivers"
          >
            <ZoomIn className="h-3.5 w-3.5 text-indigo-600" />
            <span>Fit Fleet</span>
          </button>

          <button
            onClick={toggleSimulation}
            className={`inline-flex items-center space-x-1.5 rounded-xl px-3 py-2 text-xs font-semibold shadow-lg transition border ${
              isSimulatingRef.current
                ? 'bg-amber-500 text-white border-amber-600 animate-pulse'
                : 'border-slate-200/80 bg-white/95 text-slate-700 hover:bg-slate-50'
            }`}
            title="Start live GPS movement simulator"
          >
            <Zap className={`h-3.5 w-3.5 ${isSimulatingRef.current ? 'text-white' : 'text-amber-500'}`} />
            <span>{isSimulatingRef.current ? 'Simulating Movement...' : 'Simulate GPS'}</span>
          </button>
        </div>
      </div>

      {/* Selected Driver Inspection Drawer */}
      {selectedDriver && (
        <div className="absolute top-4 right-4 z-20 w-84 bg-white/95 backdrop-blur-md p-5 rounded-2xl border border-slate-200 shadow-2xl space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
          <div className="flex items-start justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-sm text-white ${
                  selectedDriver.currentRideId ? 'bg-sky-600' : 'bg-emerald-600'
                }`}
              >
                <Car className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{selectedDriver.name}</h3>
                <div className="flex items-center space-x-1 text-xs text-slate-500">
                  <Phone className="h-3 w-3 text-slate-400" />
                  <span className="font-mono">{selectedDriver.phoneMasked}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedDriverId(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-slate-50">
              <span className="text-slate-500">Vehicle:</span>
              <span className="font-semibold text-slate-800">{selectedDriver.vehicleMakeModel}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-50">
              <span className="text-slate-500">Registration:</span>
              <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                {selectedDriver.vehicleReg}
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-50">
              <span className="text-slate-500">Category:</span>
              <span className="font-medium text-slate-700">{selectedDriver.category}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-50">
              <span className="text-slate-500">Live Speed:</span>
              <div className="flex items-center space-x-1 font-bold text-emerald-600">
                <Gauge className="h-3.5 w-3.5" />
                <span>{selectedDriver.speedKmh} km/h</span>
              </div>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-50">
              <span className="text-slate-500">Heading:</span>
              <div className="flex items-center space-x-1 font-mono text-slate-700">
                <Compass className="h-3.5 w-3.5 text-slate-400" />
                <span>{selectedDriver.headingDegrees}°</span>
              </div>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-500">Operational State:</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  selectedDriver.currentRideId
                    ? 'bg-sky-50 text-sky-700 border border-sky-200'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}
              >
                {selectedDriver.currentRideId ? 'On Active Trip' : 'Available for Dispatch'}
              </span>
            </div>
          </div>

          <div className="pt-2 flex items-center space-x-2">
            <button
              onClick={() => centerOnDriver(selectedDriver)}
              className="flex-1 inline-flex items-center justify-center space-x-1.5 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
            >
              <Navigation className="h-3.5 w-3.5 text-indigo-600" />
              <span>Center on Map</span>
            </button>
            <button
              onClick={() => {
                const dLat = (Math.random() - 0.5) * 0.003;
                const dLng = (Math.random() - 0.5) * 0.003;
                emitSimulateLocation(
                  selectedDriver.driverId,
                  selectedDriver.lat + dLat,
                  selectedDriver.lng + dLng,
                  (selectedDriver.headingDegrees + 45) % 360,
                  45
                );
              }}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition shadow-xs"
              title="Ping Telemetry"
            >
              <Zap className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Map Canvas */}
      <div ref={mapContainerRef} className="h-full w-full z-10" />

      {/* CSS overrides for smooth marker movement */}
      <style jsx global>{`
        .smooth-radar-marker {
          transition: transform 0.6s cubic-bezier(0.25, 1, 0.5, 1) !important;
        }
      `}</style>
    </div>
  );
}