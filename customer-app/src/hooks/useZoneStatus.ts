import { useCallback, useEffect, useRef, useState } from 'react';
import { LocationService } from '../services/location.service';
import type { ServiceabilityResponse } from '../types/location.types';
import type { Coordinates } from '../types/ride.types';

export type ZoneLocationStatus =
  | 'DETECTING'
  | 'OK'
  | 'PERMISSION_DENIED'
  | 'GPS_UNAVAILABLE'
  | 'CHECK_FAILED';

export type ZoneStatusState = {
  loading: boolean;
  coords: Coordinates | null;
  resolvedAddress: string | null;
  locationStatus: ZoneLocationStatus;
  serviceability: ServiceabilityResponse | null;
  errorMessage: string | null;
  refreshZone: () => Promise<void>;
};

export function useZoneStatus(): ZoneStatusState {
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] =
    useState<ZoneLocationStatus>('DETECTING');
  const [serviceability, setServiceability] =
    useState<ServiceabilityResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const refreshZone = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setLocationStatus('DETECTING');
    setErrorMessage(null);

    const locResult = await LocationService.getCurrentLocation();
    if (controller.signal.aborted) {
      return;
    }

    if (locResult.status === 'PERMISSION_DENIED') {
      setCoords(null);
      setResolvedAddress(null);
      setServiceability(null);
      setLocationStatus('PERMISSION_DENIED');
      setLoading(false);
      return;
    }

    if (locResult.status === 'UNAVAILABLE') {
      setCoords(null);
      setResolvedAddress(null);
      setServiceability(null);
      setLocationStatus('GPS_UNAVAILABLE');
      setErrorMessage(locResult.message);
      setLoading(false);
      return;
    }

    setCoords(locResult.coords);

    // Non-blocking reverse geocode for a human-readable pickup label
    LocationService.reverseGeocode(locResult.coords, controller.signal)
      .then((addr) => {
        if (!controller.signal.aborted) {
          setResolvedAddress(addr);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResolvedAddress(null);
        }
      });

    try {
      const res = await LocationService.checkPointServiceability(
        locResult.coords,
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      setServiceability(res);
      setLocationStatus('OK');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (controller.signal.aborted) {
        return;
      }
      setServiceability(null);
      setLocationStatus('CHECK_FAILED');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to check service availability right now.',
      );
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshZone();
    return () => {
      abortRef.current?.abort();
    };
  }, [refreshZone]);

  return {
    loading,
    coords,
    resolvedAddress,
    locationStatus,
    serviceability,
    errorMessage,
    refreshZone,
  };
}
