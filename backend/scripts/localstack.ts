/**
 * One command to load-test the real server on this machine:
 *
 *   npm run loadtest:local
 *
 * It starts a throw-away MongoDB (in memory), seeds it, starts the REAL server process (the same
 * `src/server.ts` that runs in production, with rate limits lifted by LOAD_TEST_MODE), runs the rider
 * load test and then the full-ride load test against it over real HTTP and sockets, prints one
 * report, and shuts everything down.
 *
 * What the numbers mean: one machine runs the server, the database and the load generator together,
 * so they show where the APPLICATION code struggles, not what a hosted server with a hosted database
 * can carry. The in-memory database is faster than Atlas over the network. Use the numbers to find
 * bugs and to compare before/after a change; get real capacity numbers from the staging run.
 *
 * Sizes (environment): RIDERS (default 100), CONCURRENCY (25), DRIVERS (15), RIDE_RIDERS (20),
 * DURATION_SECONDS (45).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { runLoad } from './loadtest';
import { runRideLoad } from './loadtest-rides';
import { sleep } from './loadkit';

const OTP = '123456';
const ADMIN_PHONE = '+919800000001';
const PORT = Number(process.env['LOCAL_PORT'] ?? 4100);
const TSX = 'node_modules/tsx/dist/cli.mjs';

function child(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [TSX, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitUntilUp(baseUrl: string, proc: ChildProcess) {
  for (let i = 0; i < 120; i += 1) {
    if (proc.exitCode !== null) throw new Error('The server stopped while starting.');
    try {
      const res = await fetch(`${baseUrl}/api/v1/health/live`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('The server did not start in 30 seconds.');
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    LOG_LEVEL: 'warn',
    MONGODB_URI: `${mongod.getUri()}loadtest`,
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    PROVIDER_MODE: 'mock',
    STAGING_FIXED_OTP: OTP,
    LOAD_TEST_MODE: 'true',
    SEED_ADMIN_PHONE: ADMIN_PHONE,
    REDIS_URL: '',
  };

  let server: ChildProcess | undefined;
  try {
    const seed = child(['src/seed/run.ts'], env);
    const [code] = await once(seed, 'exit');
    if (code !== 0) throw new Error('Seeding the throw-away database failed.');

    server = child(['src/server.ts'], env);
    let serverLog = '';
    server.stdout?.on('data', (d) => (serverLog += String(d)));
    server.stderr?.on('data', (d) => (serverLog += String(d)));
    await waitUntilUp(baseUrl, server);

    const skipRiders = process.env['SKIP_RIDERS'] === 'true';
    console.log(skipRiders ? 'Skipping the rider-only test.' : 'Rider load test...');
    const riders = await runLoad({
      baseUrl,
      fixedOtp: OTP,
      riders: skipRiders ? 0 : Number(process.env['RIDERS'] ?? 100),
      roundsPerRider: 3,
      concurrency: Number(process.env['CONCURRENCY'] ?? 25),
      sockets: true,
    });

    console.log('Full-ride load test...');
    const rides = await runRideLoad({
      baseUrl,
      fixedOtp: OTP,
      adminPhone: ADMIN_PHONE,
      drivers: Number(process.env['DRIVERS'] ?? 15),
      riders: Number(process.env['RIDE_RIDERS'] ?? 20),
      durationSeconds: Number(process.env['DURATION_SECONDS'] ?? 45),
      locationIntervalMs: 3000,
      offerPollMs: 1500,
    });

    // What the server says about itself after the run.
    const metrics = await fetch(`${baseUrl}/api/v1/health/ready`).then((r) => r.status);
    const report = {
      when: new Date().toISOString(),
      machine: { node: process.version, platform: process.platform },
      note: 'Server, database and load generator share one machine; in-memory MongoDB. See the comment at the top of scripts/localstack.ts.',
      riders,
      rides,
      readyAfterRun: metrics,
      serverWarnings: serverLog
        .split('\n')
        .filter((l) => l.includes('"level":40') || l.includes('"level":50'))
        .slice(0, 10),
    };
    writeFileSync('load-results.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = riders.errorRate > 0.01 || rides.errorRate > 0.01 ? 2 : 0;
  } finally {
    server?.kill();
    await mongod.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
