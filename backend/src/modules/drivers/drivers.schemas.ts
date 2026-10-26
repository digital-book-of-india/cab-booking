import { z } from 'zod';
import { DocumentTypes, DriverApprovalStatuses, UPLOAD_TYPES } from '../../common/enums';
import { paginationSchema } from '../../common/pagination';

export { UPLOAD_TYPES };

export const applicationSchema = z
  .object({ fullName: z.string().trim().min(2).max(100), city: z.string().trim().min(2).max(80) })
  .strict();

export const documentSchema = z
  .object({
    type: z.enum(DocumentTypes),
    documentNumberLast4: z
      .string()
      .regex(/^[A-Za-z0-9]{1,4}$/)
      .optional(),
    expiresAt: z.coerce.date().optional(),
    contentType: z.enum(UPLOAD_TYPES),
  })
  .strict();

export const driverListQuerySchema = paginationSchema.extend({
  approvalStatus: z.enum(DriverApprovalStatuses).optional(),
  q: z.string().trim().min(1).max(50).optional(),
});

export const approvalSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_RESUBMISSION', 'SUSPEND']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'APPROVE' || !!v.reason, {
    message: 'reason is required for this decision',
    path: ['reason'],
  });

export const documentReviewSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((v) => v.status === 'APPROVED' || !!v.reason, {
    message: 'reason is required when rejecting',
    path: ['reason'],
  });

export type ApplicationInput = z.infer<typeof applicationSchema>;
export type DocumentInput = z.infer<typeof documentSchema>;
export type DriverListQuery = z.infer<typeof driverListQuerySchema>;
export type ApprovalInput = z.infer<typeof approvalSchema>;
export type DocumentReviewInput = z.infer<typeof documentReviewSchema>;
