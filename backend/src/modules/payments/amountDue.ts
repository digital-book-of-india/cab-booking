type Owing = {
  status: string;
  paymentStatus?: string | null;
  finalFarePaise?: number | null;
  fee?: { amountPaise: number; status: string } | null;
};

/** What a booking is worth to us, regardless of whether it is paid yet: a fare or a DUE fee. */
export function amountOwed(b: Owing): { amountPaise: number; purpose: 'FARE' | 'FEE' } | null {
  if (b.status === 'COMPLETED' && b.finalFarePaise) {
    return { amountPaise: b.finalFarePaise, purpose: 'FARE' };
  }
  if (['CANCELLED', 'NO_SHOW'].includes(b.status) && b.fee && b.fee.status !== 'WAIVED') {
    return { amountPaise: b.fee.amountPaise, purpose: 'FEE' };
  }
  return null;
}

/** What the rider can pay right now: only while the booking is waiting for payment. */
export function amountDue(b: Owing): { amountPaise: number; purpose: 'FARE' | 'FEE' } | null {
  if (!['DUE', 'FAILED'].includes(b.paymentStatus ?? '')) return null;
  return amountOwed(b);
}
