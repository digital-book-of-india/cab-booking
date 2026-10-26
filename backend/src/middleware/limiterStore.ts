import type { Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Redis } from 'ioredis';

type StoreFactory = (name: string) => Store | undefined;
let factory: StoreFactory = () => undefined;

/**
 * Where rate-limit counters live. Without Redis each server instance counts on its own (fine for one
 * instance); with Redis all instances share the counts. Call before the app is created.
 */
export function useRedisForLimits(redis: Redis | null): void {
  factory = redis
    ? (name) =>
        new RedisStore({
          prefix: `rl:${name}:`,
          sendCommand: (...args: string[]) =>
            redis.call(args[0]!, ...args.slice(1)) as Promise<never>,
        })
    : () => undefined;
}

/**
 * Options to spread into a limiter. If Redis is slow or down, requests are let through (and the
 * error is not thrown) rather than the whole API going down with it: fail open.
 */
export function limiterStore(name: string): { store?: Store; passOnStoreError: true } {
  const store = factory(name);
  return { ...(store ? { store } : {}), passOnStoreError: true };
}
