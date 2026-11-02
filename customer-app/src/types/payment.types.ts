export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUNDED'
  | 'DISPUTED';

export type PaymentMethod = 'CASH' | 'RAZORPAY' | 'WALLET' | 'CORPORATE';

export type CustomerBalance = {
  currency: string;
  unpaidPaise: number;
  outstandingBalancePaise?: number;
  blocked?: boolean;
  items?: {
    bookingId: string;
    amountPaise: number;
    purpose: string;
    paymentStatus: string;
    overdue: boolean;
    payable: boolean;
  }[];
};

export type LedgerKind =
  | 'WALLET_TOPUP'
  | 'WALLET_PAYMENT'
  | 'WALLET_BONUS'
  | 'REFUND'
  | 'TIP_PAYMENT'
  | string;

export type WalletEntry = {
  id?: string;
  amountPaise: number;
  type?: 'CREDIT' | 'DEBIT';
  kind?: LedgerKind;
  description?: string | null;
  createdAt?: string;
  at?: string | Date;
  bookingId?: string | null;
  referenceId?: string;
};

export type WalletLimits = {
  minTopupPaise: number;
  maxTopupPaise: number;
  maxBalancePaise: number;
};

export type WalletView = {
  balancePaise: number;
  currency: string;
  limits?: WalletLimits;
  entries: WalletEntry[];
};

export type StartPaymentResponse = {
  paymentId: string;
  amountPaise: number;
  currency: string;
  orderId?: string;
  keyId?: string;
  method?: string;
  status?: string;
  checkout?: {
    key: string;
    orderId: string;
    amountPaise: number;
  } | null;
};

export type VerifyPaymentInput = {
  paymentId: string;
  providerPaymentId?: string;
  providerSignature?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
};

export type PaymentDetails = {
  id: string;
  bookingId?: string | null;
  amountPaise: number;
  currency: string;
  status: PaymentStatus | string;
  method: PaymentMethod | string;
  createdAt: string | Date;
  completedAt?: string | Date;
};

export type WalletStats = {
  totalAddedPaise: number;
  ridePaymentsPaise: number;
};

export type EnrichedWalletView = WalletView & {
  stats: WalletStats;
};

export type SavedPaymentMethodType = 'UPI' | 'CARD';

export interface SavedPaymentMethod {
  id: string;
  type: SavedPaymentMethodType;
  upiId?: string;
  card?: {
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    cardholderName?: string;
  };
  isDefault: boolean;
  createdAt?: string;
}

export type RefundStatus = 'REQUESTED' | 'PROCESSED' | 'FAILED';
export type RefundDestination = 'ORIGINAL' | 'WALLET';

export interface RefundRecord {
  id: string;
  publicId: string;
  bookingPublicId?: string;
  paymentPublicId?: string;
  amountPaise: number;
  reason: string;
  status: RefundStatus;
  destination: RefundDestination;
  expectedDate?: string;
  createdAt: string;
  processedAt?: string;
}

export interface FailedPaymentRecord {
  id: string;
  publicId: string;
  bookingPublicId?: string;
  amountPaise: number;
  purpose: string;
  failureReason: string;
  createdAt: string;
}

export interface WalletRewardItem {
  id: string;
  title: string;
  description: string;
  amountPaise: number;
  type: 'CASHBACK' | 'REFERRAL' | 'COUPON';
  code?: string;
  expiresAt?: string;
  terms?: string[];
}
