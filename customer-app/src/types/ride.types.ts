export type RideStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'ARRIVING'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type Coordinates = {
  lat: number;
  lng: number;
};

export type RideLocation = {
  address: string;
  lat: number;
  lng: number;
};

export type DriverInfo = {
  id: string;
  name: string;
  phone: string;
  rating?: number;
  vehicle?: {
    make: string;
    model: string;
    color: string;
    plateNumber: string;
  };
};

export type FareBreakdown = {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  waitingFarePaise?: number;
  surgeMultiplier?: number;
  couponDiscountPaise?: number;
  taxPaise: number;
  tipPaise?: number;
  totalFarePaise: number;
};

export type RideHistoryItem = {
  id?: string;
  bookingId: string;
  rideId?: string | null;
  status: RideStatus;
  pickup?: RideLocation;
  dropoff?: RideLocation;
  pickupLabel?: string | null;
  dropLabel?: string | null;
  farePaise?: number;
  estimatedFarePaise?: number;
  finalFarePaise?: number | null;
  driver?: DriverInfo;
  createdAt: string;
  completedAt?: string | null;
  cancelledAt?: string;
};

export type RideDetails = RideHistoryItem & {
  fareBreakdown: FareBreakdown;
  paymentMethod: string;
  paymentStatus: string;
  distanceMeters: number;
  durationSeconds: number;
  pickupOtp?: string;
};

export type RideReceipt = {
  rideId: string;
  receiptNumber: string;
  date: string;
  customerName: string;
  driverName: string;
  vehicleDetails: string;
  pickupAddress: string;
  dropoffAddress: string;
  fareBreakdown: FareBreakdown;
  taxInvoiceNumber?: string;
  gstNumber?: string;
};

export type RideRatingInput = {
  stars: number;
  comment?: string;
  tags?: string[];
};

export type RatingView = {
  id: string;
  rideId: string;
  stars: number;
  comment?: string;
  tags?: string[];
  createdAt: string;
};
