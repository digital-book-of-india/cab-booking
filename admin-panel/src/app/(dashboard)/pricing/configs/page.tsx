'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { PricingConfig } from '@/types';
import { formatPaiseToInr, parseInrInputToPaise } from '@/lib/currency';
import { Plus } from 'lucide-react';

export default function PricingConfigsPage() {
  const [configs, setConfigs] = useState<PricingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const [name, setName] = useState('');
  const [baseFareInr, setBaseFareInr] = useState('40.00');
  const [perKmInr, setPerKmInr] = useState('14.00');
  const [perMinuteInr, setPerMinuteInr] = useState('1.50');
  const [minFareInr, setMinFareInr] = useState('100.00');
  const [freeWaitingSec, setFreeWaitingSec] = useState('180');
  const [waitingPerMinInr, setWaitingPerMinInr] = useState('2.00');
  const [surgeMin, setSurgeMin] = useState('1.0');
  const [surgeMax, setSurgeMax] = useState('1.5');
  const [changeReason, setChangeReason] = useState('');

  const fetchConfigs = async () => {
    try {
      const res = await apiClient.get('/admin/pricing/configs');
      setConfigs(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleCreateConfig = async (e: React.FormEvent) => {
    e.preventDefault();

    await apiClient.post('/admin/pricing/configs', {
      name,
      baseFarePaise: parseInrInputToPaise(baseFareInr),
      perKmPaise: parseInrInputToPaise(perKmInr),
      perMinutePaise: parseInrInputToPaise(perMinuteInr),
      minimumFarePaise: parseInrInputToPaise(minFareInr),
      freeWaitingSeconds: parseInt(freeWaitingSec, 10),
      waitingPerMinutePaise: parseInrInputToPaise(waitingPerMinInr),
      demandMultiplierMin: parseFloat(surgeMin),
      demandMultiplierMax: parseFloat(surgeMax),
      roundingMode: 'NEAREST_RUPEE',
      isActive: true,
      changeReason,
    });

    setShowAddModal(false);
    setName('');
    setChangeReason('');
    fetchConfigs();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Versioned Tariff Configurations</h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure vehicle category base rates, mileage, duration charges, waiting policies, and surge limits.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            href="/pricing/preview"
            className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition"
          >
            Preview Calculator
          </Link>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
          >
            <Plus className="h-4 w-4" />
            <span>Create New Tariff Version</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {loading ? (
          <div className="text-slate-400 text-xs">Loading pricing configurations...</div>
        ) : (
          configs.map((c) => (
            <div key={c.id} className="p-6 rounded-xl border border-slate-200 bg-white shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{c.name}</h3>
                  <p className="text-xs text-indigo-700 font-mono font-semibold mt-0.5">{c.categoryName} • Version #{c.version}</p>
                </div>
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${c.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
                  {c.isActive ? 'ACTIVE VERSION' : 'ARCHIVED'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-100">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-500 font-medium">Base Fare:</span>
                  <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">{formatPaiseToInr(c.baseFarePaise)}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-500 font-medium">Per Km Rate:</span>
                  <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">{formatPaiseToInr(c.perKmPaise)} / km</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-500 font-medium">Per Minute Rate:</span>
                  <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">{formatPaiseToInr(c.perMinutePaise)} / min</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-500 font-medium">Minimum Trip Fare:</span>
                  <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">{formatPaiseToInr(c.minimumFarePaise)}</p>
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1">
                <p>Waiting Policy: First {c.freeWaitingSeconds}s free, then {formatPaiseToInr(c.waitingPerMinutePaise)}/min</p>
                <p>Surge Multiplier Range: {c.demandMultiplierMin}x to {c.demandMultiplierMax}x</p>
                <p className="text-[11px] text-slate-400 italic">Audit: {c.changeReason}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Create Versioned Fare Configuration</h3>
            <form onSubmit={handleCreateConfig} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Configuration Name</label>
                <input
                  type="text"
                  placeholder="e.g. Delhi Peak Surge Config v13"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-600">Base Fare (₹)</label>
                  <input
                    type="text"
                    value={baseFareInr}
                    onChange={(e) => setBaseFareInr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none font-mono focus:border-indigo-600"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600">Per Km Rate (₹)</label>
                  <input
                    type="text"
                    value={perKmInr}
                    onChange={(e) => setPerKmInr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none font-mono focus:border-indigo-600"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600">Per Minute Rate (₹)</label>
                  <input
                    type="text"
                    value={perMinuteInr}
                    onChange={(e) => setPerMinuteInr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none font-mono focus:border-indigo-600"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600">Minimum Trip Fare (₹)</label>
                  <input
                    type="text"
                    value={minFareInr}
                    onChange={(e) => setMinFareInr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none font-mono focus:border-indigo-600"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-600">Surge Minimum Multiplier</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    max="2.0"
                    value={surgeMin}
                    onChange={(e) => setSurgeMin(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none font-mono focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600">Surge Maximum Cap</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.0"
                    max="3.0"
                    value={surgeMax}
                    onChange={(e) => setSurgeMax(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none font-mono focus:border-indigo-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600">Mandatory Change Reason</label>
                <textarea
                  rows={2}
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Record justification for price matrix change..."
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
                  Publish Tariff Version
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}