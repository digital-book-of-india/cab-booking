import { useCallback, useEffect, useRef, useState } from 'react';
import { LocationService } from '../services/location.service';
import type { LocationPoint, ServiceabilityResponse } from '../types/location.types';
import type { Coordinates } from '../types/ride.types';
import { formatCoordinatesLabel } from '../utils/polyline';

export type UsePinAdjusterOptions = {
  visible: boolean;
  initialCoords: Coordinates | null;
  checkServiceability?: boolean;
  debounceMs?: number;
};

export function usePinAdjuster({
  visible,
  initialCoords,
  checkServiceability = true,
  debounceMs = 450,
}: UsePinAdjusterOptions) {
  const [coords, setCoords] = useState<Coordinates | null>(initialCoords);
  const [address, setAddress] = useState<string | null>(null);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [serviceability, setServiceability] =
    useState<ServiceabilityResponse | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvePoint = useCallback(
    async (point: Coordinates) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setResolvingAddress(true);
      setAddressError(null);

      try {
        const [revRes, servRes] = await Promise.allSettled([
          LocationService.reverseGeocode(point, controller.signal),
          checkServiceability
            ? LocationService.checkPointServiceability(point, controller.signal)
            : Promise.resolve(null),
        ]);

        if (controller.signal.aborted) return;

        if (revRes.status === 'fulfilled') {
          setAddress(revRes.value);
        } else {
          setAddress(null);
          const err = revRes.reason;
          if (!(err instanceof Error && err.name === 'AbortError')) {
            setAddressError(
              LocationService.getLocationApiErrorMessage(
                err,
                'Could not resolve street address for this pin.',
              ),
            );
          }
        }

        if (servRes.status === 'fulfilled') {
          setServiceability(servRes.value);
        } else {
          setServiceability(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setResolvingAddress(false);
        }
      }
    },
    [checkServiceability],
  );

  // Initialize pin position whenever modal opens
  useEffect(() => {
    if (!visible) {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      return;
    }

    let cancelled = false;

    const init = async () => {
      if (initialCoords) {
        setCoords(initialCoords);
        await resolvePoint(initialCoords);
        return;
      }

      setLocatingGps(true);
      const gps = await LocationService.getCurrentLocation();
      if (cancelled) return;
      setLocatingGps(false);

      if (gps.status === 'OK') {
        setCoords(gps.coords);
        await resolvePoint(gps.coords);
      } else {
        setCoords(null);
        setAddress(null);
        setAddressError(
          gps.status === 'PERMISSION_DENIED'
            ? 'Location permission is required to center the map automatically.'
            : gps.message,
        );
      }
    };

    init();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [visible, initialCoords, resolvePoint]);

  const handleRegionChange = useCallback(
    (nextCoords: Coordinates) => {
      setCoords(nextCoords);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        resolvePoint(nextCoords);
      }, debounceMs);
    },
    [debounceMs, resolvePoint],
  );

  const recenterToCurrentGps = useCallback(async (): Promise<Coordinates | null> => {
    setLocatingGps(true);
    setAddressError(null);
    const gps = await LocationService.getCurrentLocation();
    setLocatingGps(false);

    if (gps.status !== 'OK') {
      setAddressError(
        gps.status === 'PERMISSION_DENIED'
          ? 'Enable location permission to move the pin to your current spot.'
          : gps.message,
      );
      return null;
    }

    setCoords(gps.coords);
    await resolvePoint(gps.coords);
    return gps.coords;
  }, [resolvePoint]);

  const buildConfirmedPoint = useCallback((): LocationPoint | null => {
    if (!coords) return null;
    const label = address?.trim() || formatCoordinatesLabel(coords);
    return {
      lat: coords.lat,
      lng: coords.lng,
      label,
      ...(address?.trim() ? { address: address.trim() } : {}),
    };
  }, [coords, address]);

  return {
    coords,
    address,
    resolvingAddress,
    locatingGps,
    addressError,
    serviceability,
    handleRegionChange,
    recenterToCurrentGps,
    retryResolve: () => {
      if (coords) resolvePoint(coords);
    },
    buildConfirmedPoint,
  };
}
