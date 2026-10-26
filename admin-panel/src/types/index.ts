export type Role =
  | 'CUSTOMER'
  | 'DRIVER'
  | 'OPS'
  | 'SUPPORT'
  | 'FINANCE'
  | 'SAFETY_ADMIN'
  | 'CONFIG_ADMIN'
  | 'SUPER_ADMIN';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
export type DriverApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type DriverOnlineStatus = 'ONLINE' | 'OFFLINE';
export type VehicleVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export type RideStatus =
  | 'REQUESTED'
  | 'DISPATCHING'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVING'
  | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_DRIVER_FOUND'
  | 'NO_SHOW'
  | 'INCIDENT_REVIEW';

export type PaymentStatus =
  | 'NOT_DUE'
  | 'DUE'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'PARTIALLY_PAID'
  | 'DISPUTED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'WRITTEN_OFF'
  | 'PAID_PENDING_RECONCILIATION';

export type PaymentMethod = 'CASH' | 'ONLINE';
export type RideType = 'INSTANT' | 'SCHEDULED' | 'RENTAL' | 'OUTSTATION';

export interface FieldError {
  field: string;
  message: string;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta: {
    requestId: string;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    fieldErrors?: FieldError[];
    requestId: string;
  };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
}

export interface AdminSession {
  sessionId: string;
  ipAddress: string;
  userAgent: string;
  isCurrent: boolean;
  createdAt: string;
  lastActiveAt: string;
}

export interface DriverDocument {
  id: string;
  driverId: string;
  type: 'DRIVING_LICENCE' | 'VEHICLE_RC' | 'COMMERCIAL_INSURANCE' | 'POLICE_VERIFICATION';
  documentNumberLast4: string;
  objectKey: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  reviewedBy?: string;
}

export interface DriverProfile {
  id: string;
  userId: string;
  name: string;
  phoneMasked: string;
  approvalStatus: DriverApprovalStatus;
  onlineStatus: DriverOnlineStatus;
  currentVehicleId?: string;
  vehicleDetails?: string;
  rating: number;
  documents: DriverDocument[];
  createdAt: string;
}

export interface Vehicle {
  id: string;
  driverId: string;
  driverName: string;
  categoryId: string;
  categoryName: string;
  registrationNumber: string;
  makeModel: string;
  seats: number;
  verificationStatus: VehicleVerificationStatus;
  rejectionReason?: string;
  createdAt: string;
}

export interface CabCategory {
  id: string;
  code: string;
  name: string;
  capacity: number;
  active: boolean;
  displayOrder: number;
  fareConfigRef?: string;
}

export interface LiveDriverLocation {
  driverId: string;
  name: string;
  phoneMasked: string;
  status: DriverOnlineStatus;
  currentRideId?: string;
  vehicleMakeModel: string;
  vehicleReg: string;
  category: string;
  lat: number;
  lng: number;
  headingDegrees: number;
  speedKmh: number;
  updatedAt: string;
}

export interface LocationPoint {
  label: string;
  lat: number;
  lng: number;
  contactName?: string;
  contactPhone?: string;
}

export interface FareBreakdown {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  waitingFarePaise: number;
  tollPaise: number;
  demandAdjustmentPaise: number;
  discountPaise: number;
  taxPaise: number;
  finalTotalPaise: number;
}

export interface RideRecord {
  id: string;
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhoneMasked: string;
  driverId?: string;
  driverName?: string;
  driverPhoneMasked?: string;
  vehicleRegistration?: string;
  vehicleModel?: string;
  categoryId: string;
  categoryName: string;
  pickup: LocationPoint;
  drop: LocationPoint;
  status: RideStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  rideType: RideType;
  fare: FareBreakdown;
  routePolyline?: Array<[number, number]>;
  cancellationActor?: string;
  cancellationReason?: string;
  requestedAt: string;
  acceptedAt?: string;
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface DispatchQueueItem {
  bookingId: string;
  customerId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerPhoneMasked?: string;
  categoryId?: string;
  categoryName: string;
  zoneId?: string;
  rideType?: string;
  tripKind?: string;
  pickup: LocationPoint;
  drop: LocationPoint;
  estimatedFarePaise: number;
  status: 'REQUESTED' | 'DISPATCHING' | 'NO_DRIVER_FOUND' | string;
  dispatchAttempts: number;
  redispatchCount?: number;
  requestedAt?: string;
  waitingSeconds?: number;
  createdAt?: string;
}

export interface RideReceipt {
  receiptId: string;
  bookingId: string;
  rideId: string;
  issuedAt: string;
  customerName: string;
  driverName: string;
  vehicleDetails: string;
  pickupAddress: string;
  dropAddress: string;
  distanceKm: number;
  durationMinutes: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fare: FareBreakdown;
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][]; // [ [ [lng, lat], [lng, lat], ... ] ]
}

export interface ServiceZone {
  id: string;
  code?: string;
  name: string;
  cityId?: string;
  cityName?: string;
  cityCode?: string;
  polygon: GeoJsonPolygon | Array<[number, number]>;
  active: boolean;
  operatingHours?: {
    start: string;
    end: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PricingConfig {
  id: string;
  name: string;
  cityId: string;
  zoneId: string;
  zoneName: string;
  categoryId: string;
  categoryName: string;
  version: number;
  effectiveFrom: string;
  baseFarePaise: number;
  perKmPaise: number;
  perMinutePaise: number;
  minimumFarePaise: number;
  freeWaitingSeconds: number;
  waitingPerMinutePaise: number;
  demandMultiplierMin: number;
  demandMultiplierMax: number;
  roundingMode: 'NEAREST_RUPEE';
  isActive: boolean;
  changeReason: string;
}

export interface ScheduledRide {
  id: string;
  customerId: string;
  customerName: string;
  customerPhoneMasked: string;
  categoryId: string;
  categoryName: string;
  pickup: LocationPoint;
  drop: LocationPoint;
  scheduledTime: string;
  allocationWindowMinutes: number;
  status: 'SCHEDULED' | 'ALLOCATING' | 'DISPATCHED' | 'CANCELLED';
  assignedDriverName?: string;
  estimatedFarePaise: number;
  createdAt: string;
}

export interface PaymentAttempt {
  paymentId: string;
  rideId: string;
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhoneMasked: string;
  amountPaise: number;
  currency: string;
  method: PaymentMethod;
  provider: 'RAZORPAY' | 'CASH';
  status: PaymentStatus;
  providerOrderId?: string;
  providerPaymentId?: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface GatewayReconciliationItem {
  id: string;
  paymentId: string;
  providerPaymentId: string;
  providerOrderId: string;
  systemAmountPaise: number;
  gatewayAmountPaise: number;
  discrepancyType: 'ORPHANED_GATEWAY_CHARGE' | 'AMOUNT_MISMATCH' | 'DELAYED_WEBHOOK' | 'SIGNATURE_FAILED';
  status: 'FLAGGED' | 'RESOLVED' | 'UNDER_REVIEW';
  detectedAt: string;
}

export interface CashCollectionDiscrepancy {
  id: string;
  rideId: string;
  driverId: string;
  driverName: string;
  driverPhoneMasked: string;
  expectedFarePaise: number;
  reportedCollectedPaise: number;
  differencePaise: number;
  status: 'PENDING_REVIEW' | 'ACCEPTED_DRIVER' | 'ADJUSTED_LEDGER' | 'FLAGGED';
  reportedAt: string;
}

export interface OutstandingBalanceItem {
  rideId: string;
  customerId: string;
  customerName: string;
  customerPhoneMasked: string;
  amountDuePaise: number;
  status: 'DUE' | 'PARTIALLY_PAID' | 'DISPUTED' | 'WRITTEN_OFF';
  bookingRestriction: 'NONE' | 'PAYMENT_REQUIRED' | 'RESTRICTED';
  completedAt: string;
}

export interface SettlementBatch {
  batchId: string;
  period: string;
  driverCount: number;
  totalGrossPaise: number;
  totalCommissionPaise: number;
  totalNetPayablePaise: number;
  status: 'GENERATING' | 'PENDING_APPROVAL' | 'PROCESSED' | 'FAILED';
  processedAt?: string;
  createdAt: string;
}

export interface LedgerEntry {
  entryId: string;
  ownerType: 'DRIVER' | 'CUSTOMER';
  ownerId: string;
  ownerName: string;
  rideId?: string;
  entryType: 'CUSTOMER_FARE_RECEIVABLE' | 'PLATFORM_COMMISSION_REVENUE' | 'DRIVER_EARNING_PAYABLE';
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  reasonCode: string;
  notes?: string;
  createdAt: string;
}

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  category: 'DISPATCH' | 'SAFETY' | 'PAYMENTS' | 'MARKETING';
  lastUpdatedBy: string;
  changeReason?: string;
  updatedAt: string;
}

export interface RbacUserItem {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
  lastLoginAt?: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  actionCode: string;
  targetResource: string;
  targetId: string;
  beforeSnapshot?: Record<string, any>;
  afterSnapshot?: Record<string, any>;
  ipAddress: string;
  timestamp: string;
}

export interface HealthDependencyStatus {
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  details?: string;
}

export interface SystemHealthData {
  status: 'healthy' | 'degraded' | 'down';
  uptimeSeconds: number;
  timestamp: string;
  dependencies: {
    mongo: HealthDependencyStatus;
    redis: HealthDependencyStatus;
    socketCluster: HealthDependencyStatus;
  };
}

// Day 7 Operations & Support Types
export interface SosIncident {
  incidentId: string;
  rideId: string;
  customerId: string;
  customerName: string;
  customerPhoneMasked: string;
  driverId: string;
  driverName: string;
  driverPhoneMasked: string;
  vehicleRegistration: string;
  vehicleModel: string;
  currentLat: number;
  currentLng: number;
  emergencyContacts: Array<{ name: string; phone: string; relation: string }>;
  status: 'OPEN' | 'RESOLVED';
  resolutionCategory?: 'FALSE_ALARM' | 'RESOLVED_ON_SCENE' | 'POLICE_ASSISTED' | 'ESCALATED_EXTERNALLY';
  resolutionSummary?: string;
  triggeredAt: string;
  resolvedAt?: string;
}

export interface TicketMessage {
  id: string;
  sender: 'CUSTOMER' | 'SUPPORT_AGENT' | 'SYSTEM';
  senderName: string;
  message: string;
  timestamp: string;
}

export interface SupportTicket {
  ticketId: string;
  customerId: string;
  customerName: string;
  customerPhoneMasked: string;
  rideId?: string;
  category: 'FARE_DISPUTE' | 'LOST_ITEM' | 'DRIVER_BEHAVIOUR' | 'VEHICLE_CONDITION' | 'APP_ISSUE';
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED';
  subject: string;
  assignedTo?: string;
  messages: TicketMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRatingItem {
  ratingId: string;
  rideId: string;
  raterRole: 'CUSTOMER' | 'DRIVER';
  raterName: string;
  targetName: string;
  stars: number;
  comment?: string;
  flagged: boolean;
  moderationStatus: 'PENDING_REVIEW' | 'APPROVED' | 'HIDDEN';
  moderationReason?: string;
  createdAt: string;
}

export interface CorporateAccount {
  id: string;
  companyName: string;
  contactEmail: string;
  contactPhoneMasked: string;
  gstNumber: string;
  monthlyCreditLimitPaise: number;
  currentOutstandingPaise: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  rejectionReason?: string;
  createdAt: string;
}

export interface CorporateInvoice {
  invoiceId: string;
  corporateAccountId: string;
  companyName: string;
  billingMonth: string;
  totalRides: number;
  totalBilledPaise: number;
  taxPaise: number;
  paymentStatus: PaymentStatus;
  issuedAt: string;
}

export interface CouponItem {
  id: string;
  code: string;
  discountType: 'FLAT_PAISE' | 'PERCENTAGE';
  discountValue: number;
  maxDiscountPaise?: number;
  validFrom: string;
  validTo: string;
  totalRedemptions: number;
  maxRedemptionsLimit: number;
  active: boolean;
  createdAt: string;
}

export interface CustomerListItem {
  userId: string;
  role: 'CUSTOMER';
  phone: string;
  name: string | null;
  accountStatus: AccountStatus;
  createdAt: string;
  bookingRestriction?: 'PAYMENT_REQUIRED' | 'RESTRICTED' | null;
}

export interface CustomerProfileInfo {
  email: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  bookingRestricted: boolean;
  bookingRestrictionReason: string | null;
  bookingRestrictedAt: string | null;
}

export interface CustomerDetail extends CustomerListItem {
  phoneVerifiedAt: string | null;
  liveSessions: number;
  bookingCount: number;
  totalSpentPaise?: number;
  walletBalancePaise?: number;
  customer?: CustomerProfileInfo | null;
  recentBookings?: any[];
}