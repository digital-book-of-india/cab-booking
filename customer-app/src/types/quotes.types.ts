import type { LocationPoint } from './location.types';

export type QuoteStatus = 'ACTIVE' | 'USED' | 'EXPIRED';

export type QuoteTripKind = 'CITY' | 'RENTAL' | 'OUTSTATION';

export type OutstationTripType = 'ONE_WAY' | 'ROUND_TRIP';

export type PaymentPreference = 'CASH' | 'ONLINE';

export type QuotePointInput = {
  lat: number;
  lng: number;
  label?: string;
};

export type QuotePointView = {
  lat: number;
  lng: number;
  label: string | null;
};

export type OutstationQuoteInput = {
  tripType: OutstationTripType;
  returnAt?: string;
};

export type CreateQuoteInput = {
  pickup: QuotePointInput;
  drop?: QuotePointInput;
  stops?: QuotePointInput[];
  categoryId: string;
  paymentPreference?: PaymentPreference;
  couponCode?: string | null;
  scheduledFor?: string;
  rentalPackageId?: string;
  outstation?: OutstationQuoteInput;
};

export type FareBreakdown = {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  waitingFarePaise: number;
  tollEstimatePaise: number;
  demandAdjustmentPaise: number;
  discountPaise: number;
  taxPaise: number;
  minimumFareAdjustmentPaise: number;
  roundingAdjustmentPaise: number;
  estimatedTotalPaise: number;
};

export type AppliedQuoteCoupon = {
  code: string;
  discountPaise: number;
};

export type RentalQuoteSnapshot = {
  packageId: string;
  name: string;
  hours: number;
  includedKm: number;
  pricePaise: number;
  extraKmPaise: number;
  extraHourPaise: number;
};

export type OutstationQuoteSnapshot = {
  tripType: OutstationTripType;
  returnAt: string | null;
  days: number;
  nights: number;
  routeMeters: number;
  estimatedKm: number;
  perKmPaise: number;
};

export type FareQuote = {
  quoteId: string;
  status: QuoteStatus;
  currency: string;
  categoryId: string;
  pickup: QuotePointView;
  drop: QuotePointView;
  stops: QuotePointView[];
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
  breakdown: FareBreakdown;
  coupon: AppliedQuoteCoupon | null;
  estimatedPayablePaise: number;
  scheduledFor: string | null;
  tripKind: QuoteTripKind;
  rental: RentalQuoteSnapshot | null;
  outstation: OutstationQuoteSnapshot | null;
  configVersion: number;
  expiresAt: string;
};

export type QuoteDraftPoint = LocationPoint;
