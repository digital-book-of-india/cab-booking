import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { Roles, type Role } from '../../common/enums';
import { AppError } from '../../common/errors';
import type { AuditService } from '../audit/audit.service';
import { FeatureFlag } from './featureFlag.model';

/** Every switch the apps and the server know about. Unknown keys are refused, so typos cannot hide a feature. */
export const FLAG_KEYS = [
  'SOS',
  'TRIP_SHARING',
  'SUPPORT_TICKETS',
  'RATINGS',
  'COUPONS',
  'TIPS',
  'WALLET',
  'CORPORATE',
  'REFERRALS',
] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];
export type FlagDefaults = Record<FlagKey, boolean>;

export const setFlagSchema = z
  .object({
    enabled: z.boolean(),
    roles: z.array(z.enum(Roles)).max(10).optional(),
    description: z.string().trim().max(200).optional(),
  })
  .strict();
export const flagKeySchema = z.enum(FLAG_KEYS);
export type SetFlagInput = z.infer<typeof setFlagSchema>;

const CACHE_MS = 5000;

export function createFlagsService(deps: { audit: AuditService; defaults: FlagDefaults }) {
  let cache: { at: number; rows: Map<string, { enabled: boolean; roles: string[] }> } | null = null;

  async function load() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
    const rows = new Map(
      (await FeatureFlag.find().lean()).map((f) => [f.key, { enabled: f.enabled, roles: f.roles }]),
    );
    cache = { at: Date.now(), rows };
    return rows;
  }

  const resolve = (
    key: FlagKey,
    role: Role | undefined,
    rows: Map<string, { enabled: boolean; roles: string[] }>,
  ) => {
    const row = rows.get(key);
    if (!row) return deps.defaults[key];
    if (!row.enabled) return false;
    return row.roles.length === 0 || (role !== undefined && row.roles.includes(role));
  };

  return {
    async isEnabled(key: FlagKey, role?: Role): Promise<boolean> {
      return resolve(key, role, await load());
    },

    /** Used before running a feature: refuses with FEATURE_DISABLED when it is switched off for this role. */
    async assertEnabled(key: FlagKey, role?: Role): Promise<void> {
      if (!(await this.isEnabled(key, role))) throw new AppError('FEATURE_DISABLED');
    },

    /** What the caller's app should show: every flag, resolved for their role. */
    async forRole(role: Role): Promise<Record<FlagKey, boolean>> {
      const rows = await load();
      return Object.fromEntries(FLAG_KEYS.map((k) => [k, resolve(k, role, rows)])) as Record<
        FlagKey,
        boolean
      >;
    },

    /** Forget what was read (tests wipe the collection behind the service's back). */
    invalidate() {
      cache = null;
    },

    async list() {
      cache = null;
      const rows = new Map((await FeatureFlag.find().lean()).map((f) => [f.key, f]));
      return FLAG_KEYS.map((key) => {
        const row = rows.get(key);
        return {
          key,
          enabled: row ? row.enabled : deps.defaults[key],
          roles: row?.roles ?? [],
          description: row?.description ?? null,
          source: row ? 'STAFF' : 'DEFAULT',
          updatedAt: row?.updatedAt ?? null,
        };
      });
    },

    async set(actor: Actor, key: FlagKey, input: SetFlagInput) {
      const row = await FeatureFlag.findOneAndUpdate(
        { key },
        {
          enabled: input.enabled,
          roles: input.roles ?? [],
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedBy: actor.userId,
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      cache = null;
      await deps.audit.record(actor, {
        action: 'flag.set',
        targetType: 'FeatureFlag',
        targetId: key,
        metadata: { enabled: input.enabled, roles: input.roles ?? [] },
      });
      return { key, enabled: row.enabled, roles: row.roles, description: row.description ?? null };
    },
  };
}

export type FlagsService = ReturnType<typeof createFlagsService>;
