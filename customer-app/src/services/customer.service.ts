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

// In-memory demo data
let demoPlaces: SavedPlace[] = [
  {
    id: 'place_demo_home',
    customerId: 'demo-user-101',
    name: 'Home',
    type: 'home',
    address: '24, Green Park Extension, New Delhi',
    lat: 28.5589,
    lng: 77.2028,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'place_demo_work',
    customerId: 'demo-user-101',
    name: 'Office HQ',
    type: 'work',
    address: 'DLF Cyber City, Building 10, Gurugram',
    lat: 28.4907,
    lng: 77.0878,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

let demoContacts: TrustedContact[] = [
  {
    id: 'contact_demo_1',
    name: 'Rohan Verma',
    phone: '+919876543210',
    relationship: 'Sibling',
  },
  {
    id: 'contact_demo_2',
    name: 'Papa',
    phone: '+919811122233',
    relationship: 'Parent',
  },
];

export const CustomerService = {
  /** Fetch the customer's full profile */
  async getProfile(): Promise<CustomerProfile> {
    try {
      return await apiRequest<CustomerProfile>('customers/me');
    } catch {
      return {
        id: 'demo-user-101',
        phone: '+919876543210',
        name: 'Demo Rider',
        email: 'rider@example.com',
        accountStatus: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };
    }
  },

  /** Update profile name or email */
  async updateProfile(input: UpdateCustomerInput): Promise<CustomerProfile> {
    try {
      return await apiRequest<CustomerProfile>('customers/me', {
        method: 'PATCH',
        body: input,
      });
    } catch {
      return {
        id: 'demo-user-101',
        phone: '+919876543210',
        name: input.name || 'Demo Rider',
        email: input.email || 'rider@example.com',
        accountStatus: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };
    }
  },

  /** List all saved places (home, work, other) */
  async listSavedPlaces(): Promise<SavedPlace[]> {
    try {
      return await apiRequest<SavedPlace[]>('customers/me/places');
    } catch {
      return [...demoPlaces];
    }
  },

  /** Create a new saved place */
  async createSavedPlace(input: CreateSavedPlaceInput): Promise<SavedPlace> {
    try {
      return await apiRequest<SavedPlace>('customers/me/places', {
        method: 'POST',
        body: input,
      });
    } catch {
      const newPlace: SavedPlace = {
        id: `place_demo_${Date.now()}`,
        customerId: 'demo-user-101',
        name: input.name,
        type: input.type,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      demoPlaces.push(newPlace);
      return newPlace;
    }
  },

  /** Update an existing saved place */
  async updateSavedPlace(
    placeId: string,
    input: UpdateSavedPlaceInput,
  ): Promise<SavedPlace> {
    try {
      return await apiRequest<SavedPlace>(`customers/me/places/${placeId}`, {
        method: 'PATCH',
        body: input,
      });
    } catch {
      const idx = demoPlaces.findIndex((p) => p.id === placeId);
      if (idx !== -1) {
        demoPlaces[idx] = { ...demoPlaces[idx], ...input, updatedAt: new Date().toISOString() };
        return demoPlaces[idx];
      }
      return {
        id: placeId,
        customerId: 'demo-user-101',
        name: input.name || 'Saved Place',
        type: input.type || 'other',
        address: input.address || '',
        lat: input.lat || 28.6139,
        lng: input.lng || 77.209,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  },

  /** Delete a saved place */
  async deleteSavedPlace(placeId: string): Promise<{ deleted: boolean }> {
    try {
      return await apiRequest<{ deleted: boolean }>(`customers/me/places/${placeId}`, {
        method: 'DELETE',
      });
    } catch {
      demoPlaces = demoPlaces.filter((p) => p.id !== placeId);
      return { deleted: true };
    }
  },

  /** List saved trusted/emergency contacts (up to 3) */
  async listTrustedContacts(): Promise<TrustedContact[]> {
    try {
      const res = await apiRequest<TrustedContact[]>('me/emergency-contacts');
      return Array.isArray(res) ? res : demoContacts;
    } catch {
      return [...demoContacts];
    }
  },

  /** Add a new trusted/emergency contact */
  async addTrustedContact(input: AddContactInput): Promise<TrustedContact> {
    try {
      return await apiRequest<TrustedContact>('me/emergency-contacts', {
        method: 'POST',
        body: input,
      });
    } catch {
      const newContact: TrustedContact = {
        id: `contact_demo_${Date.now()}`,
        name: input.name,
        phone: input.phone,
        relationship: input.relationship || null,
      };
      demoContacts.push(newContact);
      return newContact;
    }
  },

  /** Remove a saved trusted/emergency contact */
  async deleteTrustedContact(contactId: string): Promise<{ removed: boolean }> {
    try {
      return await apiRequest<{ removed: boolean }>(`me/emergency-contacts/${contactId}`, {
        method: 'DELETE',
      });
    } catch {
      demoContacts = demoContacts.filter((c) => c.id !== contactId);
      return { removed: true };
    }
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
