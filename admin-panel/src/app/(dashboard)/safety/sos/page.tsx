'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getSocketClient } from '@/lib/socket-client';
import { formatToIST } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import {
  ShieldAlert,
  Volume2,
  VolumeX,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  User,
  Car,
  X,
  Radio,
} from 'lucide-react';


interface SosLocation {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  speedKmph?: number;
  recordedAt?: string;
}

interface SosNote {
  text?: string;
  at?: string;
  noteId?: string;
  id?: string;
  authorName?: string;
  authorRole?: string;
  content: string;
  createdAt: string;
}

interface SosIncident {
  bookingId?: string;
  triggeredAt?: string;
  data?: unknown;
  id: string;
  incidentId?: string;
  rideId?: string;
  source?: 'RIDER' | 'DRIVER';
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';
  priority?: 'HIGH' | 'CRITICAL';
  createdAt: string;
  currentLat?: number;
  currentLng?: number;
  notes?: SosNote[];
  snapshot?: {
    riderName?: string;
    riderPhone?: string;
    riderPhoneMasked?: string;
    driverName?: string;
    driverPhone?: string;
    driverPhoneMasked?: string;
    vehiclePlate?: string;
    driverCurrentLocation?: SosLocation;
  };
  resolution?: {
    resolvedAt?: string;
    outcome?: string;
    notes?: string;
  };
}

type WindowWithWebKitAudio = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const RESOLUTION_OUTCOMES = [
  { code: 'ASSISTED', label: 'Assisted by Safety Desk & Operations' },
  { code: 'FALSE_ALARM', label: 'False Alarm (Accidentally Triggered)' },
  { code: 'POLICE_INFORMED', label: 'Local Law Enforcement / Police Dispatched' },
  { code: 'OTHER', label: 'Other Operational Resolution' },
];

export default function SosConsolePage() {
  const queryClient = useQueryClient();

  // Selected incident & drawer
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [activeEmergencyAlert, setActiveEmergencyAlert] = useState<SosIncident | null>(null);

  // Audio & Alarm states
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isBuzzerActive, setIsBuzzerActive] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);

  // Note & Resolution form states
  const [noteText, setNoteText] = useState('');
  const [resolutionOutcome, setResolutionOutcome] = useState(RESOLUTION_OUTCOMES[0].code);
  const [resolutionNote, setResolutionNote] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Web Audio Context refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const buzzerIntervalRef = useRef<number | null>(null);
  const seenIncidentsRef = useRef<Set<string>>(new Set());

  // Leaflet map container refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import('leaflet').Map | null>(null);
  const markerRef = useRef<import('leaflet').Marker | null>(null);

  // Stop buzzer sound
  const stopBuzzer = useCallback(() => {
    if (buzzerIntervalRef.current) {
      clearInterval(buzzerIntervalRef.current);
      buzzerIntervalRef.current = null;
    }
    setIsBuzzerActive(false);
    setScreenFlash(false);
  }, []);

  // Play alarm sound loop
  const triggerBuzzer = useCallback(() => {
    setIsBuzzerActive(true);
    setScreenFlash(true);

    if (!isAudioEnabled) return;

    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as WindowWithWebKitAudio).webkitAudioContext;
        if (AudioCtx) audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current?.resume();
      }

      if (buzzerIntervalRef.current) return; // avoid duplicate loops

      const beep = () => {
        if (!audioCtxRef.current || audioCtxRef.current.state !== 'running') return;
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      };

      beep();
      buzzerIntervalRef.current = window.setInterval(beep, 600);
    } catch (err) {
      console.warn('Audio playback restricted:', err);
    }
  }, [isAudioEnabled]);

  // Enable Audio user gesture
  const enableAudio = () => {
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as WindowWithWebKitAudio).webkitAudioContext;
        if (AudioCtx) audioCtxRef.current = new AudioCtx();
      }
      audioCtxRef.current?.resume();
      setIsAudioEnabled(true);
      if (isBuzzerActive) {
        triggerBuzzer();
      }
    } catch {
      setIsAudioEnabled(true);
    }
  };

  // Fetch open incidents list from backend
  const { data: incidentsData, refetch, isFetching } = useQuery({
    queryKey: ['admin-incidents'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/incidents?status=OPEN');
        return Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.data?.items)
            ? res.data.data.items
            : [];
      } catch (err: unknown) {
        // Fallback to /admin/sos if legacy path used
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.get('/admin/sos');
          return res.data?.data || [];
        }
        throw err;
      }
    },
    refetchInterval: 10000, // Poll every 10s as safety backup
  });

  const incidents: SosIncident[] = incidentsData || [];
  const activeSelectedIncidentId = selectedIncidentId || (incidents.length > 0 ? (incidents[0].incidentId || incidents[0].id) : null);

  // Fetch single incident details
  const { data: incidentDetailData, refetch: refetchDetail } = useQuery({
    queryKey: ['admin-incident-detail', selectedIncidentId],
    queryFn: async () => {
      if (!selectedIncidentId) return null;
      try {
        const res = await apiClient.get(`/admin/incidents/${activeSelectedIncidentId}`);
        return res.data?.data || res.data;
      } catch (err: unknown) {
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.get(`/admin/sos/${selectedIncidentId}`);
          return res.data?.data || res.data;
        }
        return null;
      }
    },
    enabled: !!activeSelectedIncidentId,
  });

  const currentIncident = incidentDetailData || incidents.find((i) => (i.incidentId || i.id) === selectedIncidentId);

  // Poll live driver location while incident is open
  const { data: liveLocationData } = useQuery({
    queryKey: ['admin-incident-location', selectedIncidentId],
    queryFn: async () => {
      if (!selectedIncidentId) return null;
      try {
        const res = await apiClient.get(`/admin/incidents/${selectedIncidentId}/location`);
        return res.data?.data || res.data;
      } catch {
        return null;
      }
    },
    enabled: !!selectedIncidentId && currentIncident?.status === 'OPEN',
    refetchInterval: 4000,
  });

  // Socket setup: Listen for 'ops:sos' and 'safety.sos.created'
  useEffect(() => {
    let socket: ReturnType<typeof getSocketClient> | null = null;
    try {
      socket = getSocketClient();

      const handleSosEvent = (eventData: SosIncident) => {
        const payload: SosIncident = (eventData?.data as SosIncident) || eventData;
        const incidentId = payload?.incidentId || payload?.id;

        // Duplicate event check
        if (incidentId && seenIncidentsRef.current.has(incidentId)) {
          return;
        }
        if (incidentId) {
          seenIncidentsRef.current.add(incidentId);
        }

        // Trigger visible alarm and buzzer
        triggerBuzzer();
        setActiveEmergencyAlert(payload);
        queryClient.invalidateQueries({ queryKey: ['admin-incidents'] });

        if (incidentId) {
          setSelectedIncidentId(incidentId);
        }
      };

      // Listen on all backend and notification SOS event names
      socket.on('ops:sos', handleSosEvent);
      socket.on('safety.sos.created', handleSosEvent);
      socket.on('safety.sos', handleSosEvent);
    } catch (err) {
      console.warn('Socket connection error in SOS desk:', err);
    }

    return () => {
      if (socket) {
        socket.off('ops:sos');
        socket.off('safety.sos.created');
        socket.off('safety.sos');
      }
      stopBuzzer();
    };
  }, [triggerBuzzer, stopBuzzer, queryClient]);



  // Leaflet map initialization
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    const lat = liveLocationData?.currentLat || currentIncident?.snapshot?.driverCurrentLocation?.lat || currentIncident?.currentLat || 28.6139;
    const lng = liveLocationData?.currentLng || currentIncident?.snapshot?.driverCurrentLocation?.lng || currentIncident?.currentLng || 77.2090;

    import('leaflet').then((L) => {
      if (!mapInstanceRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current).setView([lat, lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
        }).addTo(map);
        mapInstanceRef.current = map;
      }

      const map = mapInstanceRef.current;
      if (!map) return;

      map.setView([lat, lng]);

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        const marker = L.marker([lat, lng]).addTo(map);
        marker.bindPopup('<strong>EMERGENCY INCIDENT ACTIVE</strong><br/>Live Driver Position');
        markerRef.current = marker;
      }
    });
  }, [currentIncident, liveLocationData]);

  // Acknowledge Mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async (incidentId: string) => {
      const res = await apiClient.post(`/admin/incidents/${incidentId}/acknowledge`);
      return res.data;
    },
    onSuccess: () => {
      stopBuzzer();
      queryClient.invalidateQueries({ queryKey: ['admin-incidents'] });
      refetchDetail();
      setFeedback({ type: 'success', message: 'Alert acknowledged. Safety response assigned to ops desk.' });
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to acknowledge alert.' });
    },
  });

  // Add Note Mutation
  const noteMutation = useMutation({
    mutationFn: async ({ incidentId, text }: { incidentId: string; text: string }) => {
      const res = await apiClient.post(`/admin/incidents/${incidentId}/notes`, { text });
      return res.data;
    },
    onSuccess: () => {
      refetchDetail();
      setNoteText('');
      setFeedback({ type: 'success', message: 'Note logged to incident timeline.' });
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to add note.' });
    },
  });

  // Resolve Mutation
  const resolveMutation = useMutation({
    mutationFn: async ({
      incidentId,
      outcome,
      note,
    }: {
      incidentId: string;
      outcome: string;
      note: string;
    }) => {
      try {
        const res = await apiClient.post(`/admin/incidents/${incidentId}/resolve`, {
          outcome,
          note,
        });
        return res.data;
      } catch (err: unknown) {
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.post(`/admin/sos/${incidentId}/resolve`, {
            resolutionCategory: outcome,
            resolutionSummary: note,
          });
          return res.data;
        }
        throw err;
      }
    },
    onSuccess: () => {
      stopBuzzer();
      queryClient.invalidateQueries({ queryKey: ['admin-incidents'] });
      setSelectedIncidentId(null);
      setResolutionNote('');
      setFeedback({ type: 'success', message: 'Emergency incident resolved and closed.' });
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to resolve incident.' });
    },
  });

  return (
    <div className={`space-y-6 transition-colors duration-300 ${screenFlash ? 'ring-8 ring-rose-500 ring-inset bg-rose-50/20' : ''}`}>
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-rose-100 text-rose-600 rounded-lg">
            <ShieldAlert className={`h-6 w-6 ${isBuzzerActive ? 'animate-bounce text-rose-700' : 'animate-pulse'}`} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center space-x-2">
              <span>Realtime Safety & SOS Emergency Desk</span>
              {incidents.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-rose-600 text-white font-mono animate-pulse">
                  {incidents.length} ACTIVE
                </span>
              )}
            </h1>
            <p className="text-xs text-rose-700 font-medium">
              Mission Control Command for high-priority in-trip passenger and driver SOS alerts.
            </p>
          </div>
        </div>

        {/* Audio Buzzer Controls */}
        <div className="flex items-center space-x-2">
          {!isAudioEnabled ? (
            <button
              onClick={enableAudio}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold shadow-xs transition"
            >
              <Volume2 className="h-3.5 w-3.5" />
              <span>Enable Siren Audio</span>
            </button>
          ) : isBuzzerActive ? (
            <button
              onClick={stopBuzzer}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs transition animate-pulse"
            >
              <VolumeX className="h-3.5 w-3.5" />
              <span>Silence Alarm Buzzer</span>
            </button>
          ) : (
            <div className="flex items-center space-x-1 text-emerald-700 text-xs font-medium px-2 py-1 bg-emerald-50 rounded-lg border border-emerald-200">
              <Radio className="h-3.5 w-3.5 text-emerald-600 animate-pulse" />
              <span>Audio Buzzer Armed</span>
            </div>
          )}

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center space-x-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Emergency Drawer Notification */}
      {activeEmergencyAlert && (
        <div className="p-4 bg-rose-600 text-white rounded-xl shadow-xl flex items-center justify-between animate-pulse">
          <div className="flex items-center space-x-3">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <div>
              <h4 className="font-bold text-sm">CRITICAL SOS TRIGGERED: Incident #{activeEmergencyAlert.incidentId || activeEmergencyAlert.id}</h4>
              <p className="text-xs text-rose-100">
                Booking ID: {activeEmergencyAlert.bookingId || 'Active Trip'} • Emergency contacts notified.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setSelectedIncidentId(activeEmergencyAlert.incidentId || activeEmergencyAlert.id);
                setActiveEmergencyAlert(null);
              }}
              className="px-3 py-1 bg-white text-rose-700 font-bold rounded-lg text-xs hover:bg-rose-50"
            >
              Open Incident
            </button>
            <button
              onClick={() => setActiveEmergencyAlert(null)}
              className="text-rose-200 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Main Grid: Incident Queue, Live Map, and Resolution Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map & Live Tracking */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden h-[420px] shadow-xs relative">
            <div ref={mapContainerRef} className="h-full w-full" />
            {liveLocationData && (
              <div className="absolute bottom-3 left-3 z-[1000] bg-white/90 backdrop-blur-xs p-2.5 rounded-lg border border-slate-200 text-[11px] shadow-md font-mono">
                <span className="font-semibold text-slate-800 block">Live Driver Coordinates:</span>
                {liveLocationData.currentLat?.toFixed(5)}, {liveLocationData.currentLng?.toFixed(5)}
              </div>
            )}
          </div>

          {/* Incidents Queue Carousel */}
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
              Active Alerts Queue ({incidents.length})
            </h3>
            {incidents.length === 0 ? (
              <p className="text-slate-400 text-xs py-2">Zero active emergencies currently reported.</p>
            ) : (
              <div className="flex space-x-3 overflow-x-auto pb-2">
                {incidents.map((inc) => {
                  const id = inc.incidentId || inc.id;
                  const isSelected = selectedIncidentId === id;
                  return (
                    <div
                      key={id}
                      onClick={() => setSelectedIncidentId(id)}
                      className={`p-3 rounded-xl border cursor-pointer min-w-[220px] transition shrink-0 ${
                        isSelected
                          ? 'border-rose-600 bg-rose-50/60 shadow-xs'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-mono font-bold text-rose-700">#{id}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                          {inc.status || 'OPEN'}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 mt-1 truncate">
                        Booking {inc.bookingId || 'Active'}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {formatToIST(inc.createdAt || inc.triggeredAt || '')}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Selected Incident Command Drawer */}
        <div className="space-y-4">
          {currentIncident ? (
            <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4 text-xs text-slate-700">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-rose-600 text-sm">
                    Emergency Alert #{currentIncident.incidentId || currentIncident.id}
                  </h3>
                  <p className="text-slate-500 mt-0.5">
                    Triggered: {formatToIST(currentIncident.createdAt || currentIncident.triggeredAt)}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                  {currentIncident.status || 'OPEN'}
                </span>
              </div>

              {/* Rider & Driver Snapshots */}
              <div className="space-y-2 border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-slate-400" />
                  <span>
                    Passenger:{' '}
                    <strong className="text-slate-900">
                      {currentIncident.customerName || currentIncident.snapshot?.rider?.name || 'Customer'}
                    </strong>{' '}
                    ({currentIncident.customerPhoneMasked || currentIncident.snapshot?.rider?.phone || '+91 ••••• •••••'})
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Car className="h-4 w-4 text-slate-400" />
                  <span>
                    Driver Partner:{' '}
                    <strong className="text-slate-900">
                      {currentIncident.driverName || currentIncident.snapshot?.driverUser?.name || 'Driver'}
                    </strong>
                  </span>
                </div>
                {currentIncident.note && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px]">
                    <span className="font-semibold block">Rider Note:</span>
                    {currentIncident.note}
                  </div>
                )}
              </div>

              {/* Action: Acknowledge */}
              {currentIncident.status === 'OPEN' && (
                <button
                  onClick={() => acknowledgeMutation.mutate(currentIncident.incidentId || currentIncident.id)}
                  disabled={acknowledgeMutation.isPending}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition"
                >
                  {acknowledgeMutation.isPending ? 'Acknowledging...' : 'Acknowledge Emergency'}
                </button>
              )}

              {/* Timeline Notes */}
              <div className="space-y-2 border-b border-slate-100 pb-3">
                <span className="font-semibold text-slate-800 block">Operational Notes & Log:</span>
                <div className="max-h-28 overflow-y-auto space-y-1.5">
                  {(currentIncident.notes || []).map((n: SosNote, idx: number) => (
                    <div key={idx} className="p-2 bg-slate-50 rounded text-[11px] text-slate-600">
                      <p>{n.text}</p>
                      <span className="text-[10px] text-slate-400">{formatToIST(n.at || n.createdAt || '')}</span>
                    </div>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!noteText.trim()) return;
                    noteMutation.mutate({
                      incidentId: currentIncident.incidentId || currentIncident.id,
                      text: noteText.trim(),
                    });
                  }}
                  className="flex space-x-2 mt-2"
                >
                  <input
                    type="text"
                    placeholder="Add operational note..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:border-indigo-600"
                  />
                  <button
                    type="submit"
                    disabled={noteMutation.isPending || !noteText.trim()}
                    className="px-3 py-1.5 bg-slate-800 text-white rounded-lg font-semibold hover:bg-slate-900 disabled:opacity-50"
                  >
                    Log
                  </button>
                </form>
              </div>

              {/* Resolution Form */}
              {currentIncident.status !== 'RESOLVED' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    resolveMutation.mutate({
                      incidentId: currentIncident.incidentId || currentIncident.id,
                      outcome: resolutionOutcome,
                      note: resolutionNote,
                    });
                  }}
                  className="space-y-3 pt-1"
                >
                  <div>
                    <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                      Resolution Outcome
                    </label>
                    <select
                      value={resolutionOutcome}
                      onChange={(e) => setResolutionOutcome(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                    >
                      {RESOLUTION_OUTCOMES.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                      Resolution Summary
                    </label>
                    <textarea
                      rows={2}
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                      placeholder="Summary of actions and safety verification..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={resolveMutation.isPending}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition disabled:opacity-60"
                  >
                    {resolveMutation.isPending ? 'Resolving...' : 'Confirm Resolution & Close Alert'}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-400 rounded-xl border border-slate-200 bg-white flex flex-col items-center justify-center h-full min-h-[300px]">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
              <p className="font-semibold text-slate-700">All Clear</p>
              <span className="text-xs text-slate-400 mt-1">
                Zero active emergency SOS alerts requiring immediate ops desk intervention.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
