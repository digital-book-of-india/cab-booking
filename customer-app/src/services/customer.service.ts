import { apiRequest } from './api';
import { AppStorage } from './storage';
import type {
  AddContactInput,
  CreateSavedPlaceInput,
  CustomerPreferences,
  CustomerProfile,
  SavedPlace,
  TrustedContact,
  UpdateCustomerInput,
  UpdateSavedPlaceInput,
} from '../types/customer.types';

const PREFERENCES_KEY = 'customer_app_preferences';

const DEFAULT_PREFERENCES: CustomerPreferences = {
  quietRide: false,
  autoShareTrips: false,
  temperaturePreference: 'MILD',
  defaultPaymentMethod: 'WALLET',
};

// In-memory preferences fallback
let cachedPreferences: CustomerPreferences = { ...DEFAULT_PREFERENCES };

export const CustomerService = {
  /** Fetch the customer's full profile */
  async getProfile(): Promise<CustomerProfile> {
    return apiRequest<CustomerProfile>('customers/me');
  },

  /** Update profile name or email */
  async updateProfile(input: UpdateCustomerInput): Promise<CustomerProfile> {
    return apiRequest<CustomerProfile>('customers/me', {
      method: 'PATCH',
      body: input,
    });
  },

  /** List all saved places (home, work, other) */
  async listSavedPlaces(): Promise<SavedPlace[]> {
    return apiRequest<SavedPlace[]>('customers/me/places');
  },

  /** Create a new saved place */
  async createSavedPlace(input: CreateSavedPlaceInput): Promise<SavedPlace> {
    return apiRequest<SavedPlace>('customers/me/places', {
      method: 'POST',
      body: input,
    });
  },

  /** Update an existing saved place */
  async updateSavedPlace(
    placeId: string,
    input: UpdateSavedPlaceInput,
  ): Promise<SavedPlace> {
    return apiRequest<SavedPlace>(`customers/me/places/${placeId}`, {
      method: 'PATCH',
      body: input,
    });
  },

  /** Delete a saved place */
  async deleteSavedPlace(placeId: string): Promise<{ deleted: boolean }> {
    return apiRequest<{ deleted: boolean }>(`customers/me/places/${placeId}`, {
      method: 'DELETE',
    });
  },

  /** List saved trusted/emergency contacts (up to 3) */
  async listTrustedContacts(): Promise<TrustedContact[]> {
    const res = await apiRequest<TrustedContact[]>('me/emergency-contacts');
    return Array.isArray(res) ? res : [];
  },

  /** Add a new trusted/emergency contact */
  async addTrustedContact(input: AddContactInput): Promise<TrustedContact> {
    return apiRequest<TrustedContact>('me/emergency-contacts', {
      method: 'POST',
      body: input,
    });
  },

  /** Remove a saved trusted/emergency contact */
  async deleteTrustedContact(contactId: string): Promise<{ removed: boolean }> {
    return apiRequest<{ removed: boolean }>(`me/emergency-contacts/${contactId}`, {
      method: 'DELETE',
    });
  },

  /** Get customer preferences (ride, safety, payment) */
  async getPreferences(): Promise<CustomerPreferences> {
    try {
      const stored = await AppStorage.getItem(PREFERENCES_KEY);
      if (stored) {
        cachedPreferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return cachedPreferences;
  },

  /** Save customer preferences */
  async updatePreferences(prefs: Partial<CustomerPreferences>): Promise<CustomerPreferences> {
    cachedPreferences = { ...cachedPreferences, ...prefs };
    try {
      await AppStorage.setItem(PREFERENCES_KEY, JSON.stringify(cachedPreferences));
    } catch {
      // ignore
    }
    return cachedPreferences;
  },
};
