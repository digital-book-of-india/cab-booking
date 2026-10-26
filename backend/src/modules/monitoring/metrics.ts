import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Request, RequestHandler, Response } from 'express';

const BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000];
const MAX_ROUTES = 300; // a hard cap so odd URLs can never grow memory without bound

type RouteStat = {
  count: number;
  sumMs: number;
  buckets: number[];
  statuses: Record<string, number>;
};

/**
 * Request metrics kept in memory for this server instance: counts and latency per route (by route
 * pattern, never by real id), status classes, and a per-minute window used to alert on a rising
 * error rate. No outside account is needed; a metrics tool can read the Prometheus text endpoint.
 */
export function createMetrics(now: () => Date = () => new Date()) {
  const startedAt = now();
  const routes = new Map<string, RouteStat>();
  const minutes = new Map<number, { requests: number; serverErrors: number }>();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();

  const quantile = (stat: RouteStat, q: number) => {
    const target = stat.count * q;
    let seen = 0;
    for (let i = 0; i < stat.buckets.length; i += 1) {
      seen += stat.buckets[i]!;
      if (seen >= target)
        return i < BUCKETS_MS.length ? BUCKETS_MS[i]! : BUCKETS_MS[BUCKETS_MS.length - 1]! * 2;
    }
    return 0;
  };

  function record(key: string, ms: number, status: number) {
    let stat = routes.get(key);
    if (!stat) {
      if (routes.size >= MAX_ROUTES) key = 'OTHER';
      stat = routes.get(key) ?? {
        count: 0,
        sumMs: 0,
        buckets: new Array(BUCKETS_MS.length + 1).fill(0),
        statuses: {},
      };
      routes.set(key, stat);
    }
    stat.count += 1;
    stat.sumMs += ms;
    const slot = BUCKETS_MS.findIndex((b) => ms <= b);
    stat.buckets[slot === -1 ? BUCKETS_MS.length : slot]! += 1;
    const cls = `${Math.floor(status / 100)}xx`;
    stat.statuses[cls] = (stat.statuses[cls] ?? 0) + 1;

    const minute = Math.floor(now().getTime() / 60_000);
    const bin = minutes.get(minute) ?? { requests: 0, serverErrors: 0 };
    bin.requests += 1;
    if (status >= 500) bin.serverErrors += 1;
    minutes.set(minute, bin);
    for (const m of minutes.keys()) if (m < minute - 30) minutes.delete(m);
  }

  const middleware: RequestHandler = (req: Request, res: Response, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      // Express resets baseUrl once a request leaves nested routers, so build the key from the route
      // itself: every API route lives under /api/v1 (the payment webhook already says so in its path).
      const path = req.route ? String(req.route.path) : '';
      const pattern = req.route
        ? path.startsWith('/api/v1')
          ? path
          : `/api/v1${path}`
        : 'UNMATCHED';
      record(`${req.method} ${pattern}`, ms, res.statusCode);
    });
    next();
  };

  /** Requests and server errors (5xx) in the last `minutesBack` minutes, on this instance. */
  function window(minutesBack: number) {
    const minute = Math.floor(now().getTime() / 60_000);
    let requests = 0;
    let serverErrors = 0;
    for (const [m, bin] of minutes) {
      if (m > minute - minutesBack) {
        requests += bin.requests;
        serverErrors += bin.serverErrors;
      }
    }
    return { requests, serverErrors };
  }

  function snapshot() {
    const mem = process.memoryUsage();
    const rows = [...routes.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50)
      .map(([route, s]) => ({
        route,
        count: s.count,
        avgMs: Math.round(s.sumMs / s.count),
        p95Ms: quantile(s, 0.95),
        statuses: s.statuses,
      }));
    return {
      startedAt,
      uptimeSeconds: Math.round((now().getTime() - startedAt.getTime()) / 1000),
      last5Minutes: window(5),
      process: {
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        eventLoopLagP99Ms: Math.round(loop.percentile(99) / 1e6),
      },
      routes: rows,
    };
  }

  /** Prometheus text format, for any metrics tool. */
  function prometheus() {
    const lines: string[] = [
      '# TYPE http_requests_total counter',
      '# TYPE http_request_duration_ms histogram',
    ];
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    for (const [key, s] of routes) {
      const [method, ...rest] = key.split(' ');
      const labels = `method="${esc(method!)}",route="${esc(rest.join(' '))}"`;
      for (const [cls, n] of Object.entries(s.statuses)) {
        lines.push(`http_requests_total{${labels},status="${cls}"} ${n}`);
      }
      let cumulative = 0;
      BUCKETS_MS.forEach((b, i) => {
        cumulative += s.buckets[i]!;
        lines.push(`http_request_duration_ms_bucket{${labels},le="${b}"} ${cumulative}`);
      });
      lines.push(`http_request_duration_ms_bucket{${labels},le="+Inf"} ${s.count}`);
      lines.push(`http_request_duration_ms_sum{${labels}} ${Math.round(s.sumMs)}`);
      lines.push(`http_request_duration_ms_count{${labels}} ${s.count}`);
    }
    const mem = process.memoryUsage();
    lines.push(
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '# TYPE nodejs_eventloop_lag_p99_ms gauge',
      `nodejs_eventloop_lag_p99_ms ${Math.round(loop.percentile(99) / 1e6)}`,
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${Math.round((now().getTime() - startedAt.getTime()) / 1000)}`,
    );
    return `${lines.join('\n')}\n`;
  }

  return { middleware, window, snapshot, prometheus, stop: () => loop.disable() };
}

export type Metrics = ReturnType<typeof createMetrics>;
