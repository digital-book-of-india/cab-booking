/**
 * Test Suite: Idempotency Utility (DEV 2 / Task 2)
 */
import {
  generateUUID,
  getIdempotencyKey,
  clearIdempotencyKey,
  createIdempotencyHeader,
  IDEMPOTENCY_HEADER,
} from '../lib/idempotency';

export function runIdempotencyTests(): {
  name: string;
  passed: number;
  failed: number;
  results: Array<{ name: string; status: 'PASS' | 'FAIL'; message: string }>;
} {
  const results: Array<{ name: string; status: 'PASS' | 'FAIL'; message: string }> = [];

  function assert(name: string, condition: boolean, message: string) {
    results.push({ name, status: condition ? 'PASS' : 'FAIL', message });
  }

  // 1. UUID v4 Format
  const uuid = generateUUID();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert('UUID v4 Format', uuidRegex.test(uuid), `Generated UUID "${uuid}" conforms to RFC 4122 v4`);

  // 2. Uniqueness
  const set = new Set<string>();
  for (let i = 0; i < 50; i++) {
    set.add(generateUUID());
  }
  assert('UUID Uniqueness', set.size === 50, 'Generated 50 unique UUIDs without collision');

  // 3. Retry Preservation (Same logical operation must retain identical key)
  const op = 'refund';
  const entity = 'booking_999';
  const key1 = getIdempotencyKey(op, entity);
  const key2 = getIdempotencyKey(op, entity);
  assert(
    'Retry Preservation',
    key1 === key2,
    `Key preserved across retries: ${key1}`
  );

  // 4. Distinction Across Different Operations
  const keyDifferentEntity = getIdempotencyKey(op, 'booking_1000');
  assert(
    'Distinct Entity Operation',
    key1 !== keyDifferentEntity,
    'Different entity produces a distinct idempotency key'
  );

  const keyDifferentOp = getIdempotencyKey('cash_deposit', entity);
  assert(
    'Distinct Operation Type',
    key1 !== keyDifferentOp,
    'Different operation prefix produces a distinct idempotency key'
  );

  // 5. Force New Operation (Explicitly starting a brand new operation)
  const keyForcedNew = getIdempotencyKey(op, entity, true);
  assert(
    'Force New Key Generation',
    key1 !== keyForcedNew,
    'forceNew generates a new key for a genuine new transaction attempt'
  );

  // 6. Header Generation
  const headers = createIdempotencyHeader(op, entity);
  assert(
    'Header Emission',
    headers[IDEMPOTENCY_HEADER] === keyForcedNew,
    `createIdempotencyHeader outputs standard header "${IDEMPOTENCY_HEADER}" with the registered key`
  );

  // 7. Cleanup
  clearIdempotencyKey(op, entity);
  const keyAfterClear = getIdempotencyKey(op, entity);
  assert(
    'Registry Cleanup',
    keyAfterClear !== keyForcedNew,
    'clearIdempotencyKey purges cache so subsequent call starts fresh'
  );
  clearIdempotencyKey(op, entity);

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;

  return { name: 'Idempotency Utility Tests', passed, failed, results };
}
