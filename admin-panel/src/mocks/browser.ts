import { setupWorker } from 'msw/browser';
import { authHandlers } from './handlers/auth.handlers';
import { driverHandlers } from './handlers/driver.handlers';
import { rideHandlers } from './handlers/ride.handlers';
import { pricingHandlers } from './handlers/pricing.handlers';
import { financeHandlers } from './handlers/finance.handlers';
import { governanceHandlers } from './handlers/governance.handlers';
import { operationsHandlers } from './handlers/operations.handlers';

export const worker = setupWorker(
  ...authHandlers,
  ...driverHandlers,
  ...rideHandlers,
  ...pricingHandlers,
  ...financeHandlers,
  ...governanceHandlers,
  ...operationsHandlers
);