import { ServiceZone } from '../zones/serviceZone.model';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { CabCategory } from '../categories/cabCategory.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import type { ZonesService } from '../zones/zones.service';
import { OutstationRate, RentalPackage } from './trips.models';

const DUPLICATE_KEY = 11000;
const paise = z.number().int().min(0).max(1_000_000_000);

/* ---------------- input ---------------- */

export const createPackageSchema = z
  .object({
    zoneId: objectId,
    categoryId: objectId,
    name: z.string().trim().min(2).max(60),
    hours: z.number().int().min(1).max(24),
    includedKm: z.number().int().min(1).max(1000),
    pricePaise: z.number().int().min(100).max(1_000_000_000),
    extraKmPaise: paise,
    extraHourPaise: paise,
  })
  .strict();
// Hours and kilometres define the package: to change them, make a new package.
export const updatePackageSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    pricePaise: z.number().int().min(100).max(1_000_000_000).optional(),
    extraKmPaise: paise.optional(),
    extraHourPaise: paise.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });
export const packageListQuerySchema = paginationSchema.extend({
  zoneId: objectId.optional(),
  categoryId: objectId.optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const createRateSchema = z
  .object({
    zoneId: objectId,
    categoryId: objectId,
    oneWayPerKmPaise: z.number().int().min(1).max(10_000_000),
    roundTripPerKmPaise: z.number().int().min(1).max(10_000_000),
    minKmPerDay: z.number().int().min(0).max(1000).default(250),
    driverAllowancePerNightPaise: paise.default(0),
    minimumFarePaise: paise.default(0),
    minKm: z.number().int().min(1).max(1000).default(80),
    maxKm: z.number().int().min(1).max(5000).default(1500),
  })
  .strict()
  .refine((v) => v.maxKm > v.minKm, { message: 'maxKm must be above minKm', path: ['maxKm'] });
export const updateRateSchema = z
  .object({
    oneWayPerKmPaise: z.number().int().min(1).max(10_000_000).optional(),
    roundTripPerKmPaise: z.number().int().min(1).max(10_000_000).optional(),
    minKmPerDay: z.number().int().min(0).max(1000).optional(),
    driverAllowancePerNightPaise: paise.optional(),
    minimumFarePaise: paise.optional(),
    minKm: z.number().int().min(1).max(1000).optional(),
    maxKm: z.number().int().min(1).max(5000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });
export const rateListQuerySchema = paginationSchema.extend({
  zoneId: objectId.optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
export const nearQuerySchema = z.object({ lat, lng, categoryId: objectId.optional() });
export const preferencesSchema = z
  .object({ acceptsRentals: z.boolean().optional(), acceptsOutstation: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

/* ---------------- views ---------------- */

type PackageLean = {
  _id: Types.ObjectId;
  zoneId: Types.ObjectId;
  categoryId: Types.ObjectId;
  name: string;
  hours: number;
  includedKm: number;
  pricePaise: number;
  extraKmPaise: number;
  extraHourPaise: number;
  active: boolean;
};
export const packageView = (p: PackageLean) => ({
  packageId: p._id.toString(),
  zoneId: p.zoneId.toString(),
  categoryId: p.categoryId.toString(),
  name: p.name,
  hours: p.hours,
  includedKm: p.includedKm,
  pricePaise: p.pricePaise,
  extraKmPaise: p.extraKmPaise,
  extraHourPaise: p.extraHourPaise,
  active: p.active,
});

type RateLean = {
  _id: Types.ObjectId;
  zoneId: Types.ObjectId;
  categoryId: Types.ObjectId;
  oneWayPerKmPaise: number;
  roundTripPerKmPaise: number;
  minKmPerDay: number;
  driverAllowancePerNightPaise: number;
  minimumFarePaise: number;
  minKm: number;
  maxKm: number;
  active: boolean;
};
export const rateView = (r: RateLean) => ({
  rateId: r._id.toString(),
  zoneId: r.zoneId.toString(),
  categoryId: r.categoryId.toString(),
  oneWayPerKmPaise: r.oneWayPerKmPaise,
  roundTripPerKmPaise: r.roundTripPerKmPaise,
  minKmPerDay: r.minKmPerDay,
  driverAllowancePerNightPaise: r.driverAllowancePerNightPaise,
  minimumFarePaise: r.minimumFarePaise,
  minKm: r.minKm,
  maxKm: r.maxKm,
  active: r.active,
});

/** Rental packages, outstation rates, and which long trips a driver accepts. */
export function createTripsService(deps: {
  audit: AuditService;
  zones: Pick<ZonesService, 'locate'>;
}) {
  const { audit, zones } = deps;

  async function assertZoneAndCategory(zoneId: string, categoryId: string) {
    const [zone, category] = await Promise.all([
      ServiceZone.exists({ _id: zoneId }),
      CabCategory.exists({ _id: categoryId }),
    ]);
    if (!zone)
      throw new AppError('UNPROCESSABLE', undefined, [
        { field: 'zoneId', message: 'Unknown zone' },
      ]);
    if (!category)
      throw new AppError('UNPROCESSABLE', undefined, [
        { field: 'categoryId', message: 'Unknown cab category' },
      ]);
  }

  return {
    /* ---- used when pricing a quote ---- */
    async rentalPackage(id: string) {
      return RentalPackage.findOne({ _id: id }).lean();
    },
    async outstationRate(zoneId: Types.ObjectId | string, categoryId: Types.ObjectId | string) {
      return OutstationRate.findOne({ zoneId, categoryId, active: true }).lean();
    },

    /* ---- staff: rental packages ---- */
    async createPackage(actor: Actor, input: z.infer<typeof createPackageSchema>) {
      await assertZoneAndCategory(input.zoneId, input.categoryId);
      const p = await RentalPackage.create({ ...input, createdBy: actor.userId });
      await audit.record(actor, {
        action: 'trips.package.create',
        targetType: 'RentalPackage',
        targetId: p.id,
        metadata: { name: p.name, pricePaise: p.pricePaise },
      });
      return packageView(p.toObject() as unknown as PackageLean);
    },
    async listPackages(q: z.infer<typeof packageListQuerySchema>) {
      const filter: Record<string, unknown> = {};
      if (q.zoneId) filter['zoneId'] = q.zoneId;
      if (q.categoryId) filter['categoryId'] = q.categoryId;
      if (q.active !== undefined) filter['active'] = q.active;
      const [total, rows] = await Promise.all([
        RentalPackage.countDocuments(filter),
        RentalPackage.find(filter)
          .sort({ zoneId: 1, categoryId: 1, hours: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
      ]);
      return {
        items: rows.map((r) => packageView(r as unknown as PackageLean)),
        meta: pageMeta(q.page, q.limit, total),
      };
    },
    async updatePackage(actor: Actor, id: string, input: z.infer<typeof updatePackageSchema>) {
      const p = await RentalPackage.findOneAndUpdate(
        { _id: id },
        { $set: input },
        { returnDocument: 'after' },
      ).lean();
      if (!p) throw new AppError('NOT_FOUND');
      await audit.record(actor, {
        action: 'trips.package.update',
        targetType: 'RentalPackage',
        targetId: id,
        metadata: { ...input },
      });
      return packageView(p as unknown as PackageLean);
    },

    /* ---- staff: outstation rates ---- */
    async createRate(actor: Actor, input: z.infer<typeof createRateSchema>) {
      await assertZoneAndCategory(input.zoneId, input.categoryId);
      try {
        const r = await OutstationRate.create({ ...input, createdBy: actor.userId });
        await audit.record(actor, {
          action: 'trips.rate.create',
          targetType: 'OutstationRate',
          targetId: r.id,
          metadata: {
            oneWayPerKmPaise: r.oneWayPerKmPaise,
            roundTripPerKmPaise: r.roundTripPerKmPaise,
          },
        });
        return rateView(r.toObject() as unknown as RateLean);
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          throw new AppError(
            'CONFLICT',
            'This zone and cab category already have outstation rates. Edit them instead.',
          );
        }
        throw err;
      }
    },
    async listRates(q: z.infer<typeof rateListQuerySchema>) {
      const filter: Record<string, unknown> = {};
      if (q.zoneId) filter['zoneId'] = q.zoneId;
      if (q.active !== undefined) filter['active'] = q.active;
      const [total, rows] = await Promise.all([
        OutstationRate.countDocuments(filter),
        OutstationRate.find(filter)
          .sort({ zoneId: 1, categoryId: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
      ]);
      return {
        items: rows.map((r) => rateView(r as unknown as RateLean)),
        meta: pageMeta(q.page, q.limit, total),
      };
    },
    async updateRate(actor: Actor, id: string, input: z.infer<typeof updateRateSchema>) {
      const current = await OutstationRate.findById(id).lean();
      if (!current) throw new AppError('NOT_FOUND');
      const minKm = input.minKm ?? current.minKm;
      const maxKm = input.maxKm ?? current.maxKm;
      if (maxKm <= minKm) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'maxKm', message: 'maxKm must be above minKm' },
        ]);
      }
      const r = await OutstationRate.findOneAndUpdate(
        { _id: id },
        { $set: input },
        { returnDocument: 'after' },
      ).lean();
      await audit.record(actor, {
        action: 'trips.rate.update',
        targetType: 'OutstationRate',
        targetId: id,
        metadata: { ...input },
      });
      return rateView(r as unknown as RateLean);
    },

    /* ---- riders: what is on offer here ---- */
    async packagesNear(q: z.infer<typeof nearQuerySchema>) {
      const zone = await zones.locate(q.lat, q.lng);
      if (!zone) return { zoneId: null, packages: [] };
      const rows = await RentalPackage.find({
        zoneId: zone._id,
        active: true,
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      })
        .sort({ categoryId: 1, hours: 1 })
        .lean();
      return {
        zoneId: zone._id.toString(),
        packages: rows.map((r) => packageView(r as unknown as PackageLean)),
      };
    },
    async outstationOptions(q: { lat: number; lng: number }) {
      const zone = await zones.locate(q.lat, q.lng);
      if (!zone) return { zoneId: null, options: [] };
      const rates = await OutstationRate.find({ zoneId: zone._id, active: true }).lean();
      const cats = new Map(
        (
          await CabCategory.find({
            _id: { $in: rates.map((r) => r.categoryId) },
            active: true,
          }).lean()
        ).map((c) => [c._id.toString(), c]),
      );
      return {
        zoneId: zone._id.toString(),
        options: rates.flatMap((r) => {
          const c = cats.get(r.categoryId.toString());
          return c
            ? [
                {
                  ...rateView(r as unknown as RateLean),
                  categoryName: c.name,
                  categoryCode: c.code,
                },
              ]
            : [];
        }),
      };
    },

    /* ---- drivers: which long trips they take ---- */
    async getPreferences(userId: string) {
      const p = await requireDriverProfile(userId);
      return {
        acceptsRentals: p.acceptsRentals !== false,
        acceptsOutstation: p.acceptsOutstation === true,
      };
    },
    async setPreferences(userId: string, input: z.infer<typeof preferencesSchema>) {
      const p = await requireDriverProfile(userId);
      const updated = await DriverProfile.findOneAndUpdate(
        { _id: p._id },
        { $set: input },
        { returnDocument: 'after' },
      );
      return {
        acceptsRentals: updated!.acceptsRentals !== false,
        acceptsOutstation: updated!.acceptsOutstation === true,
      };
    },
  };
}

export type TripsService = ReturnType<typeof createTripsService>;
