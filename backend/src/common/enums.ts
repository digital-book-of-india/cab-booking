/** Frozen enums. Keep in sync with docs/enums.md. */
export const Roles = [
  'CUSTOMER',
  'DRIVER',
  'OPS',
  'SUPPORT',
  'FINANCE',
  'SAFETY_ADMIN',
  'CONFIG_ADMIN',
  'SUPER_ADMIN',
] as const;
export type Role = (typeof Roles)[number];

/** Roles a person may self-register as. Admin roles are only created by seed/SUPER_ADMIN. */
export const SignupRoles = ['CUSTOMER', 'DRIVER'] as const;
export type SignupRole = (typeof SignupRoles)[number];

export const AccountStatuses = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type AccountStatus = (typeof AccountStatuses)[number];

export const DriverApprovalStatuses = [
  'PENDING',
  'NEEDS_RESUBMISSION',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type DriverApprovalStatus = (typeof DriverApprovalStatuses)[number];

export const OnlineStatuses = ['ONLINE', 'OFFLINE'] as const;

export const DocumentTypes = [
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'INSURANCE',
  'PERMIT',
  'ID_PROOF',
  'PROFILE_PHOTO',
] as const;
export type DocumentType = (typeof DocumentTypes)[number];

export const DocumentStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
] as const;

/** A driver cannot be approved, or go online, without a current approved document of each of these. */
export const REQUIRED_DOCUMENT_TYPES: readonly DocumentType[] = [
  'DRIVING_LICENCE',
  'VEHICLE_RC',
  'INSURANCE',
  'ID_PROOF',
];
/** Drivers are reminded this many days before a document expires (once per threshold). */
export const DOCUMENT_REMINDER_DAYS = [30, 7, 1] as const;
export const VehicleVerificationStatuses = ['PENDING', 'VERIFIED', 'REJECTED'] as const;

/** Roles allowed to run driver/vehicle review workflows. */
export const DRIVER_REVIEW_ROLES: Role[] = ['OPS', 'SUPER_ADMIN'];
export const CONFIG_ROLES: Role[] = ['CONFIG_ADMIN', 'SUPER_ADMIN'];
export const AUDIT_ROLES: Role[] = ['SUPER_ADMIN'];
/** Staff who may look at users, bookings and the ops dashboard (read-only). */
export const OPS_VIEW_ROLES: Role[] = ['OPS', 'SUPPORT', 'SUPER_ADMIN'];
/** Staff accounts: every role that is not a rider or a driver. */
export const STAFF_ROLES: Role[] = [
  'OPS',
  'SUPPORT',
  'FINANCE',
  'SAFETY_ADMIN',
  'CONFIG_ADMIN',
  'SUPER_ADMIN',
];
/** Staff who may switch features on and off. */
export const FLAG_ROLES: Role[] = ['CONFIG_ADMIN', 'SUPER_ADMIN'];
/** Staff who handle emergencies. */
export const SAFETY_ROLES: Role[] = ['SAFETY_ADMIN', 'OPS', 'SUPER_ADMIN'];
/** Staff who answer riders and drivers. */
export const SUPPORT_ROLES: Role[] = ['SUPPORT', 'OPS', 'SUPER_ADMIN'];
/** Staff who receive live operations events (the staff socket room). */
export const OPS_ROOM_ROLES: Role[] = ['OPS', 'SUPPORT', 'SAFETY_ADMIN', 'SUPER_ADMIN'];
/** Staff who may waive a cancellation or no-show fee. */
export const FEE_WAIVE_ROLES: Role[] = ['OPS', 'SUPER_ADMIN'];
/** Staff who may suspend or reactivate customer accounts. */
export const USER_STATUS_ROLES: Role[] = ['OPS', 'SUPER_ADMIN'];

/** Content types a driver document may have. Shared by validation and file storage. */
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
