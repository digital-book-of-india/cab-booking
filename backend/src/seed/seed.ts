import { AppError } from '../common/errors';
import { normalizePhone } from '../common/phone';
import { CabCategory } from '../modules/categories/cabCategory.model';
import { User } from '../modules/users/user.model';
import { FareConfig } from '../modules/pricing/fareConfig.model';
import { ServiceZone } from '../modules/zones/serviceZone.model';

/** Starter categories. Capacity/order are placeholders until the lead confirms the real list. */
export const DEFAULT_CATEGORIES = [
  { code: 'MINI', name: 'Mini', capacity: 4, displayOrder: 1 },
  { code: 'SEDAN', name: 'Sedan', capacity: 4, displayOrder: 2 },
  { code: 'SUV', name: 'SUV', capacity: 6, displayOrder: 3 },
] as const;

/**
 * Placeholder service area: a rough box around Delhi NCR. Replace with the real boundary via
 * PATCH /admin/zones/:id once the lead confirms the pilot area.
 */
export const DEFAULT_ZONE = {
  code: 'DELHI_NCR',
  name: 'Delhi NCR',
  cityCode: 'DEL',
  polygon: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [76.84, 28.4],
        [77.55, 28.4],
        [77.55, 28.88],
        [76.84, 28.88],
        [76.84, 28.4],
      ],
    ],
  },
};

/** Placeholder rates (paise). Real prices come from the lead; change via POST /admin/pricing/configs. */
export const DEFAULT_RATES: Record<
  string,
  { base: number; perKm: number; perMin: number; min: number }
> = {
  MINI: { base: 4000, perKm: 1200, perMin: 150, min: 10000 },
  SEDAN: { base: 5000, perKm: 1400, perMin: 175, min: 12000 },
  SUV: { base: 7000, perKm: 1800, perMin: 200, min: 15000 },
};

/** Idempotent: safe to run repeatedly. Never overwrites edits made later via the admin API. */
export async function seedAll(opts: { adminPhone?: string } = {}): Promise<{
  categories: number;
  zones: number;
  fareConfigs: number;
  adminCreated: boolean;
}> {
  let categories = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const res = await CabCategory.updateOne(
      { code: c.code },
      { $setOnInsert: c },
      { upsert: true },
    );
    categories += res.upsertedCount;
  }

  const zoneRes = await ServiceZone.updateOne(
    { code: DEFAULT_ZONE.code },
    { $setOnInsert: DEFAULT_ZONE },
    { upsert: true },
  );
  const zone = await ServiceZone.findOne({ code: DEFAULT_ZONE.code }).lean();

  // First fare version per (zone, category) only; never overwrites later admin versions.
  let fareConfigs = 0;
  for (const cat of await CabCategory.find({ code: { $in: Object.keys(DEFAULT_RATES) } }).lean()) {
    const rates = DEFAULT_RATES[cat.code]!;
    const res = await FareConfig.updateOne(
      { zoneId: zone!._id, categoryId: cat._id, version: 1 },
      {
        $setOnInsert: {
          zoneId: zone!._id,
          categoryId: cat._id,
          version: 1,
          baseFarePaise: rates.base,
          perKmPaise: rates.perKm,
          perMinutePaise: rates.perMin,
          minimumFarePaise: rates.min,
          freeWaitingSeconds: 180,
          waitingPerMinutePaise: 200,
          roundingMode: 'NEAREST_RUPEE',
          effectiveFrom: new Date(),
          changeReason: 'Seed placeholder pricing',
        },
      },
      { upsert: true },
    );
    fareConfigs += res.upsertedCount;
  }

  let adminCreated = false;
  if (opts.adminPhone) {
    const phone = normalizePhone(opts.adminPhone);
    if (!phone)
      throw new AppError('VALIDATION_ERROR', 'SEED_ADMIN_PHONE is not a valid phone number.');
    const res = await User.updateOne(
      { phone },
      {
        $setOnInsert: {
          phone,
          role: 'SUPER_ADMIN',
          name: 'Super Admin',
          phoneVerifiedAt: new Date(),
        },
      },
      { upsert: true },
    );
    adminCreated = res.upsertedCount === 1;
  }
  return { categories, zones: zoneRes.upsertedCount, fareConfigs, adminCreated };
}
