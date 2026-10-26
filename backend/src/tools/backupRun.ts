import 'dotenv/config';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../config/db';
import { loadEnv } from '../config/env';
import {
  compareDatabases,
  dumpDatabase,
  parseBackupKey,
  restoreDatabase,
  verifyBackup,
} from './backup';

const USAGE = `Backups (database only; back up the uploads folder separately).

  npm run backup -- dump [folder] [--encrypt] write a backup of the database MONGODB_URI points at
  npm run backup -- verify <folder>           prove a backup folder is complete and untouched (no database needed)
  npm run backup -- restore <folder> --into <database> [--force]
                                              load a backup into <database> (must be the database MONGODB_URI
                                              connects to; refused if it already has data unless --force)
  npm run backup -- compare <databaseA> <databaseB>
                                              restore drill: are two databases on this server identical?

Encrypted backups: set BACKUP_ENCRYPTION_KEY (64 hex characters, from openssl rand -hex 32), pass --encrypt to
dump, and set the same key to verify or restore. Store the key apart from the backups; lose it and they are unreadable.

After a restore run \`npm run indexes\` (or indexes:prod) to rebuild the indexes.`;

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const args = rest.filter((a) => !a.startsWith('--'));
  const flag = (name: string) => rest.includes(`--${name}`);
  const value = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };

  const key = parseBackupKey(process.env['BACKUP_ENCRYPTION_KEY']);
  if (flag('encrypt') && !key) throw new Error('--encrypt needs BACKUP_ENCRYPTION_KEY to be set.');

  if (command === 'verify') {
    if (!args[0]) throw new Error(USAGE);
    const report = await verifyBackup(path.resolve(args[0]), key);
    console.log(
      report.ok
        ? `OK: ${report.collections} collections, ${report.documents} documents, checksums match.`
        : `NOT OK:\n - ${report.problems.join('\n - ')}`,
    );
    return report.ok ? 0 : 1;
  }

  if (command !== 'dump' && command !== 'restore' && command !== 'compare') {
    console.log(USAGE);
    return command ? 1 : 0;
  }

  const env = loadEnv();
  await connectMongo(env);
  try {
    const db = mongoose.connection.db!;
    if (command === 'dump') {
      const dir = path.resolve(args[0] ?? `backup-${stamp()}`);
      const m = await dumpDatabase(db, dir, new Date(), flag('encrypt') ? key : undefined);
      const total = m.collections.reduce((s, c) => s + c.documents, 0);
      console.log(
        `Backed up "${m.database}": ${m.collections.length} collections, ${total} documents -> ${dir}${m.encrypted ? ' (encrypted)' : ''}`,
      );
      const check = await verifyBackup(dir, flag('encrypt') ? key : undefined);
      console.log(
        check.ok ? 'Verified: checksums match.' : `PROBLEM: ${check.problems.join('; ')}`,
      );
      return check.ok ? 0 : 1;
    }
    if (command === 'restore') {
      if (!args[0]) throw new Error(USAGE);
      const into = value('into');
      // The database name must be typed out, so a restore can never hit the wrong database by accident.
      if (into !== db.databaseName) {
        throw new Error(
          `Restoring needs --into ${db.databaseName} (the database MONGODB_URI connects to). You gave ${into ?? 'nothing'}.`,
        );
      }
      const r = await restoreDatabase(db, path.resolve(args[0]), {
        force: flag('force'),
        ...(key ? { key } : {}),
      });
      console.log(
        `Restored ${r.collections} collections, ${r.documents} documents into "${db.databaseName}".`,
      );
      console.log('Now run: npm run indexes');
      return 0;
    }
    // compare
    if (!args[0] || !args[1]) throw new Error(USAGE);
    const client = mongoose.connection.getClient();
    const result = await compareDatabases(client.db(args[0]), client.db(args[1]));
    console.log(
      result.same
        ? 'IDENTICAL: same collections, counts and contents.'
        : `DIFFERENT:\n - ${result.differences.join('\n - ')}`,
    );
    return result.same ? 0 : 1;
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
