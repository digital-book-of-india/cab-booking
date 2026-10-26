const fs = require('fs');

// 1. public/mockServiceWorker.js
{
  const p = 'admin-panel/public/mockServiceWorker.js';
  let c = fs.readFileSync(p, 'utf8');
  if (c.startsWith('/* eslint-disable */\r\n')) {
    c = c.replace('/* eslint-disable */\r\n', '');
  } else if (c.startsWith('/* eslint-disable */\n')) {
    c = c.replace('/* eslint-disable */\n', '');
  }
  fs.writeFileSync(p, c, 'utf8');
  console.log('Fixed public/mockServiceWorker.js');
}

// 2. ride.handlers.ts
{
  const p = 'admin-panel/src/mocks/handlers/ride.handlers.ts';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace('let mockLiveDrivers: LiveDriverLocation[] = [', 'const mockLiveDrivers: LiveDriverLocation[] = [');
  fs.writeFileSync(p, c, 'utf8');
  console.log('Fixed ride.handlers.ts');
}

// 3. pricing.handlers.ts
{
  const p = 'admin-panel/src/mocks/handlers/pricing.handlers.ts';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace('let mockPricingConfigs: PricingConfig[] = [', 'const mockPricingConfigs: PricingConfig[] = [');
  fs.writeFileSync(p, c, 'utf8');
  console.log('Fixed pricing.handlers.ts');
}

// 4. finance.handlers.ts
{
  const p = 'admin-panel/src/mocks/handlers/finance.handlers.ts';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace('let mockReconciliations: GatewayReconciliationItem[] = [', 'const mockReconciliations: GatewayReconciliationItem[] = [');
  c = c.replace('let mockSettlements: SettlementBatch[] = [', 'const mockSettlements: SettlementBatch[] = [');
  c = c.replace('let mockLedger: LedgerEntry[] = [', 'const mockLedger: LedgerEntry[] = [');

  // Fix any and unused body
  c = c.replace(
    'import { PaymentAttempt, GatewayReconciliationItem, SettlementBatch, LedgerEntry, OutstandingBalanceItem, CashCollectionDiscrepancy } from \'@/types\';',
    'import { PaymentAttempt, GatewayReconciliationItem, SettlementBatch, LedgerEntry, OutstandingBalanceItem, CashCollectionDiscrepancy } from \'@/types\';'
  );
  c = c.replace('status: body.action as any', 'status: body.action as CashCollectionDiscrepancy[\'status\']');
  c = c.replace(
    'const body = (await request.json()) as { reasonCode: string; notes?: string };',
    'const _body = (await request.json()) as { reasonCode: string; notes?: string };\r\n    void _body;'
  );

  fs.writeFileSync(p, c, 'utf8');
  console.log('Fixed finance.handlers.ts');
}

// 5. governance.handlers.ts
{
  const p = 'admin-panel/src/mocks/handlers/governance.handlers.ts';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(
    'import { FeatureFlag, RbacUserItem, AuditLogEntry, SystemHealthData } from \'@/types\';',
    'import { FeatureFlag, RbacUserItem, AuditLogEntry, Role } from \'@/types\';'
  );
  c = c.replace('let mockAuditLogs: AuditLogEntry[] = [', 'const mockAuditLogs: AuditLogEntry[] = [');
  c = c.replace('const body = (await request.json()) as { role: any };', 'const body = (await request.json()) as { role: Role };');
  fs.writeFileSync(p, c, 'utf8');
  console.log('Fixed governance.handlers.ts');
}

// 6. operations.handlers.ts
{
  const p = 'admin-panel/src/mocks/handlers/operations.handlers.ts';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace('let mockInvoices: CorporateInvoice[] = [', 'const mockInvoices: CorporateInvoice[] = [');
  c = c.replace('let mockCoupons: CouponItem[] = [', 'const mockCoupons: CouponItem[] = [');

  c = c.replace(
    'import { SosIncident, SupportTicket, ReviewRatingItem, CorporateAccount, CorporateInvoice, CouponItem } from \'@/types\';',
    'import { SosIncident, SupportTicket, ReviewRatingItem, CorporateAccount, CorporateInvoice, CouponItem, AccountStatus } from \'@/types\';'
  );
  c = c.replace('resolutionCategory: any;', 'resolutionCategory: string;');
  c = c.replace('moderationStatus: any;', 'moderationStatus: ReviewRatingItem[\'moderationStatus\'];');
  c = c.replace('status: any;', 'status: AccountStatus;');

  fs.writeFileSync(p, c, 'utf8');
  console.log('Fixed operations.handlers.ts');
}

// 7. driver.handlers.ts
{
  const p = 'admin-panel/src/mocks/handlers/driver.handlers.ts';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace(
    'import { DriverApprovalStatus, DriverDetail, VehicleRecord, VehicleVerificationStatus, CabCategory } from \'@/types\';',
    'import { DriverApprovalStatus, DriverDetail, VehicleRecord, VehicleVerificationStatus, CabCategory } from \'@/types\';'
  );
  c = c.replace('approvalStatus: body.approvalStatus as any', 'approvalStatus: body.approvalStatus as DriverApprovalStatus');
  c = c.replace('verificationStatus: body.status as any', 'verificationStatus: body.status as VehicleVerificationStatus');
  fs.writeFileSync(p, c, 'utf8');
  console.log('Fixed driver.handlers.ts');
}
