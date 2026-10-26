'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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
} from 'lucide-react';

// Form validation schema with React Hook Form & Zod
const pricingFormSchema = z.object({
  zoneId: z.string().min(1, 'Please select an operational zone.'),
  categoryId: z.string().min(1, 'Please select a vehicle category.'),
  baseFareInr: z
    .string()
    .min(1, 'Base fare is required')
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 0, 'Must be a positive amount'),
  perKmInr: z
    .string()
    .min(1, 'Per km rate is required')
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 0, 'Must be a positive amount'),
  perMinuteInr: z
    .string()
    .min(1, 'Per minute rate is required')
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 0, 'Must be a positive amount'),
  minFareInr: z
    .string()
    .min(1, 'Minimum trip fare is required')
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 0, 'Must be a positive amount'),
  freeWaitingSeconds: z.number()
    .int()
    .min(0, 'Free waiting seconds cannot be negative')
    .max(3600, 'Max free waiting is 3600s (60 min)'),
  waitingPerMinuteInr: z
    .string()
    .min(1, 'Waiting rate is required')
    .refine((val) => !isNaN(Number(val)) && Number(val) >= 0, 'Must be a positive amount'),
  roundingMode: z.enum(['NONE', 'NEAREST_RUPEE', 'CEIL_RUPEE', 'FLOOR_RUPEE']),
  effectiveFrom: z.string().optional(),
  changeReason: z.string().trim().min(3, 'Audit change reason must be at least 3 characters').max(300),
});

type PricingFormData = z.infer<typeof pricingFormSchema>;

interface PricingConfigRow {
  _id?: string;
  name?: string;
  configId?: string;
  id?: string;
  version?: number;
  zoneId?: string;
  zoneName?: string;
  categoryId?: string;
  categoryName?: string;
  baseFarePaise: number;
  perKmPaise: number;
  perMinutePaise: number;
  minimumFarePaise: number;
  freeWaitingSeconds?: number;
  waitingPerMinutePaise?: number;
  roundingMode?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  isActive?: boolean;
  changeReason?: string;
  createdAt?: string;
}

interface ZoneOption {
  zoneId?: string;
  id?: string;
  _id?: string;
  code?: string;
  name?: string;
}

interface CategoryOption {
  categoryId?: string;
  id?: string;
  _id?: string;
  code?: string;
  name?: string;
}


export default function PricingConfigsPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // React Hook Form initialization
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PricingFormData>({
    resolver: zodResolver(pricingFormSchema),
    defaultValues: {
      zoneId: '',
      categoryId: '',
      baseFareInr: '40.00',
      perKmInr: '14.00',
      perMinuteInr: '1.50',
      minFareInr: '100.00',
      freeWaitingSeconds: 180,
      waitingPerMinuteInr: '2.00',
      roundingMode: 'NEAREST_RUPEE',
      effectiveFrom: '',
      changeReason: '',
    },
  });

  // Fetch Zones
  const zonesQuery = useQuery({
    queryKey: ['admin-zones'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/zones');
        return Array.isArray(res.data?.data) ? res.data.data : res.data?.data?.items || [];
      } catch {
        return [{ id: '60c72b2f9b1d8b2bad000001', name: 'Delhi NCR (Core Zone)', code: 'DEL_NCR' }];
      }
    },
  });

  // Fetch Categories
  const categoriesQuery = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/admin/vehicles/categories');
        return Array.isArray(res.data?.data) ? res.data.data : res.data?.data?.items || [];
      } catch {
        return [
          { id: '60c72b2f9b1d8b2bad000002', name: 'Economy Hatchback (MINI)', code: 'MINI' },
          { id: '60c72b2f9b1d8b2bad000003', name: 'Comfort Sedan (SEDAN)', code: 'SEDAN' },
          { id: '60c72b2f9b1d8b2bad000004', name: 'Premium SUV (SUV)', code: 'SUV' },
        ];
      }
    },
  });

  // Fetch Config Versions
  const configsQuery = useQuery({
    queryKey: ['admin-pricing-configs', { zoneId: selectedZone, categoryId: selectedCategory }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedZone) params.append('zoneId', selectedZone);
      if (selectedCategory) params.append('categoryId', selectedCategory);
      const res = await apiClient.get(`/admin/pricing/configs?${params.toString()}`);
      return Array.isArray(res.data?.data) ? res.data.data : res.data?.data?.items || [];
    },
  });

  // Create Version Mutation
  const createMutation = useMutation({
    mutationFn: async (formData: PricingFormData) => {
      const payload = {
        zoneId: formData.zoneId,
        categoryId: formData.categoryId,
        baseFarePaise: parseInrInputToPaise(formData.baseFareInr),
        perKmPaise: parseInrInputToPaise(formData.perKmInr),
        perMinutePaise: parseInrInputToPaise(formData.perMinuteInr),
        minimumFarePaise: parseInrInputToPaise(formData.minFareInr),
        freeWaitingSeconds: formData.freeWaitingSeconds,
        waitingPerMinutePaise: parseInrInputToPaise(formData.waitingPerMinuteInr),
        roundingMode: formData.roundingMode,
        effectiveFrom: formData.effectiveFrom ? new Date(formData.effectiveFrom).toISOString() : undefined,
        changeReason: formData.changeReason,
      };

      const res = await apiClient.post('/admin/pricing/configs', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-pricing-configs'] });
      setFeedback({
        type: 'success',
        message: 'New immutable tariff version created and activated successfully.',
      });
      setShowAddModal(false);
      reset();
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to create tariff configuration.' });
    },
  });

  const onSubmit = (values: PricingFormData) => {
    createMutation.mutate(values);
  };

  const configs: PricingConfigRow[] = configsQuery.data || [];
  const zones: ZoneOption[] = zonesQuery.data || [];
  const categories: CategoryOption[] = categoriesQuery.data || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Versioned Tariff Configurations
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure vehicle category base rates, mileage, duration charges, waiting policies, and immutable version history.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            href="/pricing/preview"
            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition"
          >
            Preview Calculator
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <Plus className="h-4 w-4" />
            <span>Create New Tariff Version</span>
          </button>
        </div>
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

      {/* Filter Selector */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <select
          value={selectedZone}
          onChange={(e) => setSelectedZone(e.target.value)}
          className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
        >
          <option value="">All Service Zones</option>
          {zones.map((z: ZoneOption) => (
            <option key={z.id || z._id} value={z.id || z._id}>
              {z.name} ({z.code})
            </option>
          ))}
        </select>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
        >
          <option value="">All Vehicle Categories</option>
          {categories.map((c: CategoryOption) => (
            <option key={c.id || c._id} value={c.id || c._id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>

        <button
          onClick={() => configsQuery.refetch()}
          disabled={configsQuery.isFetching}
          className="flex items-center space-x-1.5 px-3 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${configsQuery.isFetching ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Tariff Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {configsQuery.isLoading ? (
          <div className="col-span-2 p-12 text-center text-slate-400 text-xs">
            <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-indigo-600" />
            Loading versioned tariff configurations...
          </div>
        ) : configsQuery.isError ? (
          <div className="col-span-2 p-8 text-center text-rose-600 text-xs">
            Failed to load tariff configurations from backend.
          </div>
        ) : configs.length === 0 ? (
          <div className="col-span-2 p-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-200">
            No tariff configurations found for the selected zone/category filter.
          </div>
        ) : (
          configs.map((c: PricingConfigRow) => (
            <div
              key={c.id || c._id}
              className="p-6 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    {c.categoryName || c.name || 'Tariff Config'}
                  </h3>
                  <p className="text-xs text-indigo-700 font-mono font-semibold mt-0.5">
                    {c.zoneName || 'Zone'} • Version #{c.version || 1}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                    c.isActive !== false
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {c.isActive !== false ? 'ACTIVE' : 'SUPERSEDED'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 text-[11px] block">Base Fare</span>
                  <span className="font-mono font-bold text-slate-800 text-sm">
                    {formatPaiseToInr(c.baseFarePaise)}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 text-[11px] block">Distance Rate</span>
                  <span className="font-mono font-bold text-slate-800 text-sm">
                    {formatPaiseToInr(c.perKmPaise)}/km
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 text-[11px] block">Duration Rate</span>
                  <span className="font-mono font-bold text-slate-800 text-sm">
                    {formatPaiseToInr(c.perMinutePaise)}/min
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 text-[11px] block">Minimum Fare</span>
                  <span className="font-mono font-bold text-slate-800 text-sm">
                    {formatPaiseToInr(c.minimumFarePaise)}
                  </span>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 text-xs space-y-1.5 text-slate-600">
                <div className="flex justify-between">
                  <span>Free Waiting Window:</span>
                  <span className="font-mono font-semibold">{c.freeWaitingSeconds ?? 180}s ({Math.round((c.freeWaitingSeconds ?? 180) / 60)} min)</span>
                </div>
                <div className="flex justify-between">
                  <span>Waiting Surcharge:</span>
                  <span className="font-mono font-semibold">
                    {formatPaiseToInr(c.waitingPerMinutePaise ?? 0)}/min
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Rounding Mode:</span>
                  <span className="font-mono text-indigo-600 font-semibold">{c.roundingMode || 'NEAREST_RUPEE'}</span>
                </div>
                {c.effectiveFrom && (
                  <div className="flex justify-between">
                    <span>Effective From:</span>
                    <span className="font-mono text-slate-500">{formatToIST(c.effectiveFrom)}</span>
                  </div>
                )}
                {c.changeReason && (
                  <div className="p-2 rounded bg-amber-50/50 border border-amber-100/80 text-[11px] text-amber-900 mt-2">
                    <span className="font-semibold block">Audit Change Reason:</span>
                    {c.changeReason}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal: Create Version */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Create Immutable Tariff Version
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Tariff configs are append-only. Saving creates a new version with effective date tracking.
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Operating Zone *
                  </label>
                  <select
                    {...register('zoneId')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  >
                    <option value="">Select Zone</option>
                    {zones.map((z: ZoneOption) => (
                      <option key={z.id || z._id} value={z.id || z._id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                  {errors.zoneId && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.zoneId.message}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Vehicle Category *
                  </label>
                  <select
                    {...register('categoryId')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  >
                    <option value="">Select Category</option>
                    {categories.map((c: CategoryOption) => (
                      <option key={c.id || c._id} value={c.id || c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {errors.categoryId && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.categoryId.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Base Fare (₹) *
                  </label>
                  <input
                    type="text"
                    {...register('baseFareInr')}
                    placeholder="40.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.baseFareInr && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.baseFareInr.message}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Per KM Rate (₹) *
                  </label>
                  <input
                    type="text"
                    {...register('perKmInr')}
                    placeholder="14.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.perKmInr && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.perKmInr.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Per Minute Rate (₹) *
                  </label>
                  <input
                    type="text"
                    {...register('perMinuteInr')}
                    placeholder="1.50"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.perMinuteInr && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.perMinuteInr.message}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Minimum Fare (₹) *
                  </label>
                  <input
                    type="text"
                    {...register('minFareInr')}
                    placeholder="100.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.minFareInr && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.minFareInr.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Free Waiting (Sec) *
                  </label>
                  <input
                    type="number"
                    {...register('freeWaitingSeconds', { valueAsNumber: true })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.freeWaitingSeconds && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.freeWaitingSeconds.message}</p>
                  )}
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Waiting Rate (₹/Min) *
                  </label>
                  <input
                    type="text"
                    {...register('waitingPerMinuteInr')}
                    placeholder="2.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-slate-900 focus:outline-none focus:border-indigo-600"
                  />
                  {errors.waitingPerMinuteInr && (
                    <p className="text-rose-600 text-[11px] mt-0.5">{errors.waitingPerMinuteInr.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Fare Rounding Policy
                  </label>
                  <select
                    {...register('roundingMode')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  >
                    <option value="NEAREST_RUPEE">Nearest Rupee</option>
                    <option value="CEIL_RUPEE">Ceil Rupee</option>
                    <option value="FLOOR_RUPEE">Floor Rupee</option>
                    <option value="NONE">None (Exact Paise)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                    Effective From Date
                  </label>
                  <input
                    type="datetime-local"
                    {...register('effectiveFrom')}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono text-xs focus:outline-none focus:border-indigo-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                  Change Reason / Audit Justification *
                </label>
                <textarea
                  rows={2}
                  {...register('changeReason')}
                  placeholder="e.g. Q4 Peak season fuel adjustment approved by Pricing Committee"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                />
                {errors.changeReason && (
                  <p className="text-rose-600 text-[11px] mt-0.5">{errors.changeReason.message}</p>
                )}
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
                  {createMutation.isPending ? 'Publishing Version...' : 'Publish Tariff Version'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
