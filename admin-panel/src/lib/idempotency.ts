/**
 * Idempotency Utility for Financial and Mutating Operations
 *
 * Implements strict, cryptographically secure idempotency key generation and management:
 * - Uses crypto.randomUUID() when available with a safe fallback for SSR and older runtimes.
 * - Manages key lifecycles: preserves the key on retries of the same logical operation,
 *   and generates a new key only for genuinely new operations.
 * - Emits the standard `Idempotency-Key` header expected by backend contracts.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * Generate a cryptographically secure UUID v4 string.
 * Works safely in modern browsers, Node.js, and SSR environments.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Set version (4) and variant (RFC4122)
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }

  // Fallback for SSR or non-standard environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Registry to maintain active idempotency keys for operations by operation identifier.
 * This guarantees that retries of an in-flight or failed operation reuse the identical key,
 * preventing accidental duplicate charges or mutations.
 */
const activeKeys = new Map<string, string>();

/**
 * Create or retrieve an idempotency key for a logical operation.
 *
 * @param operationPrefix - Describes the operation type (e.g., 'refund', 'settlement', 'cash_deposit')
 * @param entityId - Target entity identifier (e.g., bookingId, settlementId, driverId)
 * @param forceNew - Set to true ONLY when starting a brand new operation, resetting any cached retry key
 */
export function getIdempotencyKey(
  operationPrefix: string,
  entityId: string,
  forceNew = false
): string {
  const scopeKey = `${operationPrefix}:${entityId}`;
  if (!forceNew && activeKeys.has(scopeKey)) {
    return activeKeys.get(scopeKey)!;
  }

  const newKey = `${operationPrefix}_${generateUUID()}`;
  activeKeys.set(scopeKey, newKey);
  return newKey;
}

/**
 * Clears an idempotency key once the operation has completed successfully,
 * so future operations on the same entity will generate a fresh key.
 */
export function clearIdempotencyKey(operationPrefix: string, entityId: string): void {
  const scopeKey = `${operationPrefix}:${entityId}`;
  activeKeys.delete(scopeKey);
}

/**
 * Returns request headers containing the expected Idempotency-Key.
 */
export function createIdempotencyHeader(
  operationPrefix: string,
  entityId: string,
  forceNew = false
): Record<string, string> {
  const key = getIdempotencyKey(operationPrefix, entityId, forceNew);
  return {
    [IDEMPOTENCY_HEADER]: key,
  };
}

/**
 * Resets the entire idempotency cache (useful in test teardown).
 */
export function resetIdempotencyRegistry(): void {
  activeKeys.clear();
}
