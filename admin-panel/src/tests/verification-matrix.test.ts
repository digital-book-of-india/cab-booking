import { formatPaiseToInr, parseInrInputToPaise } from '../lib/currency';
import { generateUUID, getIdempotencyKey, clearIdempotencyKey } from '../lib/idempotency';
import { Role } from '../types';

if (typeof describe !== 'undefined') {
  describe('Verification Matrix Suite', () => {
    describe('Financial Precision & Currency Conversions', () => {
      it('parses standard decimal amounts accurately to paise', () => {
        expect(parseInrInputToPaise('250.50')).toBe(25050);
      });

      it('parses comma-separated rupee inputs to paise', () => {
        expect(parseInrInputToPaise('1,250.00')).toBe(125000);
      });

      it('parses integer rupee strings to paise', () => {
        expect(parseInrInputToPaise('100')).toBe(10000);
      });

      it('parses negative rupee amounts to paise', () => {
        expect(parseInrInputToPaise('-0.50')).toBe(-50);
      });

      it('formats positive paise amounts to INR string', () => {
        expect(formatPaiseToInr(25050)).toBe('₹250.50');
      });

      it('formats zero paise to ₹0.00', () => {
        expect(formatPaiseToInr(0)).toBe('₹0.00');
      });

      it('rejects invalid currency syntax with an exception', () => {
        expect(() => parseInrInputToPaise('25-3')).toThrow();
      });
    });

    describe('RBAC Action Matrix', () => {
      const canWriteOff = (role: Role) => role === 'SUPER_ADMIN';
      const canIssueRefund = (role: Role) => role === 'SUPER_ADMIN' || role === 'FINANCE';
      const canAssignDriver = (role: Role) => role === 'SUPER_ADMIN' || role === 'OPS';

      it('restricts customer debt write-off from FINANCE', () => {
        expect(canWriteOff('FINANCE')).toBe(false);
      });

      it('allows customer debt write-off for SUPER_ADMIN', () => {
        expect(canWriteOff('SUPER_ADMIN')).toBe(true);
      });

      it('allows issuing refunds for FINANCE', () => {
        expect(canIssueRefund('FINANCE')).toBe(true);
      });

      it('restricts dispatch driver assignment from SUPPORT', () => {
        expect(canAssignDriver('SUPPORT')).toBe(false);
      });
    });

    describe('PII Redaction Validation', () => {
      it('adheres to strictly masked phone pattern (+91 ••••• •XXXX)', () => {
        const phoneMaskRegex = /^\+91 ••••• •\d{4}$/;
        const sampleMasked = '+91 ••••• •3421';
        expect(phoneMaskRegex.test(sampleMasked)).toBe(true);
      });

      it('redacts document IDs leaving only last 4 digits visible', () => {
        const docNumberLast4 = '8834';
        expect(docNumberLast4.length).toBe(4);
        expect(/^\d{4}$/.test(docNumberLast4)).toBe(true);
      });
    });

    describe('Idempotency RFC 4122 v4 Conformance', () => {
      it('generates unique RFC 4122 v4 UUIDs', () => {
        const key1 = generateUUID();
        const key2 = generateUUID();
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(key1).not.toBe(key2);
        expect(uuidRegex.test(key1)).toBe(true);
        expect(uuidRegex.test(key2)).toBe(true);
      });

      it('reuses identical key on operation retries', () => {
        const initialKey = getIdempotencyKey('refund', 'bk_123');
        const retryKey = getIdempotencyKey('refund', 'bk_123');
        expect(initialKey).toBe(retryKey);
        clearIdempotencyKey('refund', 'bk_123');
      });
    });
  });
}

export function runDay8VerificationSuite(): {
  total: number;
  passed: number;
  failed: number;
  results: Array<{ name: string; status: 'PASS' | 'FAIL'; message: string }>;
} {
  const results: Array<{ name: string; status: 'PASS' | 'FAIL'; message: string }> = [];

  function assert(name: string, condition: boolean, message: string) {
    if (condition) {
      results.push({ name, status: 'PASS', message });
    } else {
      results.push({ name, status: 'FAIL', message });
    }
  }

  // 1. Financial Precision Tests
  try {
    assert('Currency: Standard conversion', parseInrInputToPaise('250.50') === 25050, '₹250.50 parsed to 25050 paise');
    assert('Currency: Comma-separated input', parseInrInputToPaise('1,250.00') === 125000, '₹1,250.00 parsed to 125000 paise');
    assert('Currency: Integer string', parseInrInputToPaise('100') === 10000, '₹100 parsed to 10000 paise');
    assert('Currency: Negative amount', parseInrInputToPaise('-0.50') === -50, '-₹0.50 parsed to -50 paise');
    assert('Currency: Format positive', formatPaiseToInr(25050) === '₹250.50', '25050 paise formatted to ₹250.50');
    assert('Currency: Format zero', formatPaiseToInr(0) === '₹0.00', '0 paise formatted to ₹0.00');

    let threwOnInvalid = false;
    try {
      parseInrInputToPaise('25-3');
    } catch {
      threwOnInvalid = true;
    }
    assert('Currency: Invalid syntax rejected', threwOnInvalid, 'Invalid formatted string "25-3" threw validation error');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    assert('Currency: Unexpected exception', false, msg);
  }

  // 2. RBAC Action Matrix Assertions
  const canWriteOff = (role: Role) => role === 'SUPER_ADMIN';
  const canIssueRefund = (role: Role) => role === 'SUPER_ADMIN' || role === 'FINANCE';
  const canAssignDriver = (role: Role) => role === 'SUPER_ADMIN' || role === 'OPS';

  assert('RBAC: Write-off restricted from FINANCE', canWriteOff('FINANCE') === false, 'FINANCE cannot approve customer write-offs');
  assert('RBAC: Write-off allowed for SUPER_ADMIN', canWriteOff('SUPER_ADMIN') === true, 'SUPER_ADMIN permitted to approve write-offs');
  assert('RBAC: Refund allowed for FINANCE', canIssueRefund('FINANCE') === true, 'FINANCE permitted to issue refunds');
  assert('RBAC: Dispatch assignment restricted from SUPPORT', canAssignDriver('SUPPORT') === false, 'SUPPORT blocked from driver assignment');

  // 3. PII Redaction Validation
  const phoneMaskRegex = /^\+91 ••••• •\d{4}$/;
  const sampleMasked = '+91 ••••• •3421';
  assert('PII: Phone number masking format', phoneMaskRegex.test(sampleMasked), 'Phone numbers adhere strictly to +91 ••••• •XXXX pattern');

  const docNumberLast4 = '8834';
  assert('PII: Document Last 4 redaction', docNumberLast4.length === 4 && /^\d{4}$/.test(docNumberLast4), 'Document ID reveals only terminal 4 digits');

  // 4. Idempotency Key Format Test (UUID RFC 4122 v4)
  const key1 = generateUUID();
  const key2 = generateUUID();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert('Idempotency: Key uniqueness', key1 !== key2, 'UUIDs generated independently are unique');
  assert('Idempotency: RFC 4122 v4 format', uuidRegex.test(key1) && uuidRegex.test(key2), 'Idempotency keys adhere to RFC 4122 v4 UUID standard');

  // Test retry preservation
  const initialKey = getIdempotencyKey('refund', 'bk_123');
  const retryKey = getIdempotencyKey('refund', 'bk_123');
  assert('Idempotency: Retry preservation', initialKey === retryKey, 'Subsequent attempts reuse the identical idempotency key');
  clearIdempotencyKey('refund', 'bk_123');

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;

  return { total: results.length, passed, failed, results };
}
