import * as Location from "expo-location";
import { Platform } from "react-native";
import { ApiError, apiRequest } from "./api";
import type {
  AutocompleteResponse,
  CabCategory,
  CurrentLocationResult,
  NotServiceableReason,
  OutstationOptionsResponse,
  PlaceDetails,
  PlaceSuggestion,
  RentalPackagesNearResponse,
  ReverseGeocodeResponse,
  RouteEstimate,
  ServiceabilityResponse,
  ServiceabilitySideLabel,
} from "../types/location.types";
import type { Coordinates } from "../types/ride.types";

export const LocationService = {
  async checkServiceability(
    pickup: Coordinates,
    drop: Coordinates = pickup,
    signal?: AbortSignal
  ): Promise<ServiceabilityResponse> {
    const params = new URLSearchParams({
      pickupLat: String(pickup.lat),
      pickupLng: String(pickup.lng),
      dropLat: String(drop.lat),
      dropLng: String(drop.lng),
    });

    return apiRequest<ServiceabilityResponse>(
      `serviceability?${params.toString()}`,
      {
        skipAuth: true,
        ...(signal ? { signal } : {}),
      }
    );
  },

  async checkPointServiceability(
    point: Coordinates,
    signal?: AbortSignal
  ): Promise<ServiceabilityResponse> {
    return LocationService.checkServiceability(point, point, signal);
  },

  async getCabCategories(signal?: AbortSignal): Promise<CabCategory[]> {
    return apiRequest<CabCategory[]>("cab-categories", {
      skipAuth: true,
      ...(signal ? { signal } : {}),
    });
  },

  async getRentalPackagesNear(
    point: Coordinates,
    categoryId?: string,
    signal?: AbortSignal
  ): Promise<RentalPackagesNearResponse> {
    const params = new URLSearchParams({
      lat: String(point.lat),
      lng: String(point.lng),
      ...(categoryId ? { categoryId } : {}),
    });
    return apiRequest<RentalPackagesNearResponse>(
      `rental-packages?${params.toString()}`,
      {
        ...(signal ? { signal } : {}),
      }
    );
  },

  createSearchSessionToken(): string {
    const rand = Math.random().toString(36).slice(2, 12);
    const ts = Date.now().toString(36);
    return `loc_${ts}_${rand}`.slice(0, 40);
  },

  async autocompletePlaces(
    input: string,
    options: { sessionToken?: string; near?: Coordinates } = {},
    signal?: AbortSignal
  ): Promise<PlaceSuggestion[]> {
    const trimmed = input.trim();
    if (!trimmed) return [];

    const body: {
      input: string;
      sessionToken?: string;
      near?: Coordinates;
    } = {
      input: trimmed,
      ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
      ...(options.near
        ? { near: { lat: options.near.lat, lng: options.near.lng } }
        : {}),
    };

    const res = await apiRequest<AutocompleteResponse>("locations/autocomplete", {
      method: "POST",
      body,
      timeoutMs: 12000,
      ...(signal ? { signal } : {}),
    });

    return Array.isArray(res?.suggestions) ? res.suggestions : [];
  },

  async getPlaceDetails(
    placeId: string,
    sessionToken?: string,
    signal?: AbortSignal
  ): Promise<PlaceDetails> {
    return apiRequest<PlaceDetails>("locations/place", {
      method: "POST",
      body: {
        placeId,
        ...(sessionToken ? { sessionToken } : {}),
      },
      timeoutMs: 12000,
      ...(signal ? { signal } : {}),
    });
  },

  async reverseGeocode(
    point: Coordinates,
    signal?: AbortSignal
  ): Promise<string | null> {
    const res = await apiRequest<ReverseGeocodeResponse>(
      "locations/reverse-geocode",
      {
        method: "POST",
        body: { lat: point.lat, lng: point.lng },
        timeoutMs: 12000,
        ...(signal ? { signal } : {}),
      }
    );
    return res?.address ?? null;
  },

  async estimateRoute(
    origin: Coordinates,
    destination: Coordinates,
    signal?: AbortSignal
  ): Promise<RouteEstimate> {
    return apiRequest<RouteEstimate>("routes/estimate", {
      method: "POST",
      body: {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
      },
      timeoutMs: 12000,
      ...(signal ? { signal } : {}),
    });
  },

  async getOutstationOptions(
    point: Coordinates,
    signal?: AbortSignal
  ): Promise<OutstationOptionsResponse> {
    const params = new URLSearchParams({
      lat: String(point.lat),
      lng: String(point.lng),
    });
    return apiRequest<OutstationOptionsResponse>(
      `outstation/options?${params.toString()}`,
      {
        ...(signal ? { signal } : {}),
      }
    );
  },

  async getCurrentLocation(): Promise<CurrentLocationResult> {
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      let status = existing.status;

      if (status !== Location.PermissionStatus.GRANTED) {
        const requested = await Location.requestForegroundPermissionsAsync();
        status = requested.status;
      }

      if (status !== Location.PermissionStatus.GRANTED) {
        return { status: "PERMISSION_DENIED" };
      }

      if (Platform.OS !== "web") {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          return {
            status: "UNAVAILABLE",
            message: "Location services are turned off on this device.",
          };
        }
      }

      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        return {
          status: "OK",
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
        };
      } catch (currentErr) {
        if (Platform.OS !== "web") {
          const lastKnown = await Location.getLastKnownPositionAsync();
          if (lastKnown) {
            return {
              status: "OK",
              coords: {
                lat: lastKnown.coords.latitude,
                lng: lastKnown.coords.longitude,
              },
            };
          }
        }
        throw currentErr;
      }
    } catch (err) {
      return {
        status: "UNAVAILABLE",
        message:
          err instanceof Error
            ? err.message
            : "Unable to determine your current location.",
      };
    }
  },

  isNotServiceableError(error: unknown): error is ApiError {
    return error instanceof ApiError && error.code === "NOT_SERVICEABLE";
  },

  getNotServiceableMessage(
    reason: NotServiceableReason,
    side: ServiceabilitySideLabel = "trip",
    zoneName?: string
  ): string {
    if (reason === "OUTSIDE_OPERATING_HOURS") {
      return zoneName
        ? `Service in ${zoneName} is currently closed for these hours.`
        : "Service is currently closed at this hour.";
    }

    if (side === "pickup") {
      return "Pickup location is outside our service area.";
    }
    if (side === "drop") {
      return "Drop-off location is outside our service area.";
    }
    return "We don't operate in this area yet.";
  },

  getLocationApiErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
      if (err.code === "RATE_LIMITED") {
        return "Too many location requests. Please wait a moment and try again.";
      }
      if (err.code === "PROVIDER_ERROR") {
        return "Maps service is temporarily unavailable. Please try again.";
      }
      if (err.code === "NOT_FOUND") {
        return "That place could not be found. Try another result or pick on the map.";
      }
      if (err.code === "UNPROCESSABLE") {
        return err.message || "These two locations cannot be routed together.";
      }
      if (err.status === 401) {
        return "Please sign in to search locations and preview routes.";
      }
      return err.message || fallback;
    }
    return err instanceof Error ? err.message : fallback;
  },
};
