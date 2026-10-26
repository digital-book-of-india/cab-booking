import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors';
import type { PayoutResult, PayoutStatus, PayoutsProvider } from './types';

/**
 * Bank/UPI payouts to drivers through RazorpayX over its REST API (no vendor SDK).
 *
 * Written from RazorpayX's documented API: contacts -> fund accounts -> payouts, with an
 * `X-Payout-Idempotency` header so a repeated request never pays twice, and webhooks signed with
 * HMAC-SHA256 of the raw body. NOT verified against the live service (it needs a RazorpayX account
 * with a funded current account); the unit tests drive it with a fake `fetch`. The first live check
 * should be one small payout to a bank account or UPI id you control.
 */
const API = 'https://api.razorpay.com/v1';

function hexHmac(secret: string, data: Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}
function sameHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Collapse RazorpayX's many statuses into the few we act on. */
export function normaliseStatus(raw: string | undefined): PayoutStatus {
  switch (raw) {
    case 'processed':
      return 'processed';
    case 'reversed':
      return 'reversed';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'failed';
    default:
      // queued, pending, scheduled, processing, initiated...: still on its way
      return 'processing';
  }
}

type RawPayout = {
  id: string;
  status?: string;
  utr?: string | null;
  failure_reason?: string | null;
  status_details?: { description?: string };
};

const toResult = (p: RawPayout): PayoutResult => ({
  payoutId: p.id,
  status: normaliseStatus(p.status),
  ...(p.utr ? { utr: p.utr } : {}),
  ...(p.failure_reason || p.status_details?.description
    ? { failureReason: String(p.failure_reason ?? p.status_details?.description).slice(0, 200) }
    : {}),
});

export function createRazorpayXPayouts(options: {
  keyId: string;
  keySecret: string;
  accountNumber: string;
  webhookSecret: string;
  fetchFn?: typeof fetch;
}): PayoutsProvider {
  const doFetch = options.fetchFn ?? fetch;
  const auth = `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString('base64')}`;

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    what: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${API}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: auth, ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError('PROVIDER_ERROR', `The payout service could not be reached (${what}).`);
    }
    if (!res.ok) {
      // A 4xx is a decision about the request (bad account, no balance); a 5xx is worth retrying.
      throw new AppError(
        'PROVIDER_ERROR',
        `The payout service refused the request (${what}, ${res.status}).`,
      );
    }
    return (await res.json()) as T;
  }

  return {
    async createFundAccount({ referenceId, name, destination }) {
      const contact = await call<{ id: string }>('POST', '/contacts', 'contact', {
        name,
        type: 'vendor',
        reference_id: referenceId,
      });
      const fund = await call<{ id: string }>('POST', '/fund_accounts', 'fund account', {
        contact_id: contact.id,
        ...(destination.type === 'BANK'
          ? {
              account_type: 'bank_account',
              bank_account: {
                name,
                ifsc: destination.ifsc,
                account_number: destination.accountNumber,
              },
            }
          : { account_type: 'vpa', vpa: { address: destination.vpa } }),
      });
      return { contactId: contact.id, fundAccountId: fund.id };
    },

    async createPayout({
      fundAccountId,
      amountPaise,
      referenceId,
      narration,
      mode,
      idempotencyKey,
    }) {
      const p = await call<RawPayout>(
        'POST',
        '/payouts',
        'payout',
        {
          account_number: options.accountNumber,
          fund_account_id: fundAccountId,
          amount: amountPaise,
          currency: 'INR',
          mode,
          purpose: 'payout',
          queue_if_low_balance: true,
          reference_id: referenceId,
          narration,
        },
        { 'X-Payout-Idempotency': idempotencyKey },
      );
      return toResult(p);
    },

    async getPayout(payoutId) {
      return toResult(
        await call<RawPayout>('GET', `/payouts/${encodeURIComponent(payoutId)}`, 'status'),
      );
    },

    verifyWebhookSignature(rawBody, signature) {
      if (!signature) return false;
      return sameHex(hexHmac(options.webhookSecret, rawBody), signature);
    },
  };
}
