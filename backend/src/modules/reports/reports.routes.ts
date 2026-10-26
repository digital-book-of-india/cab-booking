import { Router, type Request } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import type { Role } from '../../common/enums';
import { h } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  ExportKinds,
  csvCell,
  rangeQuerySchema,
  type ExportKind,
  type ReportsService,
} from './reports.service';

const REPORT_ROLES: Role[] = ['OPS', 'FINANCE', 'SUPER_ADMIN'];
const MONEY_ROLES: Role[] = ['FINANCE', 'SUPER_ADMIN'];
const kindSchema = z.enum(ExportKinds);

/** Numbers and downloads for operations and finance. Every download is audited. */
export function reportsRouter(ctx: ModuleContext, reports: ReportsService): Router {
  const r = Router();

  r.get(
    '/admin/reports/summary',
    ctx.authenticate,
    requireRole(...REPORT_ROLES),
    h(async (req) => ({ data: await reports.summary(rangeQuerySchema.parse(req.query)) })),
  );

  // The ride list is for operations too; money lists are for finance only.
  const exportAccess = (req: Request): Role[] =>
    String(req.params['kind']).replace(/\.csv$/, '') === 'rides' ? REPORT_ROLES : MONEY_ROLES;

  r.get(
    '/admin/exports/:kind',
    ctx.authenticate,
    (req, res, next) => requireRole(...exportAccess(req))(req, res, next),
    async (req, res) => {
      const kind = kindSchema.parse(String(req.params['kind']).replace(/\.csv$/, '')) as ExportKind;
      const file = await reports.prepareExport(
        actorFrom(req),
        kind,
        rangeQuerySchema.parse(req.query),
      );
      res.status(200);
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
      res.write(`${file.headers.join(',')}\n`);
      for await (const row of file.rows) res.write(`${row.map(csvCell).join(',')}\n`);
      res.end();
    },
  );
  return r;
}
