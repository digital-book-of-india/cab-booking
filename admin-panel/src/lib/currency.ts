export function formatPaiseToInr(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new TypeError(`Expected integer paise, received: ${paise}`);
  }
  const isNegative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}₹${whole.toLocaleString('en-IN')}.${fraction}`;
}

export function parseInrInputToPaise(input: string): number {
  const clean = input.trim().replace(/,/g, '');
  const validPattern = /^-?\d+(\.\d{1,2})?$/;
  if (!validPattern.test(clean)) {
    throw new Error(`Invalid currency input format: "${input}". Expected format: 250 or 250.50`);
  }

  const isNegative = clean.startsWith('-');
  const unsigned = isNegative ? clean.slice(1) : clean;
  const [wholePart, fractionPart = ''] = unsigned.split('.');
  const whole = parseInt(wholePart, 10);
  const fraction = parseInt(fractionPart.padEnd(2, '0').slice(0, 2), 10);
  const total = whole * 100 + fraction;

  if (!Number.isSafeInteger(total)) {
    throw new Error('Input amount exceeds maximum safe integer limits.');
  }

  return total === 0 ? 0 : (isNegative ? -total : total);
}

export function formatToIST(utcIsoString: string): string {
  if (!utcIsoString) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(utcIsoString));
}
