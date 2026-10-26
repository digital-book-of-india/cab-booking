import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { STAFF_ROLES } from '../../common/enums';
import { AppError } from '../../common/errors';
import type { AuditService } from '../audit/audit.service';
import { Session } from '../auth/session.model';
import { Booking } from '../bookings/booking.model';
import { Membership } from '../corporate/corporate.models';
import { CustomerProfile } from '../customers/customerProfile.model';
import { SavedPlace, savedPlaceView } from '../customers/savedPlace.model';
import { DriverDocument } from '../drivers/driverDocument.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { Accounts } from '../ledger/accounts';
import type { LedgerService } from '../ledger/ledger.service';
import { Device } from '../notifications/device.model';
import { Notification } from '../notifications/notification.model';
import type { NotificationsService } from '../notifications/notifications.service';
import { Payment } from '../payments/payment.model';
import { Payout, PayoutAccount } from '../payouts/payout.model';
import { Rating } from '../ratings/rating.model';
import { EmergencyContact, TripShare } from '../safety/safety.models';
import { Settlement } from '../settlements/settlement.model';
import { SupportTicket } from '../support/supportTicket.model';
import { Tip } from '../tips/tip.model';
import { User } from '../users/user.model';
import { Vehicle } from '../vehicles/vehicle.model';
import { Wallet } from '../wallet/wallet.model';

const DAY = 86_400_000;
const EXPORT_COOLDOWN_MS = 5 * 60_000;
const MAX_EXPORT_BOOKINGS = 5000;
const ACTIVE_RIDE = [
  'SCHEDULED',
  'REQUESTED',
  'DISPATCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

export const deletionSchema = z.object({ confirm: z.literal(true) }).strict();
export const staffDeleteSchema = z
  .object({ reason: z.string().trim().min(3).max(300), confirm: z.literal(true) })
  .strict();

/**
 * People's right to a copy of their data and to have their account deleted. Deletion removes
 * what identifies the person and keeps what the law and the books need (the money records,
 * anonymised): it is never allowed while a ride, a debt, a wallet balance or a driver settlement is
 * open, and it waits 7 days so a stolen login cannot erase an account in one go.
 */
export function createPrivacyService(deps: {
  ledger: Pick<LedgerService, 'balances' | 'riderOwedPaise' | 'driverPosition'>;
  audit: AuditService;
  notifications: Pick<NotificationsService, 'notify'>;
  now: () => Date;
  logger: Logger;
  /** How long a deletion request waits before it happens. */
  coolOffMs?: number;
}) {
  const { ledger, audit, notifications, now, logger } = deps;
  const coolOff = deps.coolOffMs ?? 7 * DAY;

  /** Everything that must be sorted out first. An empty list means the account can be deleted. */
  async function blockers(userId: string): Promise<string[]> {
    const user = await User.findById(userId).lean();
    if (!user) throw new AppError('NOT_FOUND');
    const out: string[] = [];
    if ((STAFF_ROLES as readonly string[]).includes(user.role)) {
      out.push('Staff accounts are removed by a super admin.');
      return out;
    }
    if (await Booking.exists({ customerId: userId, status: { $in: ACTIVE_RIDE } as never })) {
      out.push('You have a ride that is not finished. Finish or cancel it first.');
    }
    const owed = await ledger.riderOwedPaise(userId);
    if (owed > 0) out.push('You have an unpaid ride or fee. Pay it first.');
    const wallet = (await ledger.balances([Accounts.wallet(userId)]))[Accounts.wallet(userId)]!;
    if (wallet < 0) {
      out.push(
        'Your wallet still holds money. Contact support to get it refunded before deleting.',
      );
    }
    const admin = await Membership.findOne({ userId, role: 'ADMIN', status: 'ACTIVE' }).lean();
    if (admin) {
      const others = await Membership.countDocuments({
        companyId: admin.companyId,
        role: 'ADMIN',
        status: 'ACTIVE',
        userId: { $ne: userId },
      });
      if (others === 0)
        out.push('You are the only admin of a company account. Make someone else an admin first.');
    }
    if (user.role === 'DRIVER') {
      const profile = await DriverProfile.findOne({ userId }).lean();
      if (profile) {
        if (profile.activeRideId) out.push('You are on a ride.');
        const pos = await ledger.driverPosition(profile._id.toString());
        if (pos.cashHeldPaise > 0 || pos.payablePaise > 0) {
          out.push('You have cash to hand over or earnings to be paid. Settle with finance first.');
        }
        if (
          (await Settlement.exists({ driverId: profile._id, open: true })) ||
          (await Payout.exists({
            driverId: profile._id,
            status: { $in: ['CREATED', 'PROCESSING'] },
          }))
        ) {
          out.push('You have a settlement or payout in progress.');
        }
      }
    }
    return out;
  }

  /** Remove what identifies the person; keep the anonymised money records. Safe to run again. */
  async function anonymize(userId: Types.ObjectId): Promise<void> {
    const at = now();
    await Session.updateMany({ userId, revokedAt: null }, { revokedAt: at });
    await Promise.all([
      Device.deleteMany({ userId }),
      Notification.deleteMany({ userId }),
      EmergencyContact.deleteMany({ userId }),
      TripShare.updateMany(
        { createdBy: userId.toString(), revokedAt: { $exists: false } },
        { revokedAt: at },
      ),
      Wallet.deleteMany({ customerId: userId }),
      SavedPlace.deleteMany({ customerId: userId }),
      CustomerProfile.updateOne({ userId }, { $unset: { email: 1 } }),
      // Names and numbers typed into old bookings; addresses and fares stay with the money record.
      Booking.updateMany(
        { customerId: userId },
        { $unset: { 'pickup.contactName': 1, 'pickup.contactPhone': 1, notes: 1 } },
      ),
      Membership.updateMany(
        { userId },
        { status: 'REMOVED', removedAt: at, phone: 'deleted', $unset: { name: 1, userId: 1 } },
      ),
    ]);
    const profile = await DriverProfile.findOne({ userId });
    if (profile) {
      await DriverProfile.updateOne(
        { _id: profile._id },
        {
          onlineStatus: 'OFFLINE',
          $unset: { city: 1, currentLocation: 1, currentVehicleId: 1, locationUpdatedAt: 1 },
        },
      );
      await PayoutAccount.deleteOne({ driverId: profile._id });
    }
    await User.updateOne({ _id: userId }, { anonymizedAt: at });
  }

  /** Mark the account deleted and free the phone number, then clean up. */
  async function execute(userId: Types.ObjectId): Promise<boolean> {
    const claimed = await User.findOneAndUpdate(
      { _id: userId, accountStatus: 'ACTIVE' },
      {
        accountStatus: 'DELETED',
        deletedAt: now(),
        phone: `deleted:${userId.toString()}`,
        $unset: { name: 1, deletionScheduledFor: 1, deletionBlockedReason: 1 },
      },
    );
    if (!claimed) return false;
    await anonymize(userId);
    await audit.record(
      { userId: userId.toString(), role: claimed.role as Actor['role'], requestId: 'privacy' },
      { action: 'privacy.account_deleted', targetType: 'User', targetId: userId.toString() },
    );
    return true;
  }

  const view = async (userId: string) => {
    const u = await User.findById(userId).lean();
    return {
      requested: Boolean(u?.deletionScheduledFor),
      scheduledFor: u?.deletionScheduledFor ?? null,
      blockedReason: u?.deletionBlockedReason ?? null,
      blockers: await blockers(userId),
    };
  };

  return {
    /* ---------------- a copy of your data ---------------- */

    async exportData(userId: string) {
      const user = await User.findById(userId);
      if (!user || user.accountStatus !== 'ACTIVE') throw new AppError('NOT_FOUND');
      const last = user.lastExportAt?.getTime() ?? 0;
      if (now().getTime() - last < EXPORT_COOLDOWN_MS) {
        throw new AppError(
          'RATE_LIMITED',
          'You asked for your data a moment ago. Try again in a few minutes.',
        );
      }
      await User.updateOne({ _id: userId }, { lastExportAt: now() });

      const [
        customerProfile,
        driverProfile,
        bookings,
        payments,
        tips,
        ratings,
        tickets,
        contacts,
        devices,
        memberships,
        wallet,
        savedPlaces,
      ] = await Promise.all([
        CustomerProfile.findOne({ userId }).lean(),
        DriverProfile.findOne({ userId }).lean(),
        Booking.find({ customerId: userId })
          .sort({ requestedAt: -1 })
          .limit(MAX_EXPORT_BOOKINGS)
          .lean(),
        Payment.find({ customerId: userId }).sort({ createdAt: -1 }).limit(5000).lean(),
        Tip.find({ $or: [{ customerId: userId }, { driverUserId: userId }] })
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean(),
        Rating.find({ raterUserId: userId }).sort({ createdAt: -1 }).limit(5000).lean(),
        SupportTicket.find({ userId }).sort({ createdAt: -1 }).limit(1000).lean(),
        EmergencyContact.find({ userId }).lean(),
        Device.find({ userId }).select('platform appVersion createdAt').lean(),
        Membership.find({ userId }).lean(),
        ledger.balances([Accounts.wallet(userId)]),
        SavedPlace.find({ customerId: userId }).lean(),
      ]);
      const driver = driverProfile
        ? {
            approvalStatus: driverProfile.approvalStatus,
            city: driverProfile.city ?? null,
            ratingCount: driverProfile.ratingCount ?? 0,
            vehicles: (await Vehicle.find({ driverId: driverProfile._id }).lean()).map((v) => ({
              registrationNumber: v.registrationNumber,
              make: v.make ?? null,
              model: v.model ?? null,
              verificationStatus: v.verificationStatus,
            })),
            documents: (await DriverDocument.find({ driverId: driverProfile._id }).lean()).map(
              (d) => ({
                type: d.type,
                status: d.status,
                expiresAt: d.expiresAt ?? null,
              }),
            ),
          }
        : null;
      await audit.record(
        { userId, role: user.role as Actor['role'], requestId: 'privacy' },
        { action: 'privacy.export', targetType: 'User', targetId: userId },
      );
      return {
        generatedAt: now(),
        account: {
          role: user.role,
          phone: user.phone,
          name: user.name ?? null,
          createdAt: user.createdAt,
          status: user.accountStatus,
        },
        profile: customerProfile ? { email: customerProfile.email ?? null } : null,
        driver,
        bookings: bookings.map((b) => ({
          bookingId: b.publicId,
          status: b.status,
          rideType: b.rideType ?? 'INSTANT',
          requestedAt: b.requestedAt,
          scheduledFor: b.scheduledFor ?? null,
          pickup: {
            label: b.pickup.label ?? null,
            coordinates: b.pickup.location?.coordinates ?? null,
          },
          drop: { label: b.drop.label ?? null, coordinates: b.drop.location?.coordinates ?? null },
          paymentMethod: b.paymentMethod,
          paymentStatus: b.paymentStatus ?? null,
          estimatedFarePaise: b.estimatedFarePaise,
          finalFarePaise: b.finalFarePaise ?? null,
          completedAt: b.completedAt ?? null,
        })),
        payments: payments.map((p) => ({
          paymentId: p.publicId,
          purpose: p.purpose,
          method: p.method ?? 'GATEWAY',
          status: p.status,
          amountPaise: p.amountPaise,
          paidAt: p.paidAt ?? null,
        })),
        wallet: { balancePaise: 0 - (wallet[Accounts.wallet(userId)] ?? 0) },
        tips: tips.map((t) => ({
          tipId: t.publicId,
          direction: t.customerId.toString() === userId ? 'GIVEN' : 'RECEIVED',
          amountPaise: t.amountPaise,
          status: t.status,
          createdAt: t.createdAt,
        })),
        ratingsGiven: ratings.map((r) => ({
          stars: r.stars,
          tags: r.tags,
          comment: r.comment ?? null,
          createdAt: r.createdAt,
        })),
        supportTickets: tickets.map((t) => ({
          ticketId: t.publicId,
          category: t.category,
          subject: t.subject,
          status: t.status,
          messages: t.messages
            .filter((m) => !m.internal)
            .map((m) => ({ by: m.by, text: m.text, at: m.at })),
        })),
        emergencyContacts: contacts.map((c) => ({
          name: c.name,
          phone: c.phone,
          relationship: c.relationship ?? null,
        })),
        devices: devices.map((d) => ({ platform: d.platform, appVersion: d.appVersion ?? null })),
        companyMemberships: memberships.map((m) => ({ role: m.role, status: m.status })),
        savedPlaces: savedPlaces.map(savedPlaceView),
        note: 'Money records (fares, payments, invoices) are kept by law even if you delete your account.',
      };
    },

    /* ---------------- deleting your account ---------------- */

    status: view,

    async requestDeletion(userId: string) {
      const found = await blockers(userId);
      if (found.length > 0) {
        throw new AppError(
          'UNPROCESSABLE',
          undefined,
          found.map((message) => ({ field: 'account', message })),
        );
      }
      const scheduledFor = new Date(now().getTime() + coolOff);
      const updated = await User.findOneAndUpdate(
        { _id: userId, accountStatus: 'ACTIVE' },
        {
          deletionRequestedAt: now(),
          deletionScheduledFor: scheduledFor,
          $unset: { deletionBlockedReason: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!updated) throw new AppError('NOT_FOUND');
      await audit.record(
        { userId, role: updated.role as Actor['role'], requestId: 'privacy' },
        { action: 'privacy.deletion_requested', targetType: 'User', targetId: userId },
      );
      return view(userId);
    },

    async cancelDeletion(userId: string) {
      await User.updateOne(
        { _id: userId, accountStatus: 'ACTIVE' },
        { $unset: { deletionRequestedAt: 1, deletionScheduledFor: 1, deletionBlockedReason: 1 } },
      );
      return view(userId);
    },

    /** Super admin: carry out a deletion now (for example a legal request), under the same conditions. */
    async deleteNow(actor: Actor, userId: string, reason: string) {
      const user = await User.findById(userId);
      if (!user || user.accountStatus !== 'ACTIVE') throw new AppError('NOT_FOUND');
      if (userId === actor.userId)
        throw new AppError('UNPROCESSABLE', 'You cannot delete your own account here.');
      const found = await blockers(userId);
      if (found.length > 0) {
        throw new AppError(
          'UNPROCESSABLE',
          undefined,
          found.map((message) => ({ field: 'account', message })),
        );
      }
      await execute(user._id);
      await audit.record(actor, {
        action: 'privacy.staff_deleted_account',
        targetType: 'User',
        targetId: userId,
        metadata: { reason },
      });
      return { deleted: true };
    },

    /** Background job: carry out deletions that are due, and finish any that were cut short. */
    async run(): Promise<{ deleted: number; blocked: number; finished: number }> {
      let deleted = 0;
      let blocked = 0;
      let finished = 0;
      const due = await User.find({
        accountStatus: 'ACTIVE',
        deletionScheduledFor: { $lte: now() },
      }).limit(50);
      for (const u of due) {
        try {
          const found = await blockers(u._id.toString());
          if (found.length > 0) {
            // Something came up during the waiting week: stop, and tell them why.
            await User.updateOne(
              { _id: u._id, accountStatus: 'ACTIVE' },
              {
                $unset: { deletionScheduledFor: 1, deletionRequestedAt: 1 },
                deletionBlockedReason: found[0],
              },
            );
            await notifications
              .notify(u._id.toString(), {
                type: 'privacy.deletion_blocked',
                title: 'Your account was not deleted',
                body: found[0]!,
                data: {},
                dedupeKey: `deletion-blocked:${u._id.toString()}:${now().toISOString().slice(0, 10)}`,
              })
              .catch((err) => logger.error({ err }, 'could not send a deletion notice'));
            blocked += 1;
          } else if (await execute(u._id)) {
            deleted += 1;
          }
        } catch (err) {
          logger.error({ err, userId: u.id }, 'account deletion failed');
        }
      }
      // A deletion that was cut short half way is finished.
      const half = await User.find({
        accountStatus: 'DELETED',
        anonymizedAt: { $exists: false },
      }).limit(50);
      for (const u of half) {
        await anonymize(u._id);
        finished += 1;
      }
      return { deleted, blocked, finished };
    },
  };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
