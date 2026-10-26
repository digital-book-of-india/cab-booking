/** PLACEHOLDER money policies until the lead decides. Tests override them through createApp. */
export type FinanceConfig = {
  /** Used when no commission rate is configured for the zone. 2000 = 20.00%. */
  defaultCommissionBp: number;
  /** A rider with an unpaid ride older than this cannot book again. */
  unpaidGraceMs: number;
  /** A driver holding more cash (net of what we owe them) than this cannot go online. */
  driverCashLimitPaise: number;
  /** An online payment that was started but never finished is closed after this long. */
  paymentOrderTtlMs: number;
  /** Accrual / payment follow-up work waits this long before the repair job touches it. */
  reconcileGraceMs: number;
  /** A rider may tip for this long after a ride is completed. */
  tipWindowMs: number;
  tipMinPaise: number;
  tipMaxPaise: number;
  /** Wallet limits (a closed wallet: money goes in by top-up or refund and out only by paying for rides and tips). */
  walletMinTopupPaise: number;
  walletMaxTopupPaise: number;
  walletMaxBalancePaise: number;
  /** Wallet top-up bonus: this share (basis points, 500 = 5%) of a top-up, 0 = off. */
  walletBonusBp: number;
  /** A top-up must be at least this much to earn the bonus... */
  walletBonusMinTopupPaise: number;
  /** ...and the bonus is never more than this. */
  walletBonusMaxPaise: number;
  /**
   * Tax added to a company invoice, in basis points (1800 = 18%). 0 = no tax. PLACEHOLDER: the
   * right rate, what it applies to, and who is the supplier must come from an accountant.
   */
  invoiceTaxBp: number;
  invoiceTaxLabel: string;
  /**
   * Tax (GST) added ON TOP of every ride fare, in basis points (500 = 5%). The rider pays fare + tax;
   * driver pay, commission and coupons are worked out on the fare before tax; the tax is held in
   * TAX_PAYABLE for the tax office. 0 = no tax. PLACEHOLDER: confirm the rate with an accountant.
   */
  rideTaxBp: number;
  /**
   * Tax charged on the platform's commission, in basis points (1800 = 18%). The driver bears it: it is
   * taken out of their share and held in TAX_PAYABLE; the platform keeps its full commission. 0 = none.
   */
  commissionTaxBp: number;
  /** Who the invoice is from (printed on it). */
  seller: { name: string; gstin: string | null; address: string | null; sacCode: string | null };
  /** Pay out an approved settlement automatically (a background job), instead of waiting for finance. */
  autoPayouts: boolean;
};

export const defaultFinanceConfig: FinanceConfig = {
  defaultCommissionBp: 2000,
  unpaidGraceMs: 24 * 3_600_000,
  driverCashLimitPaise: 200_000,
  paymentOrderTtlMs: 30 * 60_000,
  reconcileGraceMs: 30_000,
  tipWindowMs: 24 * 3_600_000,
  tipMinPaise: 1000,
  tipMaxPaise: 200_000,
  walletMinTopupPaise: 5000,
  walletMaxTopupPaise: 500_000,
  walletMaxBalancePaise: 1_000_000,
  autoPayouts: false,
  invoiceTaxBp: 0,
  rideTaxBp: 0,
  commissionTaxBp: 0,
  invoiceTaxLabel: 'GST',
  seller: { name: 'Cab Booking Platform', gstin: null, address: null, sacCode: null },
  walletBonusBp: 0,
  walletBonusMinTopupPaise: 50_000,
  walletBonusMaxPaise: 10_000,
};
