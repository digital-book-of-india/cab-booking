'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { CabCategory } from '@/types';
import { ArrowLeft, Plus } from 'lucide-react';

export default function CabCategoriesPage() {
  const [categories, setCategories] = useState<CabCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');

  const fetchCategories = async () => {
    try {
      const res = await apiClient.get('/admin/cab-categories');
      setCategories(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleToggle = async (cat: CabCategory) => {
    await apiClient.patch(`/admin/cab-categories/${cat.id}`, { active: !cat.active });
    fetchCategories();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiClient.post('/admin/cab-categories', {
      code,
      name,
      capacity: parseInt(capacity, 10),
    });
    setShowAddModal(false);
    setCode('');
    setName('');
    fetchCategories();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/vehicles" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Cab Categories Management</h1>
            <p className="text-xs text-slate-500 mt-0.5">Configure passenger fleet tiers, capacities, and active availability.</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
        >
          <Plus className="h-4 w-4" />
          <span>Add Category</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
        {loading ? (
          <div className="text-slate-400 text-xs">Loading categories...</div>
        ) : (
          categories.map((c) => (
            <div key={c.id} className="p-5 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-mono text-xs font-bold text-indigo-700 uppercase">{c.code}</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                  {c.active ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">{c.name}</h3>
              <p className="text-xs text-slate-500">Seating Capacity: {c.capacity} Passengers</p>
              <button
                onClick={() => handleToggle(c)}
                className={`w-full py-1.5 rounded-lg text-xs font-semibold transition ${
                  c.active ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
              >
                {c.active ? 'Disable Category' : 'Enable Category'}
              </button>
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Create New Cab Category</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Category Code</label>
                <input
                  type="text"
                  placeholder="e.g. LUXURY"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 uppercase font-mono focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Premium Executive"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Passenger Capacity</label>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

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
                  Create Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}