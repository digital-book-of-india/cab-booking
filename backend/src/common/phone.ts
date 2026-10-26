import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Normalise to E.164 (default region IN). Returns null when invalid. */
export function normalizePhone(input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, 'IN');
  return parsed && parsed.isValid() ? parsed.number : null;
}
