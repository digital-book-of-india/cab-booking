import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import type { AuditService } from '../audit/audit.service';
import { CabCategory } from './cabCategory.model';
import type { CreateCategoryInput, UpdateCategoryInput } from './categories.schemas';

type CategoryLean = {
  _id: { toString(): string };
  code: string;
  name: string;
  capacity: number;
  displayOrder?: number | null;
  active?: boolean | null;
};

export function toCategoryView(c: CategoryLean) {
  return {
    id: c._id.toString(),
    code: c.code,
    name: c.name,
    capacity: c.capacity,
    displayOrder: c.displayOrder ?? 0,
    active: c.active ?? true,
  };
}

export function createCategoriesService(deps: { audit: AuditService }) {
  return {
    /** Public: customers and drivers see active categories only. */
    async listActive() {
      const rows = await CabCategory.find({ active: true })
        .sort({ displayOrder: 1, name: 1 })
        .lean();
      return rows.map(toCategoryView);
    },

    async listAll() {
      const rows = await CabCategory.find().sort({ displayOrder: 1, name: 1 }).lean();
      return rows.map(toCategoryView);
    },

    async create(actor: Actor, input: CreateCategoryInput) {
      try {
        const created = await CabCategory.create(input);
        await deps.audit.record(actor, {
          action: 'category.create',
          targetType: 'CabCategory',
          targetId: created.id,
          metadata: { code: created.code },
        });
        return toCategoryView(created.toObject());
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          throw new AppError('CONFLICT', 'A category with this code already exists.');
        }
        throw err;
      }
    },

    async update(actor: Actor, id: string, input: UpdateCategoryInput) {
      const updated = await CabCategory.findByIdAndUpdate(id, input, {
        returnDocument: 'after',
      }).lean();
      if (!updated) throw new AppError('NOT_FOUND');
      await deps.audit.record(actor, {
        action: 'category.update',
        targetType: 'CabCategory',
        targetId: id,
        metadata: { fields: Object.keys(input) },
      });
      return toCategoryView(updated);
    },
  };
}

export type CategoriesService = ReturnType<typeof createCategoriesService>;
