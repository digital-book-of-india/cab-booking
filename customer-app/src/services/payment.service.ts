import { apiRequest } from './api';
import { AppStorage } from './storage';
import type {
  CustomerBalance,
  EnrichedWalletView,
  FailedPaymentRecord,
  PaymentDetails,
  RefundRecord,
  SavedPaymentMethod,
  StartPaymentResponse,
  VerifyPaymentInput,
  WalletEntry,
  WalletRewardItem,
  WalletView,
} from '../types/payment.types';

const PAYMENT_METHODS_STORAGE_KEY = 'cab_saved_payment_methods';

export const PaymentService = {
  /** Get customer outstanding balance / dues */
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

  /** Get customer wallet balance & transactions with computed stats from live ledger */
  async getWallet(limit = 30): Promise<EnrichedWalletView> {
    let baseWallet: WalletView;
    try {
      baseWallet = await apiRequest<WalletView>(`wallet?limit=${limit}`);
    } catch {
      baseWallet = {
        balancePaise: 0,
        currency: 'INR',
        limits: {
          minTopupPaise: 5000,
          maxTopupPaise: 500000,
          maxBalancePaise: 1000000,
        },
        entries: [],
      };
    }

    const entries = Array.isArray(baseWallet.entries) ? baseWallet.entries : [];

    // Dynamically calculate total added (credits) and ride payments (debits) from ledger entries
    const totalAddedPaise = entries
      .filter((e) => e.amountPaise > 0 || e.type === 'CREDIT')
      .reduce((sum, e) => sum + Math.abs(e.amountPaise), 0);

    const ridePaymentsPaise = entries
      .filter((e) => e.amountPaise < 0 || e.kind === 'WALLET_PAYMENT' || e.bookingId)
      .reduce((sum, e) => sum + Math.abs(e.amountPaise), 0);

    return {
      ...baseWallet,
      entries,
      stats: {
        totalAddedPaise,
        ridePaymentsPaise,
      },
    };
  },

  /** Initiate wallet top-up payment order */
  async topupWallet(amountPaise: number): Promise<StartPaymentResponse> {
    const idempotencyKey = `topup_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return await apiRequest<StartPaymentResponse>('wallet/topups', {
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
    return await apiRequest<PaymentDetails>(`bookings/${bookingId}/pay-from-wallet`, {
      method: 'POST',
      headers: {
        'idempotency-key': idempotencyKey,
      },
    });
  },

  /** Start an online payment for a booking */
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
    return await apiRequest<PaymentDetails>('payments/verify', {
      method: 'POST',
      body: {
        paymentId: input.paymentId,
        providerPaymentId: input.providerPaymentId || input.razorpayPaymentId || '',
        providerSignature: input.providerSignature || input.razorpaySignature || '',
      },
    });
  },

  /** Dev helper to simulate completing a top-up or ride payment */
  async completeDevPayment(paymentId: string): Promise<PaymentDetails> {
    return await apiRequest<PaymentDetails>(`dev/payments/${paymentId}/complete`, {
      method: 'POST',
    });
  },

  /** Get saved payment methods (stored securely in app storage) */
  async getPaymentMethods(): Promise<SavedPaymentMethod[]> {
    try {
      const stored = await AppStorage.getItem(PAYMENT_METHODS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  },

  /** Add a new payment method to storage */
  async addPaymentMethod(
    input: Omit<SavedPaymentMethod, 'id' | 'createdAt'>,
  ): Promise<SavedPaymentMethod> {
    const current = await this.getPaymentMethods();
    const newMethod: SavedPaymentMethod = {
      ...input,
      id: `pm_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    if (newMethod.isDefault) {
      current.forEach((m) => (m.isDefault = false));
    }

    const updated = [newMethod, ...current];
    try {
      await AppStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
    return newMethod;
  },

  /** Set default payment method */
  async setDefaultPaymentMethod(id: string): Promise<void> {
    const current = await this.getPaymentMethods();
    current.forEach((m) => {
      m.isDefault = m.id === id;
    });
    try {
      await AppStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // ignore
    }
  },

  /** Remove saved payment method */
  async deletePaymentMethod(id: string): Promise<void> {
    const current = await this.getPaymentMethods();
    const updated = current.filter((m) => m.id !== id);
    try {
      await AppStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  },

  /** Get customer refunds from live wallet ledger entries */
  async getRefunds(entries?: WalletEntry[]): Promise<RefundRecord[]> {
    const list = entries ?? (await this.getWallet(50)).entries;
    const refundEntries = list.filter((e) => e.kind === 'REFUND');
    return refundEntries.map((e, idx) => ({
      id: `ref_${e.bookingId || idx}_${Date.now()}`,
      publicId: e.bookingId ? `ref_${e.bookingId}` : `ref_${idx}`,
      bookingPublicId: e.bookingId ?? undefined,
      amountPaise: Math.abs(e.amountPaise),
      reason: e.description || 'Wallet Refund Credit',
      status: 'PROCESSED',
      destination: 'WALLET',
      createdAt: typeof e.at === 'string' ? e.at : (e.at ? new Date(e.at).toISOString() : new Date().toISOString()),
      processedAt: typeof e.at === 'string' ? e.at : (e.at ? new Date(e.at).toISOString() : new Date().toISOString()),
    }));
  },

  /** Get failed payments */
  async getFailedPayments(): Promise<FailedPaymentRecord[]> {
    return [];
  },

  /** Get customer cashback & wallet rewards from referral backend & bonus ledger */
  async getRewards(entries?: WalletEntry[]): Promise<WalletRewardItem[]> {
    const rewards: WalletRewardItem[] = [];

    // 1. Referral Program from backend
    try {
      const referral = await apiRequest<{
        referralCode?: string;
        code?: string;
        rewardAmountPaise?: number;
      }>('customers/me/referrals');
      const code = referral?.code || referral?.referralCode;
      if (code) {
        rewards.push({
          id: 'rew_referral',
          title: 'Refer & Earn',
          description: 'Share your referral code with friends to earn wallet rewards on their first completed ride',
          amountPaise: referral?.rewardAmountPaise ?? 5000,
          type: 'REFERRAL',
          code,
          terms: ['Bonus is credited automatically after your friend takes their first ride'],
        });
      }
    } catch {
      // referrals route might not have profile yet or disabled
    }

    // 2. Wallet topup bonuses from ledger entries
    const list = entries ?? (await this.getWallet(50)).entries;
    const bonusEntries = list.filter((e) => e.kind === 'WALLET_BONUS');
    bonusEntries.forEach((b, idx) => {
      rewards.push({
        id: `rew_bonus_${idx}`,
        title: 'Top-up Bonus Cashback',
        description: b.description || 'Promotional cashback credited to your wallet balance',
        amountPaise: Math.abs(b.amountPaise),
        type: 'CASHBACK',
        terms: ['Applied automatically to discount upcoming ride fares'],
      });
    });

    return rewards;
  },
};
