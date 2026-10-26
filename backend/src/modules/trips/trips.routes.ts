import { Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h, paged } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  createPackageSchema,
  createRateSchema,
  nearQuerySchema,
  packageListQuerySchema,
  preferencesSchema,
  rateListQuerySchema,
  updatePackageSchema,
  updateRateSchema,
  type TripsService,
} from './trips.service';

const id = z.string().pipe(objectId);

/** Rental packages, outstation rates and driver preferences for long trips. */
export function tripsRouter(ctx: ModuleContext, trips: TripsService): Router {
  const r = Router();
  const config = [ctx.authenticate, requireRole('CONFIG_ADMIN', 'SUPER_ADMIN')];
  const viewers = [ctx.authenticate, requireRole('CONFIG_ADMIN', 'OPS', 'FINANCE', 'SUPER_ADMIN')];
  const rider = [ctx.authenticate, requireRole('CUSTOMER')];
  const driver = [ctx.authenticate, requireRole('DRIVER')];

  r.post(
    '/admin/rental-packages',
    ...config,
    h(async (req) => ({
      data: await trips.createPackage(actorFrom(req), createPackageSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/admin/rental-packages',
    ...viewers,
    h(async (req) => paged(await trips.listPackages(packageListQuerySchema.parse(req.query)))),
  );
  r.patch(
    '/admin/rental-packages/:packageId',
    ...config,
    h(async (req) => ({
      data: await trips.updatePackage(
        actorFrom(req),
        id.parse(req.params['packageId']),
        updatePackageSchema.parse(req.body),
      ),
    })),
  );

  r.post(
    '/admin/outstation-rates',
    ...config,
    h(async (req) => ({
      data: await trips.createRate(actorFrom(req), createRateSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/admin/outstation-rates',
    ...viewers,
    h(async (req) => paged(await trips.listRates(rateListQuerySchema.parse(req.query)))),
  );
  r.patch(
    '/admin/outstation-rates/:rateId',
    ...config,
    h(async (req) => ({
      data: await trips.updateRate(
        actorFrom(req),
        id.parse(req.params['rateId']),
        updateRateSchema.parse(req.body),
      ),
    })),
  );

  r.get(
    '/rental-packages',
    ...rider,
    h(async (req) => ({ data: await trips.packagesNear(nearQuerySchema.parse(req.query)) })),
  );
  r.get(
    '/outstation/options',
    ...rider,
    h(async (req) => ({
      data: await trips.outstationOptions(
        nearQuerySchema.omit({ categoryId: true }).parse(req.query),
      ),
    })),
  );

  r.get(
    '/drivers/me/preferences',
    ...driver,
    h(async (req) => ({ data: await trips.getPreferences(actorFrom(req).userId) })),
  );
  r.patch(
    '/drivers/me/preferences',
    ...driver,
    h(async (req) => ({
      data: await trips.setPreferences(actorFrom(req).userId, preferencesSchema.parse(req.body)),
    })),
  );
  return r;
}
