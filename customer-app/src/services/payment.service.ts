import { apiRequest } from './api';
import type {
  CustomerBalance,
  PaymentDetails,
  StartPaymentResponse,
  VerifyPaymentInput,
  WalletView,
} from '../types/payment.types';

export const PaymentService = {
  /** Get customer's outstanding balance / dues */
  async getBalance(): Promise<CustomerBalance> {
    const res = await apiRequest<CustomerBalance>('customers/me/balance');
    return {
      ...res,
      outstandingBalancePaise: res.unpaidPaise ?? res.outstandingBalancePaise ?? 0,
    };
  },

  /** Get customer wallet balance & transactions */
  async getWallet(limit = 20): Promise<WalletView> {
    return apiRequest<WalletView>(`wallet?limit=${limit}`);
  },

  /** Initiate wallet top-up payment */
  async topupWallet(amountPaise: number): Promise<StartPaymentResponse> {
    const idempotencyKey = `topup_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return apiRequest<StartPaymentResponse>('wallet/topups', {
      method: 'POST',
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: { amountPaise },
    });
  },

  /** Pay for a ride booking using wallet balance */
  async payFromWallet(bookingId: string): Promise<PaymentDetails> {
    const idempotencyKey = `wpay_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return apiRequest<PaymentDetails>(`bookings/${bookingId}/pay-from-wallet`, {
      method: 'POST',
      headers: {
        'idempotency-key': idempotencyKey,
      },
    });
  },

  /** Start an online payment (e.g. Razorpay) for a booking */
  async startBookingPayment(bookingId: string): Promise<StartPaymentResponse> {
    const idempotencyKey = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return apiRequest<StartPaymentResponse>(`bookings/${bookingId}/payments`, {
      method: 'POST',
      headers: {
        'idempotency-key': idempotencyKey,
      },
    });
  },

  /** Verify payment signature or confirmation */
  async verifyPayment(input: VerifyPaymentInput): Promise<PaymentDetails> {
    return apiRequest<PaymentDetails>('payments/verify', {
      method: 'POST',
      body: input,
    });
  },

  /** Fetch status and details of a payment */
  async getPayment(paymentId: string): Promise<PaymentDetails> {
    return apiRequest<PaymentDetails>(`payments/${paymentId}`);
  },

  /** Complete payment in dev / test mode */
  async completeDevPayment(paymentId: string): Promise<PaymentDetails> {
    return apiRequest<PaymentDetails>(`dev/payments/${paymentId}/complete`, {
      method: 'POST',
    });
  },
};
