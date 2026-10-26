/** Shared pieces of the load-test scripts: timed HTTP calls and the summary. */
export type Sample = { name: string; ms: number; status: number };

export type EndpointSummary = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  statuses: Record<string, number>;
};

const pct = (sorted: number[], p: number) =>
  sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;

export function createClient(baseUrl: string) {
  const samples: Sample[] = [];

  async function timed(name: string, input: string, init?: RequestInit) {
    const t0 = performance.now();
    let status: number; // 0 = the request never got an answer
    let body: unknown = null;
    try {
      const res = await fetch(`${baseUrl}/api/v1${input}`, init);
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    samples.push({ name, ms: performance.now() - t0, status });
    return { status, body: body as { data?: Record<string, unknown> | unknown[] } | null };
  }

  const post = (data: unknown, token?: string, key?: string): RequestInit => ({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: JSON.stringify(data),
  });
  const patch = (data: unknown, token: string): RequestInit => ({
    ...post(data, token),
    method: 'PATCH',
  });
  const get = (token?: string): RequestInit => ({
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  /** Sign in with the staging fixed OTP. Returns the access token, or undefined on failure. */
  async function login(phone: string, otp: string, role?: 'CUSTOMER' | 'DRIVER') {
    const req = await timed('POST /auth/otp/request', '/auth/otp/request', post({ phone }));
    const challengeId = (req.body?.data as Record<string, unknown> | undefined)?.['challengeId'];
    if (!challengeId) return undefined;
    const verify = await timed(
      'POST /auth/otp/verify',
      '/auth/otp/verify',
      post({ challengeId, phone, otp, ...(role ? { role } : {}) }),
    );
    return (verify.body?.data as Record<string, unknown> | undefined)?.['accessToken'] as
      string | undefined;
  }

  function summary(): Record<string, EndpointSummary> {
    const out: Record<string, EndpointSummary> = {};
    for (const name of new Set(samples.map((s) => s.name))) {
      const rows = samples.filter((s) => s.name === name);
      const times = rows.map((r) => r.ms).sort((a, b) => a - b);
      const statuses: Record<string, number> = {};
      for (const r of rows) statuses[String(r.status)] = (statuses[String(r.status)] ?? 0) + 1;
      out[name] = {
        count: rows.length,
        p50: Math.round(pct(times, 50)),
        p95: Math.round(pct(times, 95)),
        p99: Math.round(pct(times, 99)),
        max: Math.round(times[times.length - 1] ?? 0),
        statuses,
      };
    }
    return out;
  }

  /** Server errors and unanswered requests count as failures; 4xx are the API doing its job. */
  const errors = () => samples.filter((s) => s.status === 0 || s.status >= 500).length;

  return { samples, timed, post, patch, get, login, summary, errors };
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: Math.round(pct(sorted, 50)),
    p95: Math.round(pct(sorted, 95)),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
}
