'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { CouponItem } from '@/types';
import { formatPaiseToInr, parseInrInputToPaise } from '@/lib/currency';
import { Tag, Plus } from 'lucide-react';

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FLAT_PAISE'>('PERCENTAGE');
  const [discountVal, setDiscountVal] = useState('20');
  const [maxDiscountInr, setMaxDiscountInr] = useState('100.00');

  const fetchCoupons = async () => {
    try {
      const res = await apiClient.get('/admin/coupons');
      setCoupons(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoupons();
  }, []);

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiClient.post('/admin/coupons', {
      code,
      discountType,
      discountValue: discountType === 'PERCENTAGE' ? parseInt(discountVal, 10) : parseInrInputToPaise(discountVal),
      maxDiscountPaise: discountType === 'PERCENTAGE' ? parseInrInputToPaise(maxDiscountInr) : undefined,
    });
    setShowAddModal(false);
    setCode('');
    fetchCoupons();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Promotions & Coupon Configurator</h1>
          <p className="text-xs text-slate-500 mt-1">Configure promotional discount vouchers, flat rupee subsidies, and maximum discount caps.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
        >
          <Plus className="h-4 w-4" />
          <span>Create Coupon</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
          <div className="text-slate-400 text-xs">Loading coupons...</div>
        ) : (
          coupons.map((c) => (
            <div key={c.id} className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-mono text-base font-bold text-indigo-700 tracking-wider">{c.code}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                  {c.active ? 'ACTIVE' : 'EXPIRED'}
                </span>
              </div>
              <p className="text-xs text-slate-700">
                Discount: <strong className="text-slate-900">{c.discountType === 'PERCENTAGE' ? `${c.discountValue}% OFF` : `${formatPaiseToInr(c.discountValue)} FLAT`}</strong>
                {c.maxDiscountPaise && ` (Cap: ${formatPaiseToInr(c.maxDiscountPaise)})`}
              </p>
              <p className="text-[11px] text-slate-500">
                Redeemed: {c.totalRedemptions} / {c.maxRedemptionsLimit} times
              </p>
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Create Promotional Voucher</h3>
            <form onSubmit={handleCreateCoupon} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Coupon Promo Code</label>
                <input
                  type="text"
                  placeholder="e.g. DIWALI2026"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 uppercase font-mono focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-600">Discount Model</label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FLAT_PAISE">Flat Rupee (₹)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600">Discount Value</label>
                  <input
                    type="text"
                    value={discountVal}
                    onChange={(e) => setDiscountVal(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-indigo-600"
                    required
                  />
                </div>
              </div>

              {discountType === 'PERCENTAGE' && (
                <div>
                  <label className="block font-semibold text-slate-600">Maximum Discount Cap (₹)</label>
                  <input
                    type="text"
                    value={maxDiscountInr}
                    onChange={(e) => setMaxDiscountInr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-indigo-600"
                    required
                  />
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-900 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition"
                >
                  Publish Coupon
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}