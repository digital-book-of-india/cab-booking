import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { escapeRegex } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { CabCategory } from '../categories/cabCategory.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { User } from '../users/user.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import { Vehicle } from './vehicle.model';
import type { CreateVehicleInput, UpdateVehicleInput, VerificationInput } from './vehicles.schemas';

const MAX_VEHICLES = 5;

type VehicleLean = {
  _id: { toString(): string };
  categoryId: { toString(): string };
  registrationNumber: string;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  seats: number;
  verificationStatus?: string | null;
  rejectionReason?: string | null;
  active?: boolean | null;
};

const view = (v: VehicleLean) => ({
  id: v._id.toString(),
  categoryId: v.categoryId.toString(),
  registrationNumber: v.registrationNumber,
  make: v.make ?? null,
  model: v.model ?? null,
  color: v.color ?? null,
  seats: v.seats,
  verificationStatus: v.verificationStatus,
  rejectionReason: v.rejectionReason ?? null,
  active: v.active ?? true,
});

export function createVehiclesService(deps: { audit: AuditService }) {
  return {
    async create(userId: string, input: CreateVehicleInput) {
      const profile = await requireDriverProfile(userId);
      if ((await Vehicle.countDocuments({ driverId: profile._id })) >= MAX_VEHICLES) {
        throw new AppError('UNPROCESSABLE', 'Vehicle limit reached.');
      }
      const category = await CabCategory.findOne({ _id: input.categoryId, active: true }).lean();
      if (!category) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'categoryId', message: 'Unknown or inactive category' },
        ]);
      }
      try {
        const created = await Vehicle.create({ ...input, driverId: profile._id });
        return view(created.toObject());
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          throw new AppError('CONFLICT', 'A vehicle with this registration number already exists.');
        }
        throw err;
      }
    },

    async listOwn(userId: string) {
      const profile = await requireDriverProfile(userId);
      const rows = await Vehicle.find({ driverId: profile._id }).sort({ createdAt: -1 }).lean();
      return rows.map(view);
    },
    async listAdmin(query: { status?: string }) {
      const filter: Record<string, unknown> = {};
      if (query.status) {
        filter['verificationStatus'] = query.status;
      }
      const vehicles = await Vehicle.find(filter).sort({ createdAt: -1 }).lean();
      const driverProfileIds = vehicles.map((v) => v.driverId);
      const categoryIds = vehicles.map((v) => v.categoryId);

      const [driverProfiles, categories] = await Promise.all([
        DriverProfile.find({ _id: { $in: driverProfileIds } }).select('userId').lean(),
        CabCategory.find({ _id: { $in: categoryIds } }).select('name').lean(),
      ]);

      const userIds = driverProfiles.map((dp) => dp.userId);
      const users = await User.find({ _id: { $in: userIds } }).select('name phone').lean();

      const userMap = new Map(users.map((u) => [u._id.toString(), u]));
      const profileToUserMap = new Map(
        driverProfiles.map((dp) => [dp._id.toString(), userMap.get(dp.userId.toString())]),
      );
      const categoryMap = new Map(categories.map((c) => [c._id.toString(), c]));

      return vehicles.map((v) => {
        const user = profileToUserMap.get(v.driverId.toString());
        const cat = categoryMap.get(v.categoryId.toString());
        const makeModel = [v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
        return {
          id: v._id.toString(),
          driverId: v.driverId.toString(),
          driverName: user?.name || 'Driver Partner',
          driverPhone: user?.phone || '',
          categoryId: v.categoryId.toString(),
          categoryName: cat?.name || 'Cab',
          registrationNumber: v.registrationNumber,
          makeModel,
          make: v.make ?? null,
          model: v.model ?? null,
          color: v.color ?? null,
          seats: v.seats,
          verificationStatus: v.verificationStatus,
          rejectionReason: v.rejectionReason ?? null,
          createdAt: v.createdAt ? v.createdAt.toISOString() : new Date().toISOString(),
        };
      });
    },


    async updateOwn(userId: string, vehicleId: string, input: UpdateVehicleInput) {
      const profile = await requireDriverProfile(userId);
      // Scoped by driverId: another driver's vehicle is simply "not found".
      const updated = await Vehicle.findOneAndUpdate(
        { _id: vehicleId, driverId: profile._id },
        input,
        { returnDocument: 'after' },
      ).lean();
      if (!updated) throw new AppError('NOT_FOUND');
      return view(updated);
    },

    async verify(actor: Actor, vehicleId: string, input: VerificationInput) {
      let updated;
      try {
        updated = await Vehicle.findByIdAndUpdate(
          vehicleId,
          {
            verificationStatus: input.status,
            // A rejected vehicle no longer blocks its plate for a genuine registration.
            holdsRegistration: input.status !== 'REJECTED',
            ...(input.status === 'REJECTED'
              ? { rejectionReason: input.reason }
              : { $unset: { rejectionReason: 1 } }),
          },
          { returnDocument: 'after' },
        ).lean();
      } catch (err) {
        // Re-verifying a rejected vehicle whose plate someone else has since registered.
        if ((err as { code?: number }).code === 11000) {
          throw new AppError('CONFLICT', 'Another vehicle now holds this registration number.');
        }
        throw err;
      }
      if (!updated) throw new AppError('NOT_FOUND');
      await deps.audit.record(actor, {
        action: `vehicle.${input.status.toLowerCase()}`,
        targetType: 'Vehicle',
        targetId: vehicleId,
        metadata: { reason: input.reason },
      });
      return view(updated);
    },

    async listAll(query?: { verificationStatus?: string; q?: string }) {
      const filter: Record<string, unknown> = {};
      if (query?.verificationStatus) filter['verificationStatus'] = query.verificationStatus;
      if (query?.q) {
        filter['registrationNumber'] = new RegExp(escapeRegex(query.q), 'i');
      }
      const rows = await Vehicle.find(filter).sort({ createdAt: -1 }).limit(100).lean();
      return rows.map(view);
    },
  };
}

export type VehiclesService = ReturnType<typeof createVehiclesService>;
