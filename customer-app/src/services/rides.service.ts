import { apiRequest } from './api';
import type {
  RatingView,
  RideDetails,
  RideHistoryItem,
  RideRatingInput,
  RideReceipt,
} from '../types/ride.types';

export const RidesService = {
  /** Fetch the customer's ride history */
  async getHistory(): Promise<RideHistoryItem[]> {
    const res = await apiRequest<RideHistoryItem[] | { items: RideHistoryItem[] }>('customers/me/rides');
    if (Array.isArray(res)) return res;
    if (res && typeof res === 'object' && 'items' in res && Array.isArray(res.items)) return res.items;
    return [];
  },

  /** Get detailed information about a specific ride */
  async getRide(rideId: string): Promise<RideDetails> {
    return apiRequest<RideDetails>(`rides/${rideId}`);
  },

  /** Get an official receipt for a completed ride */
  async getReceipt(rideId: string): Promise<RideReceipt> {
    return apiRequest<RideReceipt>(`rides/${rideId}/receipt`);
  },

  /** Submit rating and feedback for a completed ride */
  async rateRide(rideId: string, input: RideRatingInput): Promise<RatingView> {
    return apiRequest<RatingView>(`rides/${rideId}/rating`, {
      method: 'POST',
      body: input,
    });
  },

  /** Fetch rating submitted for a ride */
  async getRideRating(rideId: string): Promise<RatingView | null> {
    try {
      return await apiRequest<RatingView>(`rides/${rideId}/rating`);
    } catch {
      return null;
    }
  },

  /** Get the pickup OTP for an ongoing ride */
  async getPickupOtp(rideId: string): Promise<{ otp: string }> {
    return apiRequest<{ otp: string }>(`rides/${rideId}/pickup-otp`);
  },

  /** Resend pickup OTP SMS to the customer */
  async resendPickupOtp(rideId: string): Promise<{ sent: boolean }> {
    return apiRequest<{ sent: boolean }>(`rides/${rideId}/otp/resend`, {
      method: 'POST',
    });
  },

  /** Get preview of cancellation fee/policy before cancelling */
  async getCancelPreview(bookingId: string): Promise<{ feePaise: number; reasonRequired: boolean }> {
    return apiRequest<{ feePaise: number; reasonRequired: boolean }>(`bookings/${bookingId}/cancel-preview`);
  },

  /** Cancel a booking / ride */
  async cancelBooking(bookingId: string, reason?: string): Promise<{ cancelled: boolean }> {
    return apiRequest<{ cancelled: boolean }>(`bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: { reason },
    });
  },
};
