import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export type SweepOptions = {
  /** The storage folder (UPLOAD_DIR): holds objects/, meta/ and tmp/. */
  dir: string;
  /** Every object key some document still points at. */
  referenced: ReadonlySet<string>;
  /** A file younger than this is left alone: an upload arrives before its document row exists. */
  minAgeMs: number;
  /** Delete for real. Without it nothing is touched. */
  apply?: boolean;
  now?: Date;
};

export type SweepReport = {
  orphans: { key: string; sizeBytes: number }[];
  abandonedTemp: { name: string; sizeBytes: number }[];
  freedBytes: number;
  deleted: boolean;
};

async function walk(root: string, rel = ''): Promise<string[]> {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  });
  const out: string[] = [];
  for (const e of entries) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, next)));
    else if (e.isFile()) out.push(next);
  }
  return out;
}

/**
 * Finds stored files no document refers to (a driver replaced a document, a row was deleted, an upload
 * was never registered) and half-written uploads left in tmp/. Dry run unless `apply` is set.
 */
export async function sweepUploads(options: SweepOptions): Promise<SweepReport> {
  const now = (options.now ?? new Date()).getTime();
  const objects = path.join(options.dir, 'objects');
  const metas = path.join(options.dir, 'meta');
  const tmp = path.join(options.dir, 'tmp');
  const old = async (file: string) => {
    const s = await stat(file);
    return now - s.mtimeMs >= options.minAgeMs ? s.size : null;
  };
  const gone = (err: unknown) => (err as NodeJS.ErrnoException).code === 'ENOENT';

  const orphans: SweepReport['orphans'] = [];
  for (const key of await walk(objects)) {
    if (options.referenced.has(key)) continue;
    const size = await old(path.join(objects, ...key.split('/')));
    if (size !== null) orphans.push({ key, sizeBytes: size });
  }
  const abandonedTemp: SweepReport['abandonedTemp'] = [];
  for (const name of await walk(tmp)) {
    const size = await old(path.join(tmp, ...name.split('/')));
    if (size !== null) abandonedTemp.push({ name, sizeBytes: size });
  }

  if (options.apply) {
    const remove = (file: string) =>
      unlink(file).catch((err) => {
        if (!gone(err)) throw err;
      });
    for (const o of orphans) {
      const parts = o.key.split('/');
      await remove(path.join(objects, ...parts));
      await remove(path.join(metas, ...parts.slice(0, -1), `${parts[parts.length - 1]}.json`));
    }
    for (const t of abandonedTemp) await remove(path.join(tmp, ...t.name.split('/')));
  }
  const freedBytes =
    orphans.reduce((n, o) => n + o.sizeBytes, 0) +
    abandonedTemp.reduce((n, t) => n + t.sizeBytes, 0);
  return { orphans, abandonedTemp, freedBytes, deleted: options.apply === true };
}
