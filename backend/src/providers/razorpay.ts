import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentsProvider } from './types';

/**
 * Razorpay over its REST API, without the vendor SDK (fewer dependencies to audit).
 *
 * The signature rules are Razorpay's documented ones:
 *  - checkout: HMAC-SHA256(key_secret, "<order_id>|<payment_id>") as hex
 *  - webhook:  HMAC-SHA256(webhook_secret, <raw request body>) as hex
 *
 * Verified in unit tests with a fake `fetch` and signatures computed the same way. NOT yet verified
 * against the live service: the first live check should be one order in Razorpay TEST mode.
 */
const API = 'https://api.razorpay.com/v1';

function hexHmac(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function sameHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createRazorpayPayments(options: {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetchFn?: typeof fetch;
}): PaymentsProvider {
  const doFetch = options.fetchFn ?? fetch;
  const auth = `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`;

  async function post<T>(path: string, body: unknown, what: string): Promise<T> {
    const res = await doFetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Razorpay ${what} failed (${res.status})`);
    return (await res.json()) as T;
  }

  return {
    checkoutKey: options.keyId,
    async createOrder({ amountPaise, receipt, notes }) {
      const order = await post<{ id: string }>(
        '/orders',
        { amount: amountPaise, currency: 'INR', receipt, ...(notes ? { notes } : {}) },
        'order',
      );
      return { orderId: order.id };
    },

    verifyPaymentSignature({ orderId, paymentId, signature }) {
      if (!orderId || !paymentId || !signature) return false;
      return sameHex(hexHmac(options.keySecret, `${orderId}|${paymentId}`), signature);
    },

    verifyWebhookSignature(rawBody, signature) {
      if (!signature) return false;
      return sameHex(hexHmac(options.webhookSecret, rawBody), signature);
    },

    async createRefund({ paymentId, amountPaise, receipt }) {
      const r = await post<{ id: string; status: string }>(
        `/payments/${encodeURIComponent(paymentId)}/refund`,
        { amount: amountPaise, notes: { receipt } },
        'refund',
      );
      const status =
        r.status === 'processed' ? 'processed' : r.status === 'failed' ? 'failed' : 'pending';
      return { refundId: r.id, status };
    },
  };
}
