/**
 * Generates postman/ collection + environment template from src/docs/routes.ts.
 * Run: npm run postman
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { routes } from '../src/docs/routes';

const outDir = join(__dirname, '..', '..', 'postman');
mkdirSync(outDir, { recursive: true });

const toPostmanPath = (p: string) => p.replace(/\{(\w+)\}/g, '{{$1}}');

const tags = [...new Set(routes.map((r) => r.tag))];

const collection = {
  info: {
    name: 'Cab Booking Platform API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description:
      'Generated from backend/src/docs/routes.ts (run `npm run postman`). Login flow: OTP request -> OTP verify (stores tokens).',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
  variable: [
    { key: 'accessToken', value: '' },
    { key: 'refreshToken', value: '' },
    { key: 'challengeId', value: '' },
    { key: 'quoteId', value: '' },
    { key: 'bookingId', value: '' },
    { key: 'offerId', value: '' },
    { key: 'rideId', value: '' },
    { key: 'pickupOtp', value: '' },
  ],
  item: tags.map((tag) => ({
    name: tag,
    item: routes
      .filter((r) => r.tag === tag)
      .map((r) => ({
        name: `${r.method.toUpperCase()} ${r.path} - ${r.summary}`,
        request: {
          method: r.method.toUpperCase(),
          auth: r.auth === 'public' ? { type: 'noauth' } : undefined,
          header: [
            ...(r.body ? [{ key: 'Content-Type', value: 'application/json' }] : []),
            ...Object.entries(r.headers ?? {}).map(([key, value]) => ({ key, value })),
          ],
          url: {
            raw: `{{baseUrl}}${toPostmanPath(r.path)}`,
            host: ['{{baseUrl}}'],
            path: toPostmanPath(r.path).split('/').filter(Boolean),
            query: Object.entries(r.query ?? {}).map(([key, value]) => ({
              key,
              value,
              disabled: value === '',
            })),
          },
          body: r.body
            ? {
                mode: 'raw',
                raw: JSON.stringify(r.body, null, 2),
                options: { raw: { language: 'json' } },
              }
            : undefined,
        },
        event: r.postmanTest
          ? [{ listen: 'test', script: { type: 'text/javascript', exec: [r.postmanTest] } }]
          : undefined,
      })),
  })),
};

const environment = {
  name: 'Cab Booking - Local (template)',
  values: [
    { key: 'baseUrl', value: 'http://localhost:4000/api/v1', enabled: true },
    { key: 'categoryId', value: '', enabled: true },
    { key: 'driverId', value: '', enabled: true },
    { key: 'documentId', value: '', enabled: true },
    { key: 'vehicleId', value: '', enabled: true },
    { key: 'sessionId', value: '', enabled: true },
    { key: 'zoneId', value: '', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

writeFileSync(
  join(outDir, 'cab-booking.postman_collection.json'),
  JSON.stringify(collection, null, 2) + '\n',
);
writeFileSync(
  join(outDir, 'local.postman_environment.json'),
  JSON.stringify(environment, null, 2) + '\n',
);
console.log(`Wrote ${routes.length} requests to ${outDir}`);
