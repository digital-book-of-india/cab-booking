import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { toPoint } from '../../common/geo';
import type { AuditService } from '../audit/audit.service';
import { ServiceZone } from './serviceZone.model';
import type { CreateZoneInput, UpdateZoneInput } from './zones.schemas';

const IST_OFFSET_MINUTES = 330;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Is `at` inside the zone's daily window (Asia/Kolkata)? No window means always open. */
export function isWithinOperatingHours(
  hours: { start?: string | null; end?: string | null } | null | undefined,
  at: Date,
): boolean {
  if (!hours?.start || !hours.end) return true;
  const minuteOfDay = (at.getUTCHours() * 60 + at.getUTCMinutes() + IST_OFFSET_MINUTES) % 1440;
  const start = toMinutes(hours.start);
  const end = toMinutes(hours.end);
  if (start === end) return true;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

type ZoneLean = {
  _id: { toString(): string };
  code: string;
  name: string;
  cityCode: string;
  polygon: { type: string; coordinates: number[][][] };
  active?: boolean | null;
  operatingHours?: { start?: string | null; end?: string | null } | null;
};

export const zoneView = (raw: unknown) => zoneViewOf(raw as ZoneLean);

const zoneViewOf = (z: ZoneLean) => ({
  id: z._id.toString(),
  code: z.code,
  name: z.name,
  cityCode: z.cityCode,
  polygon: { type: z.polygon.type, coordinates: z.polygon.coordinates },
  active: z.active ?? true,
  operatingHours:
    z.operatingHours?.start && z.operatingHours.end
      ? { start: z.operatingHours.start, end: z.operatingHours.end }
      : null,
});

const GEO_ERROR = /geo keys|loop is not valid|edges .* cross|duplicate vertices|not closed/i;

function translateGeoError(err: unknown): never {
  if (err instanceof Error && GEO_ERROR.test(err.message)) {
    throw new AppError('UNPROCESSABLE', undefined, [
      { field: 'polygon', message: 'Polygon is not a valid, non-self-intersecting shape' },
    ]);
  }
  throw err;
}

export function createZonesService(deps: { audit: AuditService }) {
  return {
    async list() {
      const rows = await ServiceZone.find().sort({ createdAt: 1 }).lean();
      return rows.map(zoneView);
    },

    async create(actor: Actor, input: CreateZoneInput) {
      try {
        const created = await ServiceZone.create(input);
        await deps.audit.record(actor, {
          action: 'zone.create',
          targetType: 'ServiceZone',
          targetId: created.id,
          metadata: { code: created.code },
        });
        return zoneView(created.toObject());
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          throw new AppError('CONFLICT', 'A zone with this code already exists.');
        }
        return translateGeoError(err);
      }
    },

    async update(actor: Actor, id: string, input: UpdateZoneInput) {
      const { operatingHours, ...rest } = input;
      const update: Record<string, unknown> = { ...rest };
      if (operatingHours === null) update['$unset'] = { operatingHours: 1 };
      else if (operatingHours) update['operatingHours'] = operatingHours;
      try {
        const updated = await ServiceZone.findByIdAndUpdate(id, update, {
          returnDocument: 'after',
          runValidators: true,
        }).lean();
        if (!updated) throw new AppError('NOT_FOUND');
        await deps.audit.record(actor, {
          action: 'zone.update',
          targetType: 'ServiceZone',
          targetId: id,
          metadata: { fields: Object.keys(input) },
        });
        return zoneView(updated);
      } catch (err) {
        if (err instanceof AppError) throw err;
        return translateGeoError(err);
      }
    },

    /** The active zone containing this point, or null. */
    async locate(lat: number, lng: number) {
      return ServiceZone.findOne({
        active: true,
        polygon: { $geoIntersects: { $geometry: toPoint(lat, lng) } },
      })
        .sort({ createdAt: 1 })
        .lean();
    },
  };
}

export type ZonesService = ReturnType<typeof createZonesService>;
