/**
 * Ledger accounts. Entries use debit = positive, credit = negative, and every transaction sums to
 * zero. A balance is simply the sum of the entries on that account.
 *
 *   GATEWAY                 money Razorpay holds for us after a successful online payment
 *   PLATFORM_BANK           our own bank: driver cash deposits in (+), payouts to drivers out (-)
 *   COMMISSION              our earnings from rides and fees (credit, so negative)
 *   RIDER_RECEIVABLE:<id>   what a rider owes us (positive); negative = we hold their credit
 *   DRIVER_PAYABLE:<id>     what we owe a driver (credit, so negative)
 *   DRIVER_CASH:<id>        cash a driver has collected from riders and not yet handed over
 *   WALLET:<id>             a rider's wallet (credit, so negative = the balance we hold for them)
 *   CORPORATE_RECEIVABLE:<id> what a company owes us for rides billed to it (positive)
 *   TAX_PAYABLE             tax we have charged on invoices and must pass on (credit, so negative)
 *   REFUNDS / WRITE_OFFS / WAIVED_FEES / PROMOTIONS   money the platform gave up (promotions = coupon discounts)
 */
export const Accounts = {
  gateway: 'GATEWAY',
  bank: 'PLATFORM_BANK',
  commission: 'COMMISSION',
  refunds: 'REFUNDS',
  writeOffs: 'WRITE_OFFS',
  waivedFees: 'WAIVED_FEES',
  promotions: 'PROMOTIONS',
  riderReceivable: (customerId: string) => `RIDER_RECEIVABLE:${customerId}`,
  wallet: (customerId: string) => `WALLET:${customerId}`,
  taxPayable: 'TAX_PAYABLE',
  corporateReceivable: (companyId: string) => `CORPORATE_RECEIVABLE:${companyId}`,
  driverPayable: (driverId: string) => `DRIVER_PAYABLE:${driverId}`,
  driverCash: (driverId: string) => `DRIVER_CASH:${driverId}`,
} as const;
