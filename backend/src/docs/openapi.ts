/**
 * OpenAPI document, generated from the route list in ./routes.ts so docs and Postman stay in sync.
 */
import { routes, type RouteDoc } from './routes';

const errorEnvelope = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        fieldErrors: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, message: { type: 'string' } },
          },
        },
        requestId: { type: 'string' },
      },
    },
  },
} as const;

const errorRef = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
});

function operation(r: RouteDoc) {
  const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  const query = Object.keys(r.query ?? {}).map((name) => ({
    name,
    in: 'query',
    required: false,
    schema: { type: 'string' },
  }));
  const headerParams = Object.keys(r.headers ?? {}).map((name) => ({
    name,
    in: 'header',
    required: true,
    schema: { type: 'string' },
  }));
  const isPublic = r.auth === 'public';
  const roles = isPublic ? [] : (r.auth as string[]);
  return {
    tags: [r.tag],
    summary: r.summary,
    ...(isPublic ? {} : { security: [{ bearerAuth: [] }] }),
    ...(roles.length ? { description: `Allowed roles: ${roles.join(', ')}` } : {}),
    parameters: [...params, ...query, ...headerParams],
    ...(r.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' }, example: r.body } },
          },
        }
      : {}),
    responses: {
      '200': {
        description: 'Success',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      '400': errorRef('Validation error'),
      ...(isPublic ? {} : { '401': errorRef('Unauthenticated'), '403': errorRef('Forbidden') }),
      '409': errorRef('Conflict'),
      '429': errorRef('Rate limited'),
    },
  };
}

const paths: Record<string, Record<string, unknown>> = {};
for (const r of routes) {
  (paths[r.path] ??= {})[r.method] = operation(r);
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: { title: 'Cab Booking Platform API', version: '1.0.0' },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: { ErrorEnvelope: errorEnvelope },
  },
  paths,
};
