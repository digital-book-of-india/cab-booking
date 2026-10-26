import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { objectId } from '../../common/zod';
import {
  applicationSchema,
  approvalSchema,
  documentReviewSchema,
  documentSchema,
  driverListQuerySchema,
} from './drivers.schemas';
import type { DriversService } from './drivers.service';

export function createDriversController(service: DriversService) {
  const submitApplication: RequestHandler = async (req, res) => {
    const input = applicationSchema.parse(req.body);
    ok(res, await service.submitApplication(actorFrom(req).userId, input), 201);
  };

  const getApplication: RequestHandler = async (req, res) => {
    ok(res, await service.getApplication(actorFrom(req).userId));
  };

  const addDocument: RequestHandler = async (req, res) => {
    const input = documentSchema.parse(req.body);
    ok(res, await service.addDocument(actorFrom(req).userId, input), 201);
  };

  const confirmUpload: RequestHandler = async (req, res) => {
    ok(res, await service.confirmUpload(actorFrom(req).userId, String(req.params['documentId'])));
  };

  const listDocuments: RequestHandler = async (req, res) => {
    ok(res, await service.listDocuments(actorFrom(req).userId));
  };

  const list: RequestHandler = async (req, res) => {
    const { items, meta } = await service.list(driverListQuerySchema.parse(req.query));
    ok(res, items, 200, meta);
  };

  const detail: RequestHandler = async (req, res) => {
    const driverId = objectId.parse(req.params['driverId']);
    ok(res, await service.detail(actorFrom(req), driverId));
  };

  const decide: RequestHandler = async (req, res) => {
    const driverId = objectId.parse(req.params['driverId']);
    const input = approvalSchema.parse(req.body);
    ok(res, await service.decide(actorFrom(req), driverId, input));
  };

  const reviewDocument: RequestHandler = async (req, res) => {
    const driverId = objectId.parse(req.params['driverId']);
    const documentId = objectId.parse(req.params['documentId']);
    const input = documentReviewSchema.parse(req.body);
    ok(res, await service.reviewDocument(actorFrom(req), driverId, documentId, input));
  };

  return {
    submitApplication,
    getApplication,
    addDocument,
    confirmUpload,
    listDocuments,
    list,
    detail,
    decide,
    reviewDocument,
  };
}
