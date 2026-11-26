import type { Coordinates } from './ride.types';

export type NotServiceableReason =
  | 'OUTSIDE_SERVICE_AREA'
  | 'OUTSIDE_OPERATING_HOURS';

export type ServiceabilitySide =
  | {
      serviceable: true;
      zoneId: string;
      zoneName: string;
    }
  | {
      serviceable: false;
      reason: NotServiceableReason;
    };

export type ServiceableCategory = {
  categoryId: string;
  code: string;
  name: string;
  available: boolean;
};

export type ServiceabilityResponse = {
  serviceable: boolean;
  pickup: ServiceabilitySide;
  drop: ServiceabilitySide;
  categories: ServiceableCategory[];
};

export type CabCategory = {
  id: string;
  code: string;
  name: string;
  capacity: number;
  displayOrder: number;
  active: boolean;
};

export type CurrentLocationResult =
  | {
      status: 'OK';
      coords: Coordinates;
    }
  | {
      status: 'PERMISSION_DENIED';
    }
  | {
      status: 'UNAVAILABLE';
      message: string;
    };

export type ServiceabilitySideLabel = 'pickup' | 'drop' | 'trip';

export type LocationPoint = Coordinates & {
  label: string;
  address?: string;
  placeId?: string;
};

export type PlaceSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export type AutocompleteResponse = {
  suggestions: PlaceSuggestion[];
};

export type PlaceDetails = {
  point: Coordinates;
  address: string;
  name: string;
};

export type ReverseGeocodeResponse = {
  address: string | null;
};

export type RouteEstimate = {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string | null;
};

export type TripMode = 'CITY' | 'RENTAL' | 'OUTSTATION';

export type RentalPackageItem = {
  packageId: string;
  zoneId: string;
  categoryId: string;
  name: string;
  hours: number;
  includedKm: number;
  pricePaise: number;
  extraKmPaise: number;
  extraHourPaise: number;
  active: boolean;
};

export type RentalPackagesNearResponse = {
  zoneId: string | null;
  packages: RentalPackageItem[];
};

export type OutstationOptionItem = {
  rateId: string;
  zoneId: string;
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  oneWayPerKmPaise: number;
  roundTripPerKmPaise: number;
  minKmPerDay: number;
  driverAllowancePerNightPaise: number;
  minimumFarePaise: number;
  minKm: number;
  maxKm: number;
  active: boolean;
};

export type OutstationOptionsResponse = {
  zoneId: string | null;
  options: OutstationOptionItem[];
};
