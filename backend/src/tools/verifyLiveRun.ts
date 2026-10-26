import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { Redis } from 'ioredis';
import { connectMongo, disconnectMongo, pingMongo } from '../config/db';
import { loadEnv } from '../config/env';
import { createProviders } from '../providers';
import { formatResults, runChecks, type RedisLike } from './verifyLive';

/** See verifyLive.ts for what this checks and which VERIFY_* settings turn on the checks that contact a person. */
async function main(): Promise<void> {
  const env = loadEnv();
  const providers = createProviders(env);

  let mongoUp = false;
  try {
    await connectMongo(env);
    mongoUp = true;
  } catch {
    // reported by the database check below
  }
  const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 }) : null;
  redis?.on('error', () => undefined);

  const results = await runChecks({
    env,
    providers,
    pingMongo: mongoUp
      ? pingMongo
      : () => Promise.reject(new Error('could not connect to MONGODB_URI')),
    redis: redis as unknown as RedisLike | null,
    targets: {
      phone: process.env['VERIFY_PHONE'],
      email: process.env['VERIFY_EMAIL'],
      fcmToken: process.env['VERIFY_FCM_TOKEN'],
      payouts: process.env['VERIFY_PAYOUTS'] === '1',
      allowLiveKeys: process.env['VERIFY_ALLOW_LIVE'] === '1',
      baseUrl: process.env['BASE_URL'],
    },
  });

  console.log(`\nIntegration check, ${new Date().toISOString()} (NODE_ENV=${env.NODE_ENV})\n`);
  console.log(formatResults(results));
  // Where the JSON copy goes (a container's /app is read-only for the node user: set VERIFY_OUTPUT=/tmp/verify.json).
  const output = process.env['VERIFY_OUTPUT'] ?? 'verify-live-results.json';
  await writeFile(
    output,
    JSON.stringify({ at: new Date().toISOString(), environment: env.NODE_ENV, results }, null, 2),
  ).catch((err: unknown) =>
    console.warn(`(could not write ${output}: ${err instanceof Error ? err.message : err})`),
  );
  redis?.disconnect();
  if (mongoUp) await disconnectMongo();
  if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
