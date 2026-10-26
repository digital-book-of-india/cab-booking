export type CustomerProfile = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  ratingCount?: number;
  ratingSum?: number;
  ratingAverage?: number;
  bookingRestricted?: boolean;
  bookingRestrictionReason?: string | null;
  createdAt: string;
};

export type UpdateCustomerInput = {
  name?: string;
  email?: string | null;
};

export type SavedPlaceType = 'home' | 'work' | 'other';

export type SavedPlace = {
  id: string;
  customerId: string;
  name: string;
  type: SavedPlaceType;
  address: string;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSavedPlaceInput = {
  name: string;
  type: SavedPlaceType;
  address: string;
  lat: number;
  lng: number;
};

export type UpdateSavedPlaceInput = {
  name?: string;
  type?: SavedPlaceType;
  address?: string;
  lat?: number;
  lng?: number;
};

export type TrustedContact = {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
};

export type AddContactInput = {
  name: string;
  phone: string;
  relationship?: string;
};

export type CustomerPreferences = {
  quietRide: boolean;
  autoShareTrips: boolean;
  temperaturePreference: 'MILD' | 'COOL' | 'NO_PREFERENCE';
  defaultPaymentMethod: 'CASH' | 'WALLET' | 'ONLINE';
};
