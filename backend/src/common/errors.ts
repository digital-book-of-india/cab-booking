export type FieldError = { field: string; message: string };

/** Frozen error-code catalogue (see docs/api-contract.md). Add codes; never rename. */
export const ErrorCodes = {
  VALIDATION_ERROR: { status: 400, message: 'Request validation failed.' },
  UNAUTHENTICATED: { status: 401, message: 'Authentication required.' },
  FORBIDDEN: { status: 403, message: 'You are not allowed to perform this action.' },
  NOT_FOUND: { status: 404, message: 'Resource not found.' },
  CONFLICT: { status: 409, message: 'Request conflicts with current state.' },
  RIDE_ALREADY_ASSIGNED: {
    status: 409,
    message: 'This ride has already been accepted by another driver.',
  },
  RIDE_INVALID_STATE: {
    status: 409,
    message: 'Ride cannot perform this action in its current state.',
  },
  OTP_INVALID: { status: 401, message: 'Invalid or already used OTP.' },
  OTP_EXPIRED: { status: 401, message: 'OTP has expired. Request a new one.' },
  OTP_ATTEMPTS_EXCEEDED: {
    status: 429,
    message: 'Too many incorrect attempts. Request a new OTP.',
  },
  NOT_SERVICEABLE: { status: 422, message: 'This trip is outside our service area or hours.' },
  QUOTE_EXPIRED: { status: 422, message: 'This fare quote has expired. Request a new one.' },
  QUOTE_ALREADY_USED: { status: 409, message: 'This fare quote has already been used.' },
  QUOTE_MISMATCH: { status: 422, message: 'Booking details do not match the fare quote.' },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message: 'This Idempotency-Key was already used with a different request.',
  },
  PICKUP_OTP_INVALID: { status: 422, message: 'The pickup OTP is incorrect.' },
  PICKUP_OTP_EXPIRED: { status: 422, message: 'The pickup OTP has expired. Ask for a new one.' },
  PICKUP_OTP_ATTEMPTS_EXCEEDED: {
    status: 429,
    message: 'Too many incorrect pickup OTP attempts. Ask the rider for a new OTP.',
  },
  DRIVER_NOT_ELIGIBLE: { status: 403, message: 'You are not eligible to take rides right now.' },
  OFFER_UNAVAILABLE: { status: 409, message: 'This ride offer is no longer available.' },
  NOT_AT_PICKUP: { status: 422, message: 'You are not close enough to the pickup point.' },
  CORPORATE_NOT_ALLOWED: {
    status: 403,
    message: 'You cannot use a company account for this ride.',
  },
  CORPORATE_LIMIT_EXCEEDED: {
    status: 422,
    message: 'This ride is over a limit set by your company.',
  },
  INSUFFICIENT_WALLET_BALANCE: {
    status: 402,
    message: 'Your wallet balance is not enough. Add money or pay another way.',
  },
  FEATURE_DISABLED: { status: 403, message: 'This feature is not available right now.' },
  NOT_AT_STOP: { status: 422, message: 'You are not close enough to this stop.' },
  NO_SHOW_TOO_EARLY: {
    status: 422,
    message: 'You have not waited long enough at the pickup to mark a no-show.',
  },
  LOCATION_REJECTED: { status: 422, message: 'This location update was rejected.' },
  BOOKING_RESTRICTED: {
    status: 403,
    message: 'Your account is restricted from creating new bookings.',
  },
  CONCURRENT_BOOKING_NOT_ALLOWED: {
    status: 409,
    message: 'You already have an active booking in progress. Please complete or cancel it before booking again.',
  },
  UNPAID_BALANCE: {
    status: 402,
    message: 'You have an unpaid ride. Please pay it before booking another.',
  },
  PAYMENT_SIGNATURE_INVALID: { status: 400, message: 'The payment could not be verified.' },
  UNPROCESSABLE: { status: 422, message: 'Business validation failed.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please try again later.' },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong.' },
  PROVIDER_ERROR: { status: 502, message: 'An upstream provider failed.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable.' },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly fieldErrors: FieldError[] = [],
  ) {
    super(message ?? ErrorCodes[code].message);
    this.name = 'AppError';
    this.status = ErrorCodes[code].status;
  }
}
