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

export type WalletEntry = {
  id?: string;
  amountPaise: number;
  type?: 'CREDIT' | 'DEBIT';
  kind?: string;
  description?: string | null;
  createdAt?: string;
  at?: string | Date;
  bookingId?: string | null;
  referenceId?: string;
};

export type WalletView = {
  balancePaise: number;
  currency: string;
  entries: WalletEntry[];
};

export type StartPaymentResponse = {
  paymentId: string;
  amountPaise: number;
  currency: string;
  orderId?: string;
  keyId?: string;
  method?: string;
};

export type VerifyPaymentInput = {
  paymentId: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
};

export type PaymentDetails = {
  id: string;
  bookingId?: string;
  amountPaise: number;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: string;
  completedAt?: string;
};
