import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../config/db';
import { loadEnv } from '../config/env';
import { FeatureFlag } from '../modules/flags/featureFlag.model';
import { formatFindings, preflight, sosFinding, type Finding } from './preflight';

/** `npm run preflight:prod`: reads the settings and the SOS flag, changes nothing, exits 1 on any BLOCK. */
async function main(): Promise<number> {
  let findings: Finding[];
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.log(`BLOCK the server would not start: ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  findings = preflight(env);
  await connectMongo(env);
  try {
    const sos = await FeatureFlag.findOne({ key: 'SOS' }).lean();
    // Without a row the production default (off) applies.
    findings = findings.concat(
      sosFinding(sos?.enabled === true, process.env['SAFETY_DESK_STAFFED'] === '1'),
    );
  } finally {
    await disconnectMongo();
  }
  console.log(formatFindings(findings));
  return findings.some((f) => f.level === 'BLOCK') ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
