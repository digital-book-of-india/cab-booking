import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { STAFF_ROLES, type Role } from '../../common/enums';
import { AppError } from '../../common/errors';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { normalizePhone } from '../../common/phone';
import type { RealtimeBus } from '../../realtime/bus';
import type { AuditService } from '../audit/audit.service';
import { Session } from '../auth/session.model';
import type { StaffAuthService } from '../staffauth/staffauth.service';
import { User } from '../users/user.model';

const staffRole = z.enum(STAFF_ROLES as [string, ...string[]]);

export const createStaffSchema = z
  .object({
    phone: z.string().trim().min(8).max(20),
    name: z.string().trim().min(2).max(100),
    role: staffRole,
    // Give them an email login (password + authenticator) straight away: they get a setup link.
    email: z.string().trim().toLowerCase().pipe(z.email().max(160)).optional(),
  })
  .strict();

export const changeRoleSchema = z
  .object({ role: staffRole, reason: z.string().trim().min(3).max(300) })
  .strict();

export const staffListQuerySchema = paginationSchema.extend({
  role: staffRole.optional(),
  accountStatus: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export type StaffListQuery = z.infer<typeof staffListQuerySchema>;

const view = (u: {
  _id: { toString(): string };
  phone: string;
  name?: string | null;
  role: string;
  accountStatus: string;
  createdAt: Date;
}) => ({
  userId: u._id.toString(),
  phone: u.phone,
  name: u.name ?? null,
  role: u.role,
  accountStatus: u.accountStatus,
  createdAt: u.createdAt,
});

/**
 * Staff accounts. Only a super admin manages them, and never their own: nobody can promote
 * themselves or remove their own access. Accounts are made by phone number; the person then logs
 * in with the usual OTP.
 */
export function createStaffService(deps: {
  audit: AuditService;
  now: () => Date;
  bus?: Pick<RealtimeBus, 'disconnectUser'>;
  credentials?: Pick<StaffAuthService, 'invite' | 'statusFor'>;
}) {
  const { audit, now, bus, credentials } = deps;

  return {
    async list(query: StaffListQuery) {
      const filter: Record<string, unknown> = { role: query.role ?? { $in: STAFF_ROLES } };
      if (query.accountStatus) filter['accountStatus'] = query.accountStatus;
      const [total, rows] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      const logins = credentials
        ? await credentials.statusFor(rows.map((r) => r._id.toString()))
        : new Map<string, { email: string; mfaEnabled: boolean }>();
      return {
        items: rows.map((u) => ({
          ...view(u),
          login: logins.get(u._id.toString()) ?? null,
        })),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    async create(actor: Actor, input: CreateStaffInput) {
      const phone = normalizePhone(input.phone);
      if (!phone) {
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'phone', message: 'Invalid phone number' },
        ]);
      }
      try {
        const created = await User.create({
          phone,
          name: input.name,
          role: input.role as Role,
          phoneVerifiedAt: now(),
        });
        await audit.record(actor, {
          action: 'staff.create',
          targetType: 'User',
          targetId: created.id,
          metadata: { role: input.role },
        });
        if (input.email && credentials)
          await credentials.invite(actor, created.id, { email: input.email });
        return view(created.toObject());
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          throw new AppError('CONFLICT', 'An account with this phone number already exists.');
        }
        throw err;
      }
    },

    async changeRole(actor: Actor, userId: string, input: ChangeRoleInput) {
      if (userId === actor.userId) {
        throw new AppError('UNPROCESSABLE', 'You cannot change your own role.');
      }
      const target = await User.findById(userId);
      if (!target) throw new AppError('NOT_FOUND');
      if (!STAFF_ROLES.includes(target.role as never)) {
        throw new AppError('UNPROCESSABLE', 'Only staff accounts can be given a staff role here.');
      }
      if (target.role === input.role)
        throw new AppError('CONFLICT', 'The account already has this role.');

      const previous = target.role;
      // Conditional on the role we read, so two admins acting at once cannot both "win".
      const updated = await User.findOneAndUpdate(
        { _id: target._id, role: previous },
        { role: input.role as Role },
        { returnDocument: 'after' },
      );
      if (!updated) throw new AppError('CONFLICT', 'The account changed; reload and retry.');
      // The new role applies to every request at once; live connections are rebuilt with it.
      await Session.updateMany({ userId: target._id, revokedAt: null }, { revokedAt: now() });
      bus?.disconnectUser(userId, 'ROLE_CHANGED');
      await audit.record(actor, {
        action: 'staff.role_change',
        targetType: 'User',
        targetId: userId,
        metadata: { from: previous, to: input.role, reason: input.reason },
      });
      return view(updated.toObject());
    },
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
