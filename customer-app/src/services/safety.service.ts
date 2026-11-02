import { API_CONFIG } from '../constants/config';
import { apiRequest } from './api';
import type { RideHistoryItem } from '../types/ride.types';

export interface SafetyIncidentView {
  incidentId: string;
  bookingId: string;
  rideId: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  note?: string | null;
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  outcome?: string | null;
  replayed?: boolean;
}

export interface ShareTripResponse {
  token: string;
  path: string;
}

const LIVE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'];

export const SafetyService = {
  /**
   * Generate a secure shareable tracking token for an active ride.
   * Calls POST /api/v1/rides/:rideId/share
   */
  async shareTrip(rideId: string): Promise<ShareTripResponse> {
    return await apiRequest<ShareTripResponse>(`rides/${rideId}/share`, {
      method: 'POST',
    });
  },

  /**
   * Stop/revoke all active tracking links for a ride.
   * Calls DELETE /api/v1/rides/:rideId/share
   */
  async stopSharing(rideId: string): Promise<{ revoked: number }> {
    return await apiRequest<{ revoked: number }>(`rides/${rideId}/share`, {
      method: 'DELETE',
    });
  },

  /**
   * Trigger an emergency SOS alert for an active ride.
   * Freezes snapshot, alerts Ops desk via WebSocket, and SMSs emergency contacts with tracking link.
   * Calls POST /api/v1/rides/:rideId/sos
   */
  async triggerSos(rideId: string, note?: string): Promise<SafetyIncidentView> {
    return await apiRequest<SafetyIncidentView>(`rides/${rideId}/sos`, {
      method: 'POST',
      body: { note: note || 'Emergency alert triggered by rider' },
    });
  },

  /**
   * Get active/recent SOS incidents for a ride.
   * Calls GET /api/v1/rides/:rideId/sos
   */
  async getActiveSos(rideId: string): Promise<SafetyIncidentView[]> {
    try {
      const res = await apiRequest<SafetyIncidentView[]>(`rides/${rideId}/sos`);
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  },

  /**
   * Helper to find any active/ongoing ride for the current customer.
   * Returns the ride or null if none is currently live.
   */
  async findLiveRide(): Promise<RideHistoryItem | null> {
    try {
      const res = await apiRequest<RideHistoryItem[] | { items: RideHistoryItem[] }>('customers/me/rides');
      const items = Array.isArray(res) ? res : (res && 'items' in res && Array.isArray(res.items)) ? res.items : [];
      const live = items.find((r) => LIVE_STATUSES.includes(r.status));
      return live || null;
    } catch {
      return null;
    }
  },

  /**
   * Helper to format a full public tracking URL from a token
   */
  getPublicTrackingUrl(token: string): string {
    return `${API_CONFIG.baseURL}/public/trips/${token}`;
  },
};
