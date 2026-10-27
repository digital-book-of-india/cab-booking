'use client';

import React, { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { GeoJsonPolygon } from '@/types';
import {
  X,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  Layers,
  Sparkles,
} from 'lucide-react';

interface ZoneCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  drawnCoordinates: { lat: number; lng: number }[] | null;
  onZoneCreated: (newZone: Record<string, unknown>) => void;
}

export function toGeoJsonPolygon(latlngs: { lat: number; lng: number }[]): GeoJsonPolygon {
  if (latlngs.length < 3) {
    throw new Error('A polygon requires at least 3 vertices');
  }

  // GeoJSON uses [lng, lat] order
  const ring: [number, number][] = latlngs.map((pt) => [
    Number(pt.lng.toFixed(6)),
    Number(pt.lat.toFixed(6)),
  ]);

  // Ensure closed ring (first point === last point)
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  if (ring.length < 4) {
    throw new Error('A closed polygon ring must contain at least 4 coordinate pairs');
  }

  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

export default function ZoneCreateModal({
  isOpen,
  onClose,
  drawnCoordinates,
  onZoneCreated,
}: ZoneCreateModalProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [cityCode, setCityCode] = useState('DELHI');
  const [is24Hours, setIs24Hours] = useState(true);
  const [operatingHoursStart, setOperatingHoursStart] = useState('00:00');
  const [operatingHoursEnd, setOperatingHoursEnd] = useState('23:59');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoCodeEnabled, setAutoCodeEnabled] = useState(true);

  // Auto-generate code when name changes (if user hasn't typed manually)
  const handleNameChange = (val: string) => {
    setName(val);
    if (autoCodeEnabled) {
      const generated = val
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 28);
      setCode(generated);
    }
  };

  const handleCodeChange = (val: string) => {
    setAutoCodeEnabled(false);
    setCode(val.toUpperCase().replace(/[^A-Z0-9_]/g, ''));
  };

  // Reset modal on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setName('');
        setCode('');
        setCityCode('DELHI');
        setIs24Hours(true);
        setOperatingHoursStart('00:00');
        setOperatingHoursEnd('23:59');
        setActive(true);
        setError(null);
        setAutoCodeEnabled(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please provide a descriptive zone name.');
      return;
    }

    if (!code.trim() || code.length < 2) {
      setError('Zone code must be at least 2 characters (alphanumeric and underscores only).');
      return;
    }

    if (!cityCode.trim() || cityCode.length < 2) {
      setError('City code is required (e.g. DELHI).');
      return;
    }

    if (!drawnCoordinates || drawnCoordinates.length < 3) {
      setError('A valid drawn boundary with at least 3 vertices is required.');
      return;
    }

    let polygonGeoJson: GeoJsonPolygon;
    try {
      polygonGeoJson = toGeoJsonPolygon(drawnCoordinates);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Invalid boundary coordinates.');
      return;
    }

    setSubmitting(true);
    try {
      interface ZonePayload {
        code: string;
        name: string;
        cityCode: string;
        polygon: GeoJsonPolygon;
        active: boolean;
        operatingHours?: {
          start: string;
          end: string;
        };
      }

      const payload: ZonePayload = {
        code: code.trim(),
        name: name.trim(),
        cityCode: cityCode.trim().toUpperCase(),
        polygon: polygonGeoJson,
        active,
      };

      if (!is24Hours) {
        payload.operatingHours = {
          start: operatingHoursStart,
          end: operatingHoursEnd,
        };
      } else {
        payload.operatingHours = {
          start: '00:00',
          end: '23:59',
        };
      }

      const res = await apiClient.post('/admin/zones', payload);
      const created = res.data?.data || res.data;
      onZoneCreated(created);
      onClose();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string; fieldErrors?: Array<{ field: string; message: string }> } } }; message?: string };
      const fieldErrors = apiErr.response?.data?.error?.fieldErrors;
      if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
        setError(fieldErrors.map((f) => `${f.field}: ${f.message}`).join(', '));
      } else {
        setError(apiErr.response?.data?.error?.message || apiErr.message || 'Failed to save geofence zone');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const vertexCount = drawnCoordinates ? drawnCoordinates.length : 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                Configure Geofence Zone
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {vertexCount} Vertices
                </span>
              </h2>
              <p className="text-xs text-slate-500">Save your newly drawn polygon as an active service boundary.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Coordinates Chip Summary */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-600">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-indigo-600" /> Boundary Polygon Geometry
              </span>
              <span className="text-[11px] font-mono text-emerald-700 font-semibold">GeoJSON Closed Ring</span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono truncate">
              {drawnCoordinates && drawnCoordinates.length > 0
                ? drawnCoordinates
                    .slice(0, 3)
                    .map((pt) => `[${pt.lng.toFixed(4)}, ${pt.lat.toFixed(4)}]`)
                    .join(' → ') + (drawnCoordinates.length > 3 ? ` ... (+${drawnCoordinates.length - 3} more)` : '')
                : 'No vertices captured'}
            </p>
          </div>

          {/* Zone Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Zone Name *
            </label>
            <input
              type="text"
              placeholder="e.g. South Delhi Suburbs"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition"
              required
            />
          </div>

          {/* Zone Code & City Code Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>Unique Code *</span>
                {autoCodeEnabled && (
                  <span className="text-[10px] text-indigo-600 font-normal flex items-center gap-0.5">
                    <Sparkles className="h-2.5 w-2.5" /> Auto
                  </span>
                )}
              </label>
              <input
                type="text"
                placeholder="e.g. DELHI_SOUTH"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-mono text-indigo-700 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 uppercase transition"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                City Code *
              </label>
              <input
                type="text"
                placeholder="e.g. DELHI"
                value={cityCode}
                onChange={(e) => setCityCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 uppercase transition"
                required
              />
            </div>
          </div>

          {/* Operating Hours */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-500" /> Operational Hours
              </label>
              <button
                type="button"
                onClick={() => {
                  setIs24Hours(!is24Hours);
                  if (!is24Hours) {
                    setOperatingHoursStart('00:00');
                    setOperatingHoursEnd('23:59');
                  }
                }}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded transition ${
                  is24Hours
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                {is24Hours ? '✓ 24/7 Unlimited' : 'Custom Window'}
              </button>
            </div>

            {!is24Hours && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-[11px] text-slate-500 block mb-1">Start Time (IST)</span>
                  <input
                    type="time"
                    value={operatingHoursStart}
                    onChange={(e) => setOperatingHoursStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block mb-1">End Time (IST)</span>
                  <input
                    type="time"
                    value={operatingHoursEnd}
                    onChange={(e) => setOperatingHoursEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Active Status Switch */}
          <div className="pt-2 flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <span className="text-xs font-semibold text-slate-900 block">Immediate Operational State</span>
              <span className="text-[11px] text-slate-500">
                {active ? 'Eligible for instant driver dispatch & ride bookings' : 'Zone paused upon creation'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActive(!active)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                active ? 'bg-indigo-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  active ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow-md shadow-indigo-200 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <div className="h-3.5 w-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>Saving Geofence...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Save Operational Zone</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
