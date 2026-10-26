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
    try {
      const res = await apiRequest<RideHistoryItem[] | { items: RideHistoryItem[] }>('customers/me/rides');
      if (Array.isArray(res)) return res;
      if (res && typeof res === 'object' && 'items' in res && Array.isArray(res.items)) return res.items;
      return [];
    } catch {
      return [
        {
          id: 'ride_demo_1',
          bookingId: 'book_demo_1',
          status: 'COMPLETED',
          pickupLabel: 'Connaught Place, Central Delhi',
          dropLabel: 'Terminal 3, IGI Airport, New Delhi',
          farePaise: 48000,
          driver: {
            id: 'd1',
            name: 'Vikram Singh',
            phone: '+919811223344',
            vehicle: { make: 'Maruti', model: 'Dzire', color: 'White', plateNumber: 'DL1CAB1234' },
          },
          createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
          completedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        },
        {
          id: 'ride_demo_2',
          bookingId: 'book_demo_2',
          status: 'COMPLETED',
          pickupLabel: 'Sector 29, Gurugram',
          dropLabel: 'Cyber Hub, Building 8, Gurugram',
          farePaise: 16000,
          driver: {
            id: 'd2',
            name: 'Rajesh Kumar',
            phone: '+919877665544',
            vehicle: { make: 'Hyundai', model: 'Aura', color: 'Silver', plateNumber: 'HR26AB5678' },
          },
          createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
          completedAt: new Date(Date.now() - 86400000 * 2 + 1800000).toISOString(),
        },
      ];
    }
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
