'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { formatPaiseToInr } from '@/lib/currency';
import { ArrowLeft, Calculator } from 'lucide-react';

interface SimulatedFareResult {
  configVersion: number;
  breakdown: {
    baseFarePaise: number;
    distanceFarePaise: number;
    timeFarePaise: number;
    estimatedTotalPaise: number;
  };
}

export default function PricingPreviewPage() {
  const [distanceKm, setDistanceKm] = useState('18.5');
  const [durationMins, setDurationMins] = useState('45');
  const [result, setResult] = useState<SimulatedFareResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await apiClient.post('/admin/pricing/preview', {
        distanceMeters: parseFloat(distanceKm) * 1000,
        durationSeconds: parseInt(durationMins, 10) * 60,
        configId: 'pc_sedan_v12',
      });
      setResult(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center space-x-3">
        <Link href="/pricing/configs" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 shadow-xs transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Tariff Calculation Preview Desk</h1>
          <p className="text-xs text-slate-500 mt-0.5">Test distance and duration inputs against active fare rules without creating bookings.</p>
        </div>
      </div>

      <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-xs space-y-6">
        <form onSubmit={handleCalculate} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-600 uppercase tracking-wider">Estimated Distance (km)</label>
              <input
                type="number"
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-indigo-600"
                required
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-600 uppercase tracking-wider">Estimated Duration (mins)</label>
              <input
                type="number"
                value={durationMins}
                onChange={(e) => setDurationMins(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 font-mono focus:outline-none focus:border-indigo-600"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center space-x-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-xs transition"
          >
            <Calculator className="h-4 w-4" />
            <span>{loading ? 'Evaluating Tariff...' : 'Run Simulation'}</span>
          </button>
        </form>

        {result && (
          <div className="p-5 rounded-xl border border-indigo-100 bg-indigo-50/50 space-y-3">
            <h3 className="text-sm font-bold text-indigo-900">Simulated Fare Breakdown (Version #{result.configVersion})</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs">
                <span className="text-slate-500">Base Fare:</span>
                <p className="font-mono font-bold text-slate-900 mt-0.5">{formatPaiseToInr(result.breakdown.baseFarePaise)}</p>
              </div>
              <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs">
                <span className="text-slate-500">Distance Component:</span>
                <p className="font-mono font-bold text-slate-900 mt-0.5">{formatPaiseToInr(result.breakdown.distanceFarePaise)}</p>
              </div>
              <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs">
                <span className="text-slate-500">Time Component:</span>
                <p className="font-mono font-bold text-slate-900 mt-0.5">{formatPaiseToInr(result.breakdown.timeFarePaise)}</p>
              </div>
              <div className="p-3 bg-white rounded-lg border border-indigo-200 shadow-xs">
                <span className="text-indigo-700 font-semibold">Total Estimated Fare:</span>
                <p className="font-mono font-bold text-emerald-700 text-base mt-0.5">{formatPaiseToInr(result.breakdown.estimatedTotalPaise)}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}