import type { Model } from 'mongoose';
import { AuditLog } from '../modules/audit/auditLog.model';
import { OtpChallenge } from '../modules/auth/otp.model';
import { Session } from '../modules/auth/session.model';
import { Booking } from '../modules/bookings/booking.model';
import { BookingEvent } from '../modules/bookings/bookingEvent.model';
import { CabCategory } from '../modules/categories/cabCategory.model';
import { CustomerProfile } from '../modules/customers/customerProfile.model';
import { SavedPlace } from '../modules/customers/savedPlace.model';
import { ReferralClaim, ReferralProfile } from '../modules/referrals/referral.model';
import { RideOffer } from '../modules/dispatch/rideOffer.model';
import { DriverDocument } from '../modules/drivers/driverDocument.model';
import { DriverProfile } from '../modules/drivers/driverProfile.model';
import { Device } from '../modules/notifications/device.model';
import { Notification } from '../modules/notifications/notification.model';
import { LocationPing } from '../modules/tracking/locationPing.model';
import { CancellationPolicy } from '../modules/pricing/cancellationPolicy.model';
import { CommissionConfig } from '../modules/ledger/commission.model';
import { LedgerTransaction } from '../modules/ledger/ledgerTransaction.model';
import { Payment } from '../modules/payments/payment.model';
import { Refund } from '../modules/payments/refund.model';
import { WebhookEvent } from '../modules/payments/webhookEvent.model';
import { Settlement } from '../modules/settlements/settlement.model';
import {
  Company,
  Invoice,
  InvoiceCounter,
  Membership,
} from '../modules/corporate/corporate.models';
import { OutstationRate, RentalPackage } from '../modules/trips/trips.models';
import { StaffCredential } from '../modules/staffauth/staffCredential.model';
import { Payout, PayoutAccount } from '../modules/payouts/payout.model';
import { Tip } from '../modules/tips/tip.model';
import { Wallet } from '../modules/wallet/wallet.model';
import { Coupon, CouponUsage } from '../modules/coupons/coupon.model';
import { FeatureFlag } from '../modules/flags/featureFlag.model';
import { Rating } from '../modules/ratings/rating.model';
import { EmergencyContact, SafetyIncident, TripShare } from '../modules/safety/safety.models';
import { SupportTicket } from '../modules/support/supportTicket.model';
import { FareConfig } from '../modules/pricing/fareConfig.model';
import { FareQuote } from '../modules/quotes/fareQuote.model';
import { Ride } from '../modules/rides/ride.model';
import { User } from '../modules/users/user.model';
import { Vehicle } from '../modules/vehicles/vehicle.model';
import { ServiceZone } from '../modules/zones/serviceZone.model';

/**
 * Every Mongoose model in the app. `tests/db-hardening.test.ts` fails if a `*.model.ts` file is
 * missing from this list, so a new model can never silently skip index creation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allModels: Model<any>[] = [
  AuditLog,
  OtpChallenge,
  Session,
  Booking,
  BookingEvent,
  CabCategory,
  CustomerProfile,
  SavedPlace,
  ReferralProfile,
  ReferralClaim,
  RideOffer,
  DriverDocument,
  DriverProfile,
  FareConfig,
  FareQuote,
  Ride,
  User,
  Vehicle,
  ServiceZone,
  Device,
  Notification,
  LocationPing,
  CancellationPolicy,
  LedgerTransaction,
  CommissionConfig,
  Payment,
  Refund,
  WebhookEvent,
  Settlement,
  FeatureFlag,
  EmergencyContact,
  SafetyIncident,
  TripShare,
  SupportTicket,
  Rating,
  Coupon,
  CouponUsage,
  Tip,
  Wallet,
  Payout,
  PayoutAccount,
  Company,
  Membership,
  Invoice,
  InvoiceCounter,
  StaffCredential,
  RentalPackage,
  OutstationRate,
];
