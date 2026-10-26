'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { ServiceZone, GeoJsonPolygon } from '@/types';
import ZoneCreateModal, { toGeoJsonPolygon } from '@/components/pricing/ZoneCreateModal';
import {
  MapPin,
  Plus,
  CheckCircle2,
  Clock,
  Globe,
  Layers,
  Search,
  Filter,
  RefreshCw,
  Edit3,
  Trash2,
  Eye,
  Activity,
  AlertCircle,
  X,
  Save,
  RotateCcw,
  Maximize2,
  Pentagon,
  Square,
  Shield,
  Sliders,
} from 'lucide-react';

// Extract Leaflet latlngs to clean {lat, lng} array
function extractLayerCoordinates(layer: any): { lat: number; lng: number }[] {
  let latlngs = layer.getLatLngs();
  // Unwrap nested arrays from polygons
  while (
    Array.isArray(latlngs) &&
    latlngs.length > 0 &&
    Array.isArray(latlngs[0]) &&
    typeof (latlngs[0] as any).lat !== 'number'
  ) {
    latlngs = latlngs[0];
  }

  return (latlngs as any[]).map((pt) => ({
    lat: typeof pt.lat === 'number' ? pt.lat : pt[0],
    lng: typeof pt.lng === 'number' ? pt.lng : pt[1],
  }));
}

// Convert backend polygon (GeoJSON or array) to Leaflet [lat, lng][] array
function parseZoneToLeafletCoords(polygon: any): [number, number][] {
  if (!polygon) return [];
  // GeoJSON Polygon shape: coordinates: [ [ [lng, lat], ... ] ]
  if (polygon.coordinates && Array.isArray(polygon.coordinates) && polygon.coordinates.length > 0) {
    const ring = polygon.coordinates[0];
    if (Array.isArray(ring)) {
      return ring.map(([lng, lat]: [number, number]) => [lat, lng]);
    }
  }
  // Array of coordinates [lat, lng][]
  if (Array.isArray(polygon) && polygon.length > 0) {
    if (typeof polygon[0][0] === 'number') {
      return polygon;
    }
  }
  return [];
}

export default function ServiceZonesPage() {
  const [zones, setZones] = useState<ServiceZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  // Drawing state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [drawnCoordinates, setDrawnCoordinates] = useState<{ lat: number; lng: number }[] | null>(null);
  const [isDrawingModeActive, setIsDrawingModeActive] = useState(false);

  // Vertex Editing state
  const [editingZone, setEditingZone] = useState<{
    zone: ServiceZone;
    originalCoords: [number, number][];
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Toast banner state
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 4500);
  };

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const zoneLayersRef = useRef<{ [zoneId: string]: any }>({});
  const draftLayerRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);

  // Fetch all service zones from backend
  const fetchZones = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/admin/zones');
      const list = res.data?.data || [];
      setZones(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error('Failed to load zones:', err);
      showToast('Failed to load operational zones', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  // 1. Initialize Leaflet Map with Geoman Free Controls
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    let isMounted = true;

    const setupMap = async () => {
      const L = (await import('leaflet')).default || (await import('leaflet'));
      (window as any).L = L;
      await import('@geoman-io/leaflet-geoman-free');

      if (!isMounted || !mapContainerRef.current || mapInstanceRef.current) return;

      leafletRef.current = L;

      // Delhi NCR central coordinates
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
      }).setView([28.6139, 77.2090], 11);

      // CartoDB Voyager basemap
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; CartoDB &copy; OpenStreetMap contributors',
      }).addTo(map);

      // Custom zoom control in bottom right
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Add Geoman drawing & editing toolbar controls
      map.pm.addControls({
        position: 'topleft',
        drawMarker: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawRectangle: true,
        drawPolygon: true,
        drawCircle: false,
        drawText: false,
        editMode: true,
        dragMode: false,
        cutPolygon: false,
        removalMode: true,
        rotateMode: false,
      });

      // Handle newly drawn shapes (Polygon or Rectangle)
      map.on('pm:create', (e: any) => {
        const layer = e.layer;
        draftLayerRef.current = layer;
        setIsDrawingModeActive(false);

        const coords = extractLayerCoordinates(layer);
        if (coords.length >= 3) {
          setDrawnCoordinates(coords);
          setIsModalOpen(true);
        } else {
          showToast('Invalid shape: at least 3 vertices required', 'error');
          map.removeLayer(layer);
        }
      });

      mapInstanceRef.current = map;
    };

    setupMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Render and sync operational zones onto Leaflet map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    // Clear existing zone layers
    Object.values(zoneLayersRef.current).forEach((layer) => {
      map.removeLayer(layer);
    });
    zoneLayersRef.current = {};

    zones.forEach((zone) => {
      const coords = parseZoneToLeafletCoords(zone.polygon);
      if (coords.length < 3) return;

      const isSelected = selectedZoneId === zone.id;
      const isEditing = editingZone?.zone.id === zone.id;

      // Color scheme: Active=Indigo, Inactive=Slate, Selected=Purple, Editing=Amber
      const fillColor = isEditing
        ? '#f59e0b'
        : isSelected
        ? '#6366f1'
        : zone.active
        ? '#4f46e5'
        : '#64748b';

      const strokeColor = isEditing
        ? '#d97706'
        : isSelected
        ? '#4338ca'
        : zone.active
        ? '#4338ca'
        : '#475569';

      const polygonLayer = L.polygon(coords, {
        color: strokeColor,
        weight: isSelected || isEditing ? 3.5 : 2,
        fillColor,
        fillOpacity: isSelected || isEditing ? 0.35 : 0.18,
        dashArray: zone.active ? undefined : '5, 5',
      }).addTo(map);

      // Tooltip on hover
      polygonLayer.bindTooltip(
        `<div style="font-family: inherit; font-size: 11px; font-weight: bold; padding: 2px 4px;">
           <span style="color: ${zone.active ? '#10b981' : '#f59e0b'};">●</span> ${zone.name}
           <div style="font-size: 9px; color: #64748b; font-weight: normal;">Code: ${zone.code || 'ZONE'}</div>
         </div>`,
        { permanent: false, direction: 'center', opacity: 0.95 }
      );

      // Click polygon to select
      polygonLayer.on('click', () => {
        setSelectedZoneId(zone.id);
        map.fitBounds(polygonLayer.getBounds(), { padding: [50, 50], maxZoom: 14 });
      });

      zoneLayersRef.current[zone.id] = polygonLayer;
    });
  }, [zones, selectedZoneId, editingZone]);

  // Focus specific zone on map
  const handleFocusZone = (zone: ServiceZone) => {
    setSelectedZoneId(zone.id);
    const layer = zoneLayersRef.current[zone.id];
    const map = mapInstanceRef.current;
    if (layer && map) {
      map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 14 });
    }
  };

  // Start vertex editing mode for a zone
  const handleStartEditing = (zone: ServiceZone) => {
    const layer = zoneLayersRef.current[zone.id];
    const map = mapInstanceRef.current;
    if (!layer || !map) return;

    // Discard any existing edit in progress
    if (editingZone && zoneLayersRef.current[editingZone.zone.id]) {
      zoneLayersRef.current[editingZone.zone.id].pm.disable();
    }

    const currentCoords = parseZoneToLeafletCoords(zone.polygon);
    setEditingZone({
      zone,
      originalCoords: currentCoords,
    });
    setSelectedZoneId(zone.id);

    // Enable Geoman vertex edit mode on this polygon
    layer.pm.enable({
      allowSelfIntersection: false,
      preventMarkerRemoval: false,
    });

    map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 14 });
    showToast(`Vertex editing active for "${zone.name}". Drag vertices to adjust boundaries.`, 'success');
  };

  // Cancel vertex editing mode
  const handleCancelEditing = () => {
    if (!editingZone) return;
    const layer = zoneLayersRef.current[editingZone.zone.id];
    if (layer) {
      layer.pm.disable();
      layer.setLatLngs(editingZone.originalCoords);
    }
    setEditingZone(null);
    showToast('Boundary edits discarded.', 'success');
  };

  // Save edited vertices to backend
  const handleSaveEditedVertices = async () => {
    if (!editingZone) return;
    const layer = zoneLayersRef.current[editingZone.zone.id];
    if (!layer) return;

    setSavingEdit(true);
    try {
      const latlngs = extractLayerCoordinates(layer);
      if (latlngs.length < 3) {
        showToast('A boundary requires at least 3 vertices', 'error');
        setSavingEdit(false);
        return;
      }

      const updatedPolygon = toGeoJsonPolygon(latlngs);

      await apiClient.patch(`/admin/zones/${editingZone.zone.id}`, {
        polygon: updatedPolygon,
      });

      layer.pm.disable();
      setEditingZone(null);
      showToast(`Boundary for "${editingZone.zone.name}" updated successfully!`, 'success');
      fetchZones();
    } catch (err: any) {
      console.error('Failed to update zone boundary:', err);
      const msg = err.response?.data?.error?.message || 'Failed to update boundary. Ensure edges do not self-intersect.';
      showToast(msg, 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  // Toggle active/paused status
  const handleToggleZoneActive = async (zone: ServiceZone) => {
    try {
      const nextActive = !zone.active;
      await apiClient.patch(`/admin/zones/${zone.id}`, { active: nextActive });
      showToast(
        `Zone "${zone.name}" is now ${nextActive ? 'OPERATIONAL' : 'PAUSED'}.`,
        'success'
      );
      fetchZones();
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to update zone status', 'error');
    }
  };

  // Trigger Geoman draw polygon manually via HUD button
  const triggerDrawPolygon = () => {
    const map = mapInstanceRef.current;
    if (map && map.pm) {
      map.pm.enableDraw('Polygon', {
        snappable: true,
        snapDistance: 20,
        allowSelfIntersection: false,
      });
      setIsDrawingModeActive(true);
      showToast('Click anywhere on the map to start placing boundary vertices.', 'success');
    }
  };

  // Trigger Geoman draw rectangle manually via HUD button
  const triggerDrawRectangle = () => {
    const map = mapInstanceRef.current;
    if (map && map.pm) {
      map.pm.enableDraw('Rectangle');
      setIsDrawingModeActive(true);
      showToast('Click and drag on the map to draw a rectangular geofence.', 'success');
    }
  };

  // Reset map view to center Delhi NCR
  const handleResetMapView = () => {
    const map = mapInstanceRef.current;
    if (map) {
      map.setView([28.6139, 77.2090], 11);
      setSelectedZoneId(null);
    }
  };

  // Filtered zones list
  const filteredZones = zones.filter((z) => {
    const matchesQuery =
      z.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (z.code && z.code.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (z.cityCode && z.cityCode.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesQuery) return false;
    if (statusFilter === 'ACTIVE') return z.active;
    if (statusFilter === 'PAUSED') return !z.active;
    return true;
  });

  // Calculate statistics
  const activeCount = zones.filter((z) => z.active).length;
  const pausedCount = zones.filter((z) => !z.active).length;
  const citiesCount = new Set(zones.map((z) => z.cityCode || z.cityName || 'DELHI')).size;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-5 right-5 z-[99999] flex items-center space-x-2.5 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md animate-slideDown ${
            toastMessage.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toastMessage.text}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Geofence Service Zones</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Leaflet Geoman Interactive
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Draw, inspect, and adjust operational municipal boundaries, surge pricing perimeters, and active dispatch hours.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={fetchZones}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 shadow-xs transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={triggerDrawPolygon}
            className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-md shadow-indigo-200"
          >
            <Plus className="h-4 w-4" />
            <span>Draw Polygon Zone</span>
          </button>
        </div>
      </div>

      {/* Metric Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Total Geofences</span>
            <Layers className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{zones.length}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Configured municipal perimeters</div>
        </div>

        <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 mb-1">
            <span className="text-xs font-semibold">Operational Zones</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-800">{activeCount}</div>
          <div className="text-[10px] text-emerald-600/80 mt-0.5">Live for customer bookings</div>
        </div>

        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/60 shadow-xs">
          <div className="flex items-center justify-between text-amber-700 mb-1">
            <span className="text-xs font-semibold">Paused Geofences</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-800">{pausedCount}</div>
          <div className="text-[10px] text-amber-600/80 mt-0.5">Temporarily inactive areas</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Metros Covered</span>
            <Globe className="h-4 w-4 text-sky-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{citiesCount}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Delhi NCR Urban District</div>
        </div>
      </div>

      {/* Main Content Layout: Map & Zones Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Map Canvas (Col 8) */}
        <div className="lg:col-span-8 space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden h-[540px] shadow-xs relative">
            {/* Leaflet container */}
            <div ref={mapContainerRef} className="h-full w-full z-0" />

            {/* Top Right Map HUD Overlay */}
            <div className="absolute top-3 right-3 z-[1000] flex items-center space-x-2 bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-md">
              <button
                onClick={triggerDrawPolygon}
                title="Draw Custom Polygon"
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-white hover:bg-indigo-600 transition"
              >
                <Pentagon className="h-3.5 w-3.5 text-indigo-600" />
                <span className="hidden sm:inline">Polygon</span>
              </button>
              <button
                onClick={triggerDrawRectangle}
                title="Draw Quick Rectangle"
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-white hover:bg-indigo-600 transition"
              >
                <Square className="h-3.5 w-3.5 text-indigo-600" />
                <span className="hidden sm:inline">Rectangle</span>
              </button>
              <button
                onClick={handleResetMapView}
                title="Recenter Map View"
                className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>

            {/* Drawing Mode Guide Badge */}
            {isDrawingModeActive && (
              <div className="absolute top-3 left-16 z-[1000] bg-indigo-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg animate-pulse flex items-center space-x-2 border border-indigo-500">
                <Edit3 className="h-3.5 w-3.5" />
                <span>Drawing Active: Click map to place vertices (Double-click or click first point to close)</span>
              </div>
            )}

            {/* Vertex Editing Mode Floating Action Bar */}
            {editingZone && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[1000] w-[90%] max-w-lg bg-white/95 border border-amber-300 backdrop-blur-xl p-3.5 rounded-2xl shadow-2xl flex items-center justify-between animate-slideUp">
                <div className="flex items-center space-x-2.5">
                  <div className="h-8 w-8 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700">
                    <Edit3 className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      Editing Boundary: {editingZone.zone.name}
                    </h4>
                    <p className="text-[11px] text-amber-700">
                      Drag vertices to reshape. Click midpoint to add vertices.
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleCancelEditing}
                    disabled={savingEdit}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Discard</span>
                  </button>
                  <button
                    onClick={handleSaveEditedVertices}
                    disabled={savingEdit}
                    className="flex items-center space-x-1 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                  >
                    {savingEdit ? (
                      <div className="h-3 w-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span>Save Boundary</span>
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Left Map Legend */}
            <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200 text-[11px] text-slate-700 flex items-center space-x-3 shadow-sm">
              <div className="flex items-center space-x-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-600 ring-2 ring-indigo-200" />
                <span>Operational Zone</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-400 ring-2 ring-slate-200" />
                <span>Paused Zone</span>
              </div>
            </div>
          </div>
        </div>

        {/* Zones Inventory List & Search (Col 4) */}
        <div className="lg:col-span-4 space-y-4 flex flex-col h-[540px]">
          {/* Search & Filter Toolbar */}
          <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by zone name or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 transition"
              />
            </div>

            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
              {(['ALL', 'ACTIVE', 'PAUSED'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  className={`flex-1 py-1 rounded-lg font-semibold text-[11px] transition ${
                    statusFilter === tab
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'ALL' ? 'All Zones' : tab === 'ACTIVE' ? 'Active' : 'Paused'}
                </button>
              ))}
            </div>
          </div>

          {/* Zones Scrollable Deck */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {loading ? (
              <div className="p-6 text-center text-slate-500 text-xs space-y-2">
                <div className="h-5 w-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                <p>Loading service zones from database...</p>
              </div>
            ) : filteredZones.length === 0 ? (
              <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 bg-white text-slate-500 text-xs space-y-3 shadow-xs">
                <MapPin className="h-8 w-8 text-slate-400 mx-auto" />
                <p className="font-semibold text-slate-700">No operational zones found</p>
                <p className="text-[11px] text-slate-400">Use the polygon tool on the map to draw and configure your first boundary.</p>
                <button
                  onClick={triggerDrawPolygon}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1 transition shadow-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Draw Zone</span>
                </button>
              </div>
            ) : (
              filteredZones.map((zone) => {
                const isSelected = selectedZoneId === zone.id;
                const isEditing = editingZone?.zone.id === zone.id;
                const parsedCoords = parseZoneToLeafletCoords(zone.polygon);
                const vertexCount = parsedCoords.length;

                return (
                  <div
                    key={zone.id}
                    className={`p-4 rounded-2xl border transition-all duration-200 space-y-3 shadow-xs ${
                      isEditing
                        ? 'bg-amber-50/60 border-amber-300 ring-1 ring-amber-300'
                        : isSelected
                        ? 'bg-indigo-50/60 border-indigo-300 ring-1 ring-indigo-300'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm tracking-tight flex items-center gap-1.5">
                          {zone.name}
                        </h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="font-mono text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            {zone.code || 'ZONE'}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {zone.cityCode || zone.cityName || 'DELHI'}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          zone.active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {zone.active ? 'OPERATIONAL' : 'PAUSED'}
                      </span>
                    </div>

                    {/* Metadata specs */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 py-1 border-t border-slate-100">
                      <div className="flex items-center space-x-1.5">
                        <Clock className="h-3 w-3 text-slate-400" />
                        <span>
                          {zone.operatingHours?.start && zone.operatingHours?.end
                            ? `${zone.operatingHours.start} - ${zone.operatingHours.end}`
                            : '24/7 Unlimited'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <Layers className="h-3 w-3 text-slate-400" />
                        <span>{vertexCount} vertices</span>
                      </div>
                    </div>

                    {/* Actions Toolbar */}
                    <div className="flex items-center space-x-2 pt-1">
                      <button
                        onClick={() => handleFocusZone(zone)}
                        className="flex-1 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition flex items-center justify-center space-x-1"
                        title="Center map on this zone"
                      >
                        <Eye className="h-3 w-3 text-indigo-600" />
                        <span>Focus</span>
                      </button>

                      <button
                        onClick={() => handleStartEditing(zone)}
                        disabled={isEditing}
                        className={`flex-1 py-1.5 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-1 ${
                          isEditing
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                        title="Edit polygon vertices on map"
                      >
                        <Edit3 className="h-3 w-3 text-amber-600" />
                        <span>{isEditing ? 'Editing...' : 'Vertices'}</span>
                      </button>

                      <button
                        onClick={() => handleToggleZoneActive(zone)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                          zone.active
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                        }`}
                        title={zone.active ? 'Pause zone dispatch' : 'Activate zone dispatch'}
                      >
                        {zone.active ? 'Pause' : 'Activate'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Geofence Zone Creation Modal */}
      <ZoneCreateModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          // If canceled, clean up draft layer
          if (draftLayerRef.current && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(draftLayerRef.current);
            draftLayerRef.current = null;
          }
          setDrawnCoordinates(null);
        }}
        drawnCoordinates={drawnCoordinates}
        onZoneCreated={(newZone) => {
          showToast(`Zone "${newZone.name}" created and saved successfully!`, 'success');
          // Clear draft layer since it will be rendered from backend data
          if (draftLayerRef.current && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(draftLayerRef.current);
            draftLayerRef.current = null;
          }
          setDrawnCoordinates(null);
          fetchZones();
        }}
      />
    </div>
  );
}