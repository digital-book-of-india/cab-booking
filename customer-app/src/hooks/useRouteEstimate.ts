import { useEffect, useState } from 'react';
import { LocationService } from '../services/location.service';
import type {
  LocationPoint,
  RouteEstimate,
  TripMode,
} from '../types/location.types';

export type UseRouteEstimateParams = {
  enabled?: boolean;
  pickupPoint: LocationPoint | null;
  dropPoint: LocationPoint | null;
  tripMode: TripMode;
  reloadTick?: number;
};

type RouteState = {
  key: string;
  estimate: RouteEstimate | null;
  error: string | null;
  loading: boolean;
};

export function useRouteEstimate({
  enabled = true,
  pickupPoint,
  dropPoint,
  tripMode,
  reloadTick = 0,
}: UseRouteEstimateParams) {
  const requestKey =
    enabled && tripMode !== 'RENTAL' && pickupPoint && dropPoint
      ? `${pickupPoint.lat},${pickupPoint.lng}>${dropPoint.lat},${dropPoint.lng}:${reloadTick}`
      : null;

  const [state, setState] = useState<RouteState | null>(null);

  useEffect(() => {
    if (!requestKey || !pickupPoint || !dropPoint) {
      return;
    }

    const controller = new AbortController();

    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setState({
          key: requestKey,
          estimate: null,
          error: null,
          loading: true,
        });
      }
    });

    LocationService.estimateRoute(pickupPoint, dropPoint, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setState({
            key: requestKey,
            estimate: res,
            error: null,
            loading: false,
          });
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setState({
            key: requestKey,
            estimate: null,
            error: LocationService.getLocationApiErrorMessage(
              err,
              'Could not estimate route between pickup and drop-off.',
            ),
            loading: false,
          });
        }
      });

    return () => controller.abort();
  }, [requestKey, pickupPoint, dropPoint]);

  const active = requestKey && state?.key === requestKey ? state : null;

  return {
    routeEstimate: active?.estimate ?? null,
    routeLoading: requestKey ? (active ? active.loading : true) : false,
    routeError: active?.error ?? null,
  };
}
