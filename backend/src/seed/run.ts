import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../config/db';
import { loadEnv } from '../config/env';
import { createAuthService } from '../modules/auth/auth.service';
import { authConfigFromEnv } from '../modules/auth/auth.config';
import { createLogger } from '../common/logger';
import { createProviders } from '../providers';
import { createAuditService } from '../modules/audit/audit.service';
import { createStaffAuthService } from '../modules/staffauth/staffauth.service';
import { User } from '../modules/users/user.model';
import { normalizePhone } from '../common/phone';
import { seedAll } from './seed';

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env);
  const result = await seedAll({ adminPhone: process.env['SEED_ADMIN_PHONE'] });
  console.log('Seed complete:', result);

  // The first super admin has no password yet: print a one-time setup link (valid 3 days).
  const adminEmail = process.env['SEED_ADMIN_EMAIL'];
  const adminPhone = normalizePhone(process.env['SEED_ADMIN_PHONE'] ?? '');
  if (adminEmail && adminPhone) {
    const admin = await User.findOne({ phone: adminPhone });
    if (admin) {
      const logger = createLogger('warn');
      const providers = createProviders(env);
      const cfg = authConfigFromEnv(env);
      const staffAuth = createStaffAuthService({
        hashSecret: cfg.hashSecret,
        staffRefreshTtlHours: cfg.staffRefreshTtlHours,
        portalUrl: env.STAFF_PORTAL_URL,
        auth: createAuthService(cfg, providers, logger),
        email: providers.email,
        audit: createAuditService(),
        now: () => new Date(),
        logger,
      });
      const { token } = await staffAuth.issueInvite(admin.id, adminEmail.trim().toLowerCase());
      console.log(
        `First admin setup link (one time, valid 3 days):\n  ${env.STAFF_PORTAL_URL.replace(/\/$/, '')}/staff/setup?token=${token}`,
      );
    }
  }
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
