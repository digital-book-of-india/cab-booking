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

let cachedPreferences: CustomerPreferences = { ...DEFAULT_PREFERENCES };

export const CustomerService = {
  /**
   * Fetch the customer's full profile from GET /api/v1/customers/me
   * Returns live MongoDB customer and user profile.
   */
  async getProfile(): Promise<CustomerProfile> {
    return apiRequest<CustomerProfile>('customers/me');
  },

  /**
   * Update profile name or email via PATCH /api/v1/customers/me
   */
  async updateProfile(input: UpdateCustomerInput): Promise<CustomerProfile> {
    return apiRequest<CustomerProfile>('customers/me', {
      method: 'PATCH',
      body: input,
    });
  },

  /**
   * List all saved places (home, work, other) via GET /api/v1/customers/me/places
   */
  async listSavedPlaces(): Promise<SavedPlace[]> {
    const res = await apiRequest<SavedPlace[]>('customers/me/places');
    return Array.isArray(res) ? res : [];
  },

  /**
   * Create a new saved place via POST /api/v1/customers/me/places
   */
  async createSavedPlace(input: CreateSavedPlaceInput): Promise<SavedPlace> {
    return apiRequest<SavedPlace>('customers/me/places', {
      method: 'POST',
      body: input,
    });
  },

  /**
   * Update an existing saved place via PATCH /api/v1/customers/me/places/:placeId
   */
  async updateSavedPlace(
    placeId: string,
    input: UpdateSavedPlaceInput,
  ): Promise<SavedPlace> {
    return apiRequest<SavedPlace>(`customers/me/places/${placeId}`, {
      method: 'PATCH',
      body: input,
    });
  },

  /**
   * Delete a saved place via DELETE /api/v1/customers/me/places/:placeId
   */
  async deleteSavedPlace(placeId: string): Promise<{ id?: string; deleted: boolean }> {
    return apiRequest<{ id?: string; deleted: boolean }>(`customers/me/places/${placeId}`, {
      method: 'DELETE',
    });
  },

  /**
   * List saved trusted/emergency contacts via GET /api/v1/me/emergency-contacts
   */
  async listTrustedContacts(): Promise<TrustedContact[]> {
    const res = await apiRequest<TrustedContact[]>('me/emergency-contacts');
    return Array.isArray(res) ? res : [];
  },

  /**
   * Add a new trusted/emergency contact via POST /api/v1/me/emergency-contacts
   */
  async addTrustedContact(input: AddContactInput): Promise<TrustedContact> {
    return apiRequest<TrustedContact>('me/emergency-contacts', {
      method: 'POST',
      body: input,
    });
  },

  /**
   * Remove a saved trusted/emergency contact via DELETE /api/v1/me/emergency-contacts/:contactId
   */
  async deleteTrustedContact(contactId: string): Promise<{ removed: boolean }> {
    return apiRequest<{ removed: boolean }>(`me/emergency-contacts/${contactId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get customer client-side ride preferences (temperature, quiet ride, payment method)
   */
  async getPreferences(): Promise<CustomerPreferences> {
    try {
      const stored = await AppStorage.getItem(PREFERENCES_KEY);
      if (stored) {
        cachedPreferences = { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch {
      // fallback to cached defaults
    }
    return cachedPreferences;
  },

  /**
   * Save customer client-side ride preferences to persistent local storage
   */
  async updatePreferences(prefs: Partial<CustomerPreferences>): Promise<CustomerPreferences> {
    cachedPreferences = { ...cachedPreferences, ...prefs };
    try {
      await AppStorage.setItem(PREFERENCES_KEY, JSON.stringify(cachedPreferences));
    } catch {
      // ignore write error
    }
    return cachedPreferences;
  },
};
