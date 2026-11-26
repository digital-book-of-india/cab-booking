import { ApiError, apiRequest } from './api';
import type { LocationPoint } from '../types/location.types';
import type {
  CreateQuoteInput,
  FareQuote,
  PaymentPreference,
  QuotePointInput,
} from '../types/quotes.types';

export const MAX_QUOTE_STOPS = 3;

export type ParsedQuoteError = {
  message: string;
  code?: string;
  field?: string;
  isCouponError: boolean;
  isAuthError: boolean;
  isNotServiceable: boolean;
  isExpiredOrUsed: boolean;
  isRateLimited: boolean;
};

export const QuotesService = {
  /** Convert a frontend LocationPoint into the strict backend QuotePointInput shape. */
  toQuotePoint(point: LocationPoint): QuotePointInput {
    const trimmedLabel = point.label?.trim();
    return {
      lat: point.lat,
      lng: point.lng,
      ...(trimmedLabel ? { label: trimmedLabel.slice(0, 200) } : {}),
    };
  },

  /** Map UI payment mode to backend quote paymentPreference. */
  toPaymentPreference(mode: 'WALLET' | 'CASH' | 'UPI'): PaymentPreference {
    return mode === 'CASH' ? 'CASH' : 'ONLINE';
  },

  /** Format integer paise using the quote currency. */
  formatPaise(
    paise: number,
    currency = 'INR',
    options: { showDecimals?: boolean } = {},
  ): string {
    const amount = Number.isFinite(paise) ? paise / 100 : 0;
    const symbol = currency === 'INR' ? '₹' : `${currency} `;
    const hasFraction = Math.abs(paise % 100) !== 0;
    const showDecimals = options.showDecimals ?? hasFraction;
    const formatted = showDecimals
      ? amount.toFixed(2)
      : Math.round(amount).toLocaleString('en-IN');
    return `${symbol}${formatted}`;
  },

  /** Create a priced, expiring, single-use fare quote on the server. */
  async createQuote(
    input: CreateQuoteInput,
    signal?: AbortSignal,
  ): Promise<FareQuote> {
    return apiRequest<FareQuote>('fare-quotes', {
      method: 'POST',
      body: input,
      ...(signal ? { signal } : {}),
    });
  },

  /** Retrieve an existing quote owned by the signed-in customer. */
  async getQuote(quoteId: string, signal?: AbortSignal): Promise<FareQuote> {
    return apiRequest<FareQuote>(`fare-quotes/${encodeURIComponent(quoteId)}`, {
      ...(signal ? { signal } : {}),
    });
  },

  /** Re-price an existing quote (e.g., after expiry) as a fresh active quote. */
  async refreshQuote(quoteId: string, signal?: AbortSignal): Promise<FareQuote> {
    return apiRequest<FareQuote>(
      `fare-quotes/${encodeURIComponent(quoteId)}/refresh`,
      {
        method: 'POST',
        ...(signal ? { signal } : {}),
      },
    );
  },

  /** Extract structured backend error info without guessing client-side rules. */
  parseError(
    err: unknown,
    fallback = 'Could not calculate fare right now. Please try again.',
  ): ParsedQuoteError {
    if (err instanceof ApiError) {
      const firstField = err.fieldErrors[0];
      const field = firstField?.field;
      const isCouponError = field === 'couponCode';
      const isAuthError = err.status === 401;
      const isNotServiceable = err.code === 'NOT_SERVICEABLE';
      const isExpiredOrUsed =
        err.code === 'QUOTE_EXPIRED' || err.code === 'QUOTE_ALREADY_USED';
      const isRateLimited = err.code === 'RATE_LIMITED' || err.status === 429;

      let message = firstField?.message || err.message || fallback;
      if (isAuthError) {
        message = 'Sign in to view live fare quotes.';
      } else if (isRateLimited) {
        message = 'Too many quote requests. Please wait a moment and try again.';
      } else if (err.code === 'QUOTE_EXPIRED') {
        message = 'This fare quote has expired. Tap refresh for an updated price.';
      } else if (err.code === 'QUOTE_ALREADY_USED') {
        message = 'This fare quote has already been used for a booking.';
      } else if (err.code === 'PROVIDER_ERROR') {
        message = 'Could not compute the route right now. Please try again.';
      }

      return {
        message,
        code: err.code,
        field,
        isCouponError,
        isAuthError,
        isNotServiceable,
        isExpiredOrUsed,
        isRateLimited,
      };
    }

    return {
      message: err instanceof Error ? err.message : fallback,
      isCouponError: false,
      isAuthError: false,
      isNotServiceable: false,
      isExpiredOrUsed: false,
      isRateLimited: false,
    };
  },
};
