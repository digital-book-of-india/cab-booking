/** Provider adapter contracts. Business modules depend on these, never on vendor SDKs. */

export type LatLng = { lat: number; lng: number };

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  /** Google "encoded polyline" of the road path, for drawing a preview. Not always available. */
  polyline?: string | undefined;
};

export type PlaceSuggestion = {
  placeId: string;
  /** Full text to show, e.g. "Connaught Place, New Delhi, Delhi, India". */
  description: string;
  mainText: string;
  secondaryText: string;
};

export interface MapsProvider {
  /** Road distance/duration between two points. */
  route(origin: LatLng, destination: LatLng): Promise<RouteResult>;
  geocode(address: string): Promise<LatLng | null>;
  reverseGeocode(point: LatLng): Promise<string | null>;
  /** Address suggestions while the user types. `sessionToken` groups one search for billing. */
  autocomplete(
    input: string,
    options?: { sessionToken?: string | undefined; near?: LatLng | undefined },
  ): Promise<PlaceSuggestion[]>;
  /** The coordinates and address of a suggestion the user picked. Null if the place is unknown. */
  place(
    placeId: string,
    options?: { sessionToken?: string | undefined },
  ): Promise<{ point: LatLng; address: string; name: string } | null>;
}

export interface SmsProvider {
  sendOtp(phoneE164: string, otp: string): Promise<{ providerMessageId: string }>;
  /** A plain text message (e.g. an emergency alert to a saved contact). Needs an approved template in India. */
  sendText(phoneE164: string, message: string): Promise<{ providerMessageId: string }>;
}

export interface EmailProvider {
  send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string | undefined;
  }): Promise<{ providerMessageId: string }>;
}

export type PushPayload = {
  title: string;
  body: string;
  /** All values must be strings (a push-service rule). Never put phone numbers or OTPs here. */
  data?: Record<string, string>;
  /** high wakes a sleeping phone (ride offers); normal can be batched by the OS. */
  priority?: 'high' | 'normal';
  /** Drop the message instead of delivering it late. */
  ttlSeconds?: number;
};

/** Thrown by a push adapter when the device token is permanently dead; the caller deletes it. */
export class InvalidPushTokenError extends Error {
  constructor() {
    super('Push token is no longer valid.');
    this.name = 'InvalidPushTokenError';
  }
}

export interface PushProvider {
  /** Resolves on success; throws InvalidPushTokenError for a dead token, any other Error if retryable. */
  send(deviceToken: string, payload: PushPayload): Promise<{ providerMessageId: string }>;
}

export interface PaymentsProvider {
  /** Public key the app's checkout screen needs (safe to show; not the secret). */
  readonly checkoutKey: string;
  /** Creates a provider order server-side. Amount is integer paise. */
  createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<{ orderId: string }>;
  verifyPaymentSignature(input: { orderId: string; paymentId: string; signature: string }): boolean;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  /** Refund (part of) a captured payment. `pending` finishes later via the refund webhook. */
  createRefund(input: {
    paymentId: string;
    amountPaise: number;
    receipt: string;
  }): Promise<{ refundId: string; status: 'pending' | 'processed' | 'failed' }>;
}

export type PayoutStatus = 'processing' | 'processed' | 'failed' | 'reversed';
export type PayoutResult = {
  payoutId: string;
  status: PayoutStatus;
  /** Bank reference number, once the money has been sent. */
  utr?: string;
  failureReason?: string;
};
export type PayoutDestination =
  { type: 'BANK'; accountNumber: string; ifsc: string } | { type: 'UPI'; vpa: string };

/** Sends money from our account to a driver's bank account or UPI id. */
export interface PayoutsProvider {
  /**
   * Registers where to send a driver's money. The full account number goes to the provider only;
   * the caller keeps just the returned references.
   */
  createFundAccount(input: {
    referenceId: string;
    name: string;
    destination: PayoutDestination;
  }): Promise<{ contactId: string; fundAccountId: string }>;
  /** Asking twice with the same idempotencyKey never pays twice. */
  createPayout(input: {
    fundAccountId: string;
    amountPaise: number;
    referenceId: string;
    narration: string;
    mode: 'IMPS' | 'UPI';
    idempotencyKey: string;
  }): Promise<PayoutResult>;
  getPayout(payoutId: string): Promise<PayoutResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

export interface StorageProvider {
  createUploadUrl(
    objectKey: string,
    contentType: string,
  ): Promise<{ url: string; expiresInSeconds: number }>;
  createDownloadUrl(objectKey: string): Promise<{ url: string; expiresInSeconds: number }>;
  /** Is the file there, how big, and of what type? Used to check an upload really happened. */
  statObject(
    objectKey: string,
  ): Promise<
    { exists: false } | { exists: true; sizeBytes: number; contentType?: string | undefined }
  >;
  deleteObject(objectKey: string): Promise<void>;
}

export interface Providers {
  maps: MapsProvider;
  sms: SmsProvider;
  email: EmailProvider;
  push: PushProvider;
  payments: PaymentsProvider;
  payouts: PayoutsProvider;
  storage: StorageProvider;
}
