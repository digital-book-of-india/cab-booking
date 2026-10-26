import { isValidObjectId } from 'mongoose';
import { AppError } from '../../common/errors';
import { User } from '../users/user.model';
import { CustomerProfile } from './customerProfile.model';
import { SavedPlace, savedPlaceView } from './savedPlace.model';
import type {
  CreateSavedPlaceInput,
  UpdateCustomerInput,
  UpdateSavedPlaceInput,
} from './customers.schemas';

export const MAX_SAVED_PLACES = 20;

export function createCustomersService() {
  async function getProfile(userId: string) {
    const [user, profile] = await Promise.all([
      User.findById(userId).lean(),
      CustomerProfile.findOne({ userId }).lean(),
    ]);
    if (!user) throw new AppError('NOT_FOUND');
    return {
      id: user._id.toString(),
      phone: user.phone,
      name: user.name ?? null,
      email: profile?.email ?? null,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
    };
  }

  return {
    getProfile,

    async updateProfile(userId: string, input: UpdateCustomerInput) {
      if (input.name !== undefined) await User.updateOne({ _id: userId }, { name: input.name });
      if (input.email !== undefined) {
        await CustomerProfile.updateOne(
          { userId },
          input.email === null ? { $unset: { email: 1 } } : { email: input.email },
          { upsert: true },
        );
      }
      return getProfile(userId);
    },

    async listSavedPlaces(customerId: string) {
      const rows = await SavedPlace.find({ customerId }).sort({ createdAt: -1 }).lean();
      return rows.map((r) => savedPlaceView(r));
    },

    async createSavedPlace(customerId: string, input: CreateSavedPlaceInput) {
      const count = await SavedPlace.countDocuments({ customerId });
      if (count >= MAX_SAVED_PLACES) {
        throw new AppError(
          'UNPROCESSABLE',
          `You have reached the maximum limit of ${MAX_SAVED_PLACES} saved places.`,
        );
      }
      const row = await SavedPlace.create({
        customerId,
        name: input.name,
        type: input.type,
        address: input.address,
        location: { type: 'Point', coordinates: [input.lng, input.lat] },
      });
      return savedPlaceView(row.toObject());
    },

    async updateSavedPlace(customerId: string, placeId: string, input: UpdateSavedPlaceInput) {
      if (!isValidObjectId(placeId)) {
        throw new AppError('NOT_FOUND', 'Saved place not found.');
      }
      const update: Record<string, unknown> = {};
      if (input.name !== undefined) update.name = input.name;
      if (input.type !== undefined) update.type = input.type;
      if (input.address !== undefined) update.address = input.address;
      if (input.lat !== undefined && input.lng !== undefined) {
        update.location = { type: 'Point', coordinates: [input.lng, input.lat] };
      }
      const row = await SavedPlace.findOneAndUpdate(
        { _id: placeId, customerId },
        update,
        { returnDocument: 'after' },
      );
      if (!row) throw new AppError('NOT_FOUND', 'Saved place not found.');
      return savedPlaceView(row.toObject());
    },

    async deleteSavedPlace(customerId: string, placeId: string) {
      if (!isValidObjectId(placeId)) {
        throw new AppError('NOT_FOUND', 'Saved place not found.');
      }
      const row = await SavedPlace.findOneAndDelete({ _id: placeId, customerId });
      if (!row) throw new AppError('NOT_FOUND', 'Saved place not found.');
      return { deleted: true };
    },
  };
}

export type CustomersService = ReturnType<typeof createCustomersService>;
