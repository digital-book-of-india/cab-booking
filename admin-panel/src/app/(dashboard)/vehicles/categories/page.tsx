'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { CabCategory } from '@/types';
import {
  ArrowLeft,
  Plus,
  Car,
  CheckCircle2,
  XCircle,
  Edit2,
  RefreshCw,
  Layers,
  Users,
  X,
  AlertCircle,
} from 'lucide-react';

export default function CabCategoriesPage() {
  const [categories, setCategories] = useState<CabCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CabCategory | null>(null);

  // Form states for Add
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [displayOrder, setDisplayOrder] = useState('1');
  const [active, setActive] = useState(true);

  // Form states for Edit
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('4');
  const [editDisplayOrder, setEditDisplayOrder] = useState('1');

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4500);
  };

  const fetchCategories = useCallback(async (isRefresh = false) => {
    if (isRefresh) setLoading(true);
    try {
      const res = await apiClient.get('/admin/cab-categories');
      const list = res.data?.data || res.data || [];
      setCategories(Array.isArray(list) ? list : []);
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        (err as Error)?.message ||
        'Failed to load fleet categories';
      console.warn('Failed to load cab categories:', errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchCategories();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchCategories]);

  // Toggle active/inactive
  const handleToggle = async (cat: CabCategory) => {
    try {
      const nextActive = !cat.active;
      await apiClient.patch(`/admin/cab-categories/${cat.id}`, { active: nextActive });
      showToast(
        `Category "${cat.name}" is now ${nextActive ? 'ACTIVE' : 'DISABLED'}.`,
        'success'
      );
      fetchCategories();
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to toggle category status';
      showToast(errorMsg, 'error');
    }
  };

  // Create new category
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      showToast('Category code and name are required', 'error');
      return;
    }

    setActionLoading(true);
    try {
      await apiClient.post('/admin/cab-categories', {
        code: code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''),
        name: name.trim(),
        capacity: parseInt(capacity, 10) || 4,
        displayOrder: parseInt(displayOrder, 10) || 0,
        active,
      });

      showToast(`Category "${name}" created successfully!`, 'success');
      setShowAddModal(false);
      setCode('');
      setName('');
      setCapacity('4');
      setDisplayOrder('1');
      fetchCategories();
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to create category';
      showToast(errorMsg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Edit category
  const handleStartEdit = (cat: CabCategory) => {
    setEditingCategory(cat);
    setEditName(cat.name);
    setEditCapacity(cat.capacity.toString());
    setEditDisplayOrder((cat.displayOrder || 0).toString());
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;

    setActionLoading(true);
    try {
      await apiClient.patch(`/admin/cab-categories/${editingCategory.id}`, {
        name: editName.trim(),
        capacity: parseInt(editCapacity, 10) || 4,
        displayOrder: parseInt(editDisplayOrder, 10) || 0,
      });

      showToast(`Category "${editName}" updated successfully!`, 'success');
      setEditingCategory(null);
      fetchCategories();
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to update category';
      showToast(errorMsg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const activeCount = categories.filter((c) => c.active).length;
  const inactiveCount = categories.filter((c) => !c.active).length;
  const maxCapacity = categories.reduce((max, c) => Math.max(max, c.capacity), 0);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-[99999] flex items-center space-x-2.5 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md animate-slideDown ${
            toast.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toast.text}</span>
          <button onClick={() => setToast(null)} className="p-1 text-slate-400 hover:text-slate-700 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href="/vehicles"
            className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 shadow-xs transition"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Cab Categories & Fleet Tiers</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Fleet Architecture
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Configure passenger vehicle classes, seating capacity thresholds, and active booking availability.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => fetchCategories()}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 shadow-xs transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm shadow-indigo-200"
          >
            <Plus className="h-4 w-4" />
            <span>Add Category</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Total Fleet Tiers</span>
            <Layers className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">{categories.length}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Configured vehicle classes</div>
        </div>

        <div className="p-5 rounded-2xl border border-emerald-200 bg-emerald-50/50 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700 mb-1">
            <span className="text-xs font-semibold">Active Categories</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-800">{activeCount}</div>
          <div className="text-[11px] text-emerald-600 mt-0.5">Live for booking quotes</div>
        </div>

        <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Inactive Tiers</span>
            <XCircle className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-700">{inactiveCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Temporarily decommissioned</div>
        </div>

        <div className="p-5 rounded-2xl border border-indigo-200 bg-indigo-50/50 shadow-xs">
          <div className="flex items-center justify-between text-indigo-700 mb-1">
            <span className="text-xs font-semibold">Max Passenger Cap</span>
            <Users className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-indigo-800">{maxCapacity || 6}</div>
          <div className="text-[11px] text-indigo-600 mt-0.5">Passengers per ride tier</div>
        </div>
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-3 p-12 text-center text-slate-500 text-xs space-y-2">
            <div className="h-6 w-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p>Loading fleet categories...</p>
          </div>
        ) : categories.length === 0 ? (
          <div className="col-span-3 p-12 text-center rounded-2xl border border-dashed border-slate-300 bg-white text-slate-500 text-xs">
            <Car className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">No cab categories configured.</p>
            <p className="text-[11px] mt-1">Click &quot;Add Category&quot; above to configure your first vehicle tier.</p>
          </div>
        ) : (
          categories.map((cat) => (
            <div
              key={cat.id}
              className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-4 hover:border-indigo-200 hover:shadow-md transition"
            >
              <div className="flex justify-between items-start">
                <span className="font-mono text-xs font-bold text-indigo-700 uppercase bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
                  {cat.code}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    cat.active
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  {cat.active ? 'ACTIVE' : 'DISABLED'}
                </span>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 text-base tracking-tight">{cat.name}</h3>
                <p className="text-xs text-slate-600 mt-1 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-slate-400" />
                  <span>Max Capacity: <strong className="text-slate-800">{cat.capacity} Passengers</strong></span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Display Order: #{cat.displayOrder ?? 0}
                </p>
              </div>

              <div className="flex items-center space-x-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() => handleStartEdit(cat)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition flex items-center justify-center space-x-1"
                >
                  <Edit2 className="h-3.5 w-3.5 text-slate-500" />
                  <span>Edit Tier</span>
                </button>

                <button
                  onClick={() => handleToggle(cat)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    cat.active
                      ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  {cat.active ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Category Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Car className="h-5 w-5 text-indigo-600" /> Create Cab Category
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Category Code *
                </label>
                <input
                  type="text"
                  placeholder="e.g. EV_PRIME"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white font-mono text-xs uppercase text-indigo-700 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Category Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Premium Electric Sedan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Passenger Capacity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Display Order
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs text-slate-700 font-semibold">Active upon creation</span>
                <button
                  type="button"
                  onClick={() => setActive(!active)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    active ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      active ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save Fleet Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="h-5 w-5 text-indigo-600" /> Edit Category ({editingCategory.code})
              </h3>
              <button
                onClick={() => setEditingCategory(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Category Name *
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Passenger Capacity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={editCapacity}
                    onChange={(e) => setEditCapacity(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                    Display Order
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editDisplayOrder}
                    onChange={(e) => setEditDisplayOrder(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingCategory(null)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-50"
                >
                  {actionLoading ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}