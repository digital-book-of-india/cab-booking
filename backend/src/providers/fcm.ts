import jwt from 'jsonwebtoken';
import { InvalidPushTokenError, type PushProvider } from './types';

/**
 * Firebase Cloud Messaging through its HTTP v1 API. It is written against `fetch` directly (and
 * signs the OAuth token with jsonwebtoken) so the server does not need the firebase-admin SDK,
 * which pulls in a large tree of unused Google packages with known advisories.
 *
 * NOT verified against the real service: there is no Firebase project yet. The unit tests drive
 * it with a fake `fetch`. The first live check should be one push to a real device.
 */
export type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

export function parseServiceAccount(json: string): FirebaseServiceAccount {
  let parsed: Partial<FirebaseServiceAccount>;
  try {
    parsed = JSON.parse(json) as Partial<FirebaseServiceAccount>;
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON must contain project_id, client_email, private_key');
  }
  return parsed as FirebaseServiceAccount;
}

export function createFcmPush(options: {
  serviceAccount: FirebaseServiceAccount;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
}): PushProvider {
  const { serviceAccount } = options;
  const doFetch = options.fetchFn ?? fetch;
  const nowMs = options.nowMs ?? (() => Date.now());
  const tokenUri = serviceAccount.token_uri ?? DEFAULT_TOKEN_URI;
  let cached: { token: string; expiresAtMs: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAtMs - 60_000 > nowMs()) return cached.token;
    const iat = Math.floor(nowMs() / 1000);
    const assertion = jwt.sign(
      { iss: serviceAccount.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 },
      serviceAccount.private_key,
      { algorithm: 'RS256' },
    );
    const res = await doFetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('FCM auth returned no token');
    cached = { token: body.access_token, expiresAtMs: nowMs() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  async function post(message: Record<string, unknown>, retryAuth: boolean): Promise<string> {
    const res = await doFetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({ message }),
      },
    );
    if (res.ok) return ((await res.json()) as { name?: string }).name ?? 'fcm_message';

    if (res.status === 401 && retryAuth) {
      cached = null; // our cached access token went stale; fetch a new one once
      return post(message, false);
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode;
    const deadToken =
      code === 'UNREGISTERED' ||
      (res.status === 400 && /registration token/i.test(body.error?.message ?? ''));
    if (deadToken) throw new InvalidPushTokenError();
    throw new Error(`FCM send failed (${res.status} ${body.error?.status ?? ''})`.trim());
  }

  return {
    async send(deviceToken, payload) {
      const high = (payload.priority ?? 'normal') === 'high';
      const ttl = payload.ttlSeconds;
      const message: Record<string, unknown> = {
        token: deviceToken,
        notification: { title: payload.title, body: payload.body },
        ...(payload.data ? { data: payload.data } : {}),
        android: { priority: high ? 'HIGH' : 'NORMAL', ...(ttl ? { ttl: `${ttl}s` } : {}) },
        apns: {
          headers: {
            'apns-priority': high ? '10' : '5',
            ...(ttl ? { 'apns-expiration': String(Math.floor(nowMs() / 1000) + ttl) } : {}),
          },
        },
      };
      return { providerMessageId: await post(message, true) };
    },
  };
}
