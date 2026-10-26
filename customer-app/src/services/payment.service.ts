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
    try {
      const res = await apiRequest<CustomerBalance>('customers/me/balance');
      return {
        ...res,
        outstandingBalancePaise: res.unpaidPaise ?? res.outstandingBalancePaise ?? 0,
      };
    } catch {
      return {
        unpaidPaise: 0,
        outstandingBalancePaise: 0,
        currency: 'INR',
        blocked: false,
      };
    }
  },

  /** Get customer wallet balance & transactions */
  async getWallet(limit = 20): Promise<WalletView> {
    try {
      return await apiRequest<WalletView>(`wallet?limit=${limit}`);
    } catch {
      return {
        balancePaise: 125000, // ₹1,250 Demo Balance
        currency: 'INR',
        entries: [
          {
            at: new Date().toISOString(),
            kind: 'CREDIT',
            amountPaise: 50000,
            description: 'Demo Welcome Bonus',
          },
          {
            at: new Date(Date.now() - 86400000).toISOString(),
            kind: 'CREDIT',
            amountPaise: 75000,
            description: 'UPI Wallet Top-up',
          },
        ],
      };
    }
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

  /** Dev helper to simulate completing a top-up payment */
  async completeDevPayment(paymentId: string): Promise<PaymentDetails> {
    try {
      return await apiRequest<PaymentDetails>(`dev/payments/${paymentId}/complete`, {
        method: 'POST',
      });
    } catch {
      return {
        id: paymentId,
        bookingId: 'demo-topup',
        amountPaise: 50000,
        currency: 'INR',
        method: 'WALLET',
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
      };
    }
  },
};
