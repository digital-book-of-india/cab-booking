import type { Model } from 'mongoose';

export type IndexReport = { model: string; collection: string; indexes: string[] };

/**
 * Creates every index declared in the schemas.
 *  - default: additive only (createIndexes). Never drops anything, safe to run on every release.
 *  - prune: also DROPS indexes that are no longer in a schema (syncIndexes). Use deliberately.
 */
export async function ensureIndexes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  models: Model<any>[],
  options: { prune?: boolean } = {},
): Promise<IndexReport[]> {
  const report: IndexReport[] = [];
  for (const m of models) {
    await m.createCollection().catch(() => undefined); // already exists is fine
    if (options.prune) await m.syncIndexes();
    else await m.createIndexes();
    const indexes = (await m.collection.indexes()).map((i) => String(i.name));
    report.push({ model: m.modelName, collection: m.collection.name, indexes });
  }
  return report;
}
