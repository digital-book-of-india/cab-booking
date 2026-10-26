import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../config/db';
import { loadEnv } from '../config/env';
import { allModels } from './models';
import { ensureIndexes } from './ensureIndexes';

/** Release step: `npm run indexes` (add `-- --prune` to also drop indexes no schema declares). */
async function main(): Promise<void> {
  const prune = process.argv.includes('--prune');
  await connectMongo(loadEnv());
  const report = await ensureIndexes(allModels, { prune });
  for (const r of report) console.log(`${r.collection}: ${r.indexes.join(', ')}`);
  console.log(`Indexes ready on ${report.length} collections${prune ? ' (pruned)' : ''}.`);
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
