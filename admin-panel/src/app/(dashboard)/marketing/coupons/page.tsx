'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { formatPaiseToInr, formatToIST, parseInrInputToPaise } from '@/lib/currency';
import { getErrorMessage } from '@/lib/errors';
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Percent,
  IndianRupee,
} from 'lucide-react';

// Form validation schema
const couponFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'Code must be at least 3 characters')
      .max(30, 'Code cannot exceed 30 characters')
      .regex(/^[A-Za-z0-9_-]+$/, 'Only letters, numbers, hyphens, and underscores allowed'),
    description: z.string().trim().max(200).optional(),
    type: z.enum(['PERCENT', 'FLAT']),
    percentValue: z.string().optional(),
    flatValueInr: z.string().optional(),
    maxDiscountInr: z.string().optional(),
    minFareInr: z.string(),
    validFrom: z.string().min(1, 'Valid from date is required'),
    validTo: z.string().min(1, 'Valid to date is required'),
    perUserLimit: z.number().int().min(1, 'At least 1 per rider').max(1000),
    maxRedemptions: z.string().optional(),
  })
  .refine(
    (data) => {
      const from = new Date(data.validFrom).getTime();
      const to = new Date(data.validTo).getTime();
      return to > from;
    },
    {
      message: 'Expiration date must be after start date',
      path: ['validTo'],
    }
  )
  .refine(
    (data) => {
      if (data.type === 'PERCENT') {
        const num = Number(data.percentValue);
        return !isNaN(num) && num > 0 && num <= 100;
      }
      return true;
    },
    {
      message: 'Percentage discount must be between 0.1% and 100%',
      path: ['percentValue'],
    }
  )
  .refine(
    (data) => {
      if (data.type === 'FLAT') {
        const num = Number(data.flatValueInr);
        return !isNaN(num) && num > 0;
      }
      return true;
    },
    {
      message: 'Flat discount must be greater than ₹0',
      path: ['flatValueInr'],
    }
  );

type CouponFormData = z.infer<typeof couponFormSchema>;

interface CouponItem {
  _id?: string;
  totalRedemptions?: number;
  id: string;
  code: string;
  description?: string;
  type: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise?: number;
  minFarePaise?: number;
  validFrom?: string;
  validTo?: string;
  perUserLimit?: number;
  maxRedemptions?: number;
  redemptionsCount?: number;
  active?: boolean;
}


export default function CouponsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CouponFormData>({
    resolver: zodResolver(couponFormSchema),
    defaultValues: {
      code: '',
      description: '',
      type: 'PERCENT',
      percentValue: '15',
      flatValueInr: '50.00',
      maxDiscountInr: '100.00',
      minFareInr: '100.00',
      validFrom: '',
      validTo: '',
      perUserLimit: 1,
      maxRedemptions: '1000',
    },
  });

  const selectedType = useWatch({ control, name: 'type' });

  // Query coupons from backend
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-coupons', { active: activeFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeFilter) params.append('active', activeFilter);
      const res = await apiClient.get(`/admin/coupons?${params.toString()}`);
      return Array.isArray(res.data?.data) ? res.data.data : res.data?.data?.items || [];
    },
  });

  const coupons: CouponItem[] = data || [];

  // Create Coupon Mutation
  const createMutation = useMutation({
    mutationFn: async (formData: CouponFormData) => {
      // Convert values according to backend contract
      const value =
        formData.type === 'PERCENT'
          ? Math.round(Number(formData.percentValue) * 100) // Convert % to basis points (e.g. 10% = 1000 bp)
          : parseInrInputToPaise(formData.flatValueInr || '0');

      const maxDiscountPaise =
        formData.type === 'PERCENT' && formData.maxDiscountInr
          ? parseInrInputToPaise(formData.maxDiscountInr)
          : undefined;

      const minFarePaise = formData.minFareInr
        ? parseInrInputToPaise(formData.minFareInr)
        : 0;

      const payload = {
        code: formData.code.trim().toUpperCase(),
        description: formData.description?.trim() || undefined,
        type: formData.type,
        value,
        maxDiscountPaise,
        minFarePaise,
        validFrom: new Date(formData.validFrom).toISOString(),
        validTo: new Date(formData.validTo).toISOString(),
        perUserLimit: formData.perUserLimit,
        maxRedemptions: formData.maxRedemptions ? Number(formData.maxRedemptions) : undefined,
      };

      const res = await apiClient.post('/admin/coupons', payload);
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-coupons'] });
      setFeedback({
        type: 'success',
        message: `Promotion code ${variables.code} created and active for bookings.`,
      });
      setShowAddModal(false);
      reset();
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to create coupon code.' });
    },
  });

  // Toggle Active Status Mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiClient.patch(`/admin/coupons/${id}`, { active });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-coupons'] });
      setFeedback({
        type: 'success',
        message: `Coupon status updated to ${variables.active ? 'ACTIVE' : 'INACTIVE'}.`,
      });
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to update coupon status.' });
    },
  });

  const openAddModal = () => {
    reset({
      code: '',
      description: '',
      type: 'PERCENT',
      percentValue: '15',
      flatValueInr: '50.00',
      maxDiscountInr: '100.00',
      minFareInr: '100.00',
      validFrom: new Date().toISOString().slice(0, 16),
      validTo: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 16),
      perUserLimit: 1,
      maxRedemptions: '1000',
    });
    setShowAddModal(true);
  };

  const onSubmit = (formData: CouponFormData) => {
    createMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Promotions & Coupon Configurator
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure percentage and flat-rate promotional vouchers, minimum trip thresholds, and redemption limits.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
        >
          <Plus className="h-4 w-4" />
          <span>Create Coupon</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-3 text-xs">
          <span className="font-semibold text-slate-700">Filter Status:</span>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
          >
            <option value="">All Coupons</option>
            <option value="true">Active Only</option>
            <option value="false">Inactive / Expired</option>
          </select>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center space-x-1 px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Coupons Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-3 p-12 text-center text-slate-400 text-xs">
            <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-indigo-600" />
            Loading promotional coupons...
          </div>
        ) : isError ? (
          <div className="col-span-3 p-8 text-center text-rose-600 text-xs">
            {getErrorMessage(error) || 'Failed to load coupons from server.'}
          </div>
        ) : coupons.length === 0 ? (
          <div className="col-span-3 p-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
            Zero active coupons configured. Click &quot;Create Coupon&quot; to add one.
          </div>
        ) : (
          coupons.map((c: CouponItem, idx: number) => {
            const isPercent = c.type === 'PERCENT';
            const displayValue = isPercent
              ? `${(c.value / 100).toFixed(0)}% OFF`
              : `${formatPaiseToInr(c.value)} FLAT OFF`;

            return (
              <div
                key={c.id || c._id || String(idx)}
                className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-base font-bold text-indigo-700 tracking-wider">
                      {c.code}
                    </span>
                    <button
                      onClick={() =>
                        toggleStatusMutation.mutate({
                          id: c.id || c._id || '',
                          active: !c.active,
                        })
                      }
                      disabled={toggleStatusMutation.isPending}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-1 ${
                        c.active
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      <span>{c.active ? 'ACTIVE' : 'INACTIVE'}</span>
                    </button>
                  </div>

                  {c.description && (
                    <p className="text-[11px] text-slate-500 mt-1">{c.description}</p>
                  )}

                  <div className="mt-3 space-y-1 text-xs">
                    <p className="text-slate-800 font-semibold">
                      Discount: <span className="text-indigo-600">{displayValue}</span>
                    </p>
                    {c.maxDiscountPaise && (
                      <p className="text-slate-500 text-[11px]">
                        Max Cap: {formatPaiseToInr(c.maxDiscountPaise ?? 0)}
                      </p>
                    )}
                    {(c.minFarePaise ?? 0) > 0 && (
                      <p className="text-slate-500 text-[11px]">
                        Min Fare: {formatPaiseToInr(c.minFarePaise ?? 0)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3 text-[11px] text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Redemptions:</span>
                    <span className="font-mono font-semibold text-slate-700">
                      {c.redemptionsCount || (c.totalRedemptions ?? c.redemptionsCount ?? 0) || 0} / {c.maxRedemptions || '∞'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Per Rider Limit:</span>
                    <span className="font-mono font-semibold text-slate-700">
                      {c.perUserLimit || 1} ride(s)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Expires:</span>
                    <span className="font-mono text-slate-500">{formatToIST(c.validTo ?? '')}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Create Coupon */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Create Promotional Voucher
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Configure flat or percentage discount rules supported by the pricing engine.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Promo Code *
                </label>
                <input
                  type="text"
                  placeholder="e.g. FESTIVE2026"
                  {...register('code')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono uppercase focus:outline-none focus:border-indigo-600"
                />
                {errors.code && (
                  <p className="text-rose-600 text-[11px] mt-0.5">{errors.code.message}</p>
                )}
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Diwali festive season discount on all rides"
                  {...register('description')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Discount Rule Type *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`p-2.5 rounded-lg border cursor-pointer text-center font-medium transition flex items-center justify-center space-x-1.5 ${
                      selectedType === 'PERCENT'
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 font-bold'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      value="PERCENT"
                      {...register('type')}
                      className="sr-only"
                    />
                    <Percent className="h-3.5 w-3.5" />
                    <span>Percentage</span>
                  </label>
                  <label
                    className={`p-2.5 rounded-lg border cursor-pointer text-center font-medium transition flex items-center justify-center space-x-1.5 ${
                      selectedType === 'FLAT'
                        ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 font-bold'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      value="FLAT"
                      {...register('type')}
                      className="sr-only"
                    />
                    <IndianRupee className="h-3.5 w-3.5" />
                    <span>Flat Rupee</span>
                  </label>
                </div>
              </div>

              {selectedType === 'PERCENT' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                      Discount % *
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      placeholder="e.g. 20"
                      {...register('percentValue')}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                    />
                    {errors.percentValue && (
                      <p className="text-rose-600 text-[11px] mt-0.5">{errors.percentValue.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                      Max Discount Cap (₹)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 150.00"
                      {...register('maxDiscountInr')}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Flat Discount Amount (₹) *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 50.00"
                    {...register('flatValueInr')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.flatValueInr && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.flatValueInr.message}</p>
                  )}
                </div>
              )}

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Minimum Trip Fare (₹)
                </label>
                <input
                  type="text"
                  placeholder="0.00"
                  {...register('minFareInr')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Valid From *
                  </label>
                  <input
                    type="datetime-local"
                    {...register('validFrom')}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-[11px] text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.validFrom && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.validFrom.message}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Valid To *
                  </label>
                  <input
                    type="datetime-local"
                    {...register('validTo')}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-[11px] text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.validTo && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.validTo.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Total Redemptions Limit
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 500"
                    {...register('maxRedemptions')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Per-Rider Limit
                  </label>
                  <input
                    type="number"
                    defaultValue={1}
                    min={1}
                    {...register('perUserLimit', { valueAsNumber: true })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.perUserLimit && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.perUserLimit.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold disabled:opacity-60"
                >
                  {createMutation.isPending ? 'Publishing Coupon...' : 'Create Coupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
