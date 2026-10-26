import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../config/db';
import { loadEnv } from '../config/env';
import { DriverDocument } from '../modules/drivers/driverDocument.model';
import { sweepUploads } from './uploadSweep';

/** `npm run uploads:sweep [-- --delete] [--min-age-hours 24]`: lists (or removes) uploaded files nothing refers to. */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes('--delete');
  const at = args.indexOf('--min-age-hours');
  const hours = at >= 0 ? Number(args[at + 1]) : 24;
  if (!Number.isFinite(hours) || hours < 1) throw new Error('--min-age-hours must be 1 or more');

  const env = loadEnv();
  if (env.STORAGE_DRIVER !== 'local' || !env.UPLOAD_DIR) {
    console.log('Nothing to sweep: STORAGE_DRIVER is not local.');
    return 0;
  }
  await connectMongo(env);
  try {
    const keys = await DriverDocument.distinct('objectKey');
    const report = await sweepUploads({
      dir: env.UPLOAD_DIR,
      referenced: new Set(keys),
      minAgeMs: hours * 3_600_000,
      apply,
    });
    for (const o of report.orphans) console.log(`orphan   ${o.key} (${o.sizeBytes} bytes)`);
    for (const t of report.abandonedTemp) console.log(`partial  ${t.name} (${t.sizeBytes} bytes)`);
    const kb = Math.round(report.freedBytes / 1024);
    console.log(
      `${report.orphans.length} orphaned files, ${report.abandonedTemp.length} partial uploads, ${kb} KB. ` +
        (apply ? 'Deleted.' : 'Dry run: nothing deleted. Add --delete to remove them.'),
    );
    return 0;
  } finally {
    await disconnectMongo();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
