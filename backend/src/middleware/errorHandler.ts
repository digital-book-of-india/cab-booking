import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from '../common/errors';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', 'Route not found.'));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let appErr: AppError;
    if (err instanceof AppError) {
      appErr = err;
    } else if (err instanceof ZodError) {
      appErr = new AppError(
        'VALIDATION_ERROR',
        undefined,
        err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    } else if (err?.type === 'entity.parse.failed') {
      appErr = new AppError('VALIDATION_ERROR', 'Malformed JSON body.');
    } else if (err?.type === 'entity.too.large') {
      appErr = new AppError('VALIDATION_ERROR', 'Request body too large.');
    } else {
      appErr = new AppError('INTERNAL_ERROR');
      logger.error({ err, requestId: req.id }, 'unhandled error');
    }
    if (res.headersSent) return;
    res.status(appErr.status).json({
      success: false,
      error: {
        code: appErr.code,
        message: appErr.message,
        fieldErrors: appErr.fieldErrors,
        requestId: req.id,
      },
    });
  };
}
