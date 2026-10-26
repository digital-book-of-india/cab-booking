import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { objectId } from '../../common/zod';
import { createCategorySchema, updateCategorySchema } from './categories.schemas';
import type { CategoriesService } from './categories.service';

export function createCategoriesController(service: CategoriesService) {
  const listActive: RequestHandler = async (_req, res) => {
    ok(res, await service.listActive());
  };

  const listAll: RequestHandler = async (_req, res) => {
    ok(res, await service.listAll());
  };

  const create: RequestHandler = async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    ok(res, await service.create(actorFrom(req), input), 201);
  };

  const update: RequestHandler = async (req, res) => {
    const id = objectId.parse(req.params['categoryId']);
    const input = updateCategorySchema.parse(req.body);
    ok(res, await service.update(actorFrom(req), id, input));
  };

  return { listActive, listAll, create, update };
}
