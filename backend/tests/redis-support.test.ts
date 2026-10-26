import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { limiterStore, useRedisForLimits } from '../src/middleware/limiterStore';

afterEach(() => useRedisForLimits(null));

/** A Redis that is down: every command fails. */
const deadRedis = {
  call: async () => {
    throw new Error('ECONNREFUSED');
  },
} as unknown as Redis;

function appWith(name: string) {
  const app = express();
  app.use(rateLimit({ ...limiterStore(name), windowMs: 60_000, limit: 2 }));
  app.get('/', (_req, res) => void res.send('ok'));
  return app;
}

describe('rate limits with and without Redis', () => {
  it('count in memory when there is no Redis', async () => {
    useRedisForLimits(null);
    const app = appWith('t1');
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(429);
  });

  it('let requests through when Redis is down (fail open)', async () => {
    useRedisForLimits(deadRedis);
    const app = appWith('t2');
    for (let i = 0; i < 5; i++) expect((await request(app).get('/')).status).toBe(200);
  });

  it('keep the counts in Redis when it is there', async () => {
    const seen: string[][] = [];
    const counts = new Map<string, number>();
    const fake = {
      call: async (...args: string[]) => {
        seen.push(args);
        const cmd = args[0]!;
        if (cmd === 'SCRIPT') return 'sha';
        if (cmd === 'EVALSHA' || cmd === 'EVAL') {
          const key = args.find((a) => a.startsWith('rl:')) ?? 'k';
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          return [n, 60_000];
        }
        return null;
      },
    } as unknown as Redis;
    useRedisForLimits(fake);
    const app = appWith('t3');
    expect((await request(app).get('/')).status).toBe(200);
    expect(seen.some((a) => a.some((x) => x.startsWith('rl:t3:')))).toBe(true);
  });
});
