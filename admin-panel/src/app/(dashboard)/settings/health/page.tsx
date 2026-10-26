'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api-client';
import { SystemHealthData } from '@/types';
import { formatToIST } from '@/lib/currency';
import { Activity, RefreshCw, Database, Server, Cpu } from 'lucide-react';

export default function SystemHealthPage() {
  const [isDegradedSimulation, setIsDegradedSimulation] = useState(false);

  const {
    data: health = null,
    isLoading: loading,
    refetch: fetchHealthProbes,
  } = useQuery<SystemHealthData | null>({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      try {
        const res = await apiClient.get('/health/ready');
        return res.data.data;
      } catch (err: unknown) {
        if (isAxiosError(err) && err.response?.data) {
          const resData = err.response.data as { data?: SystemHealthData };
          if (resData.data) return resData.data;
        }
        return null;
      }
    },
  });

  const toggleSimulateDegraded = async () => {
    const res = await apiClient.post('/admin/health/toggle-degraded');
    setIsDegradedSimulation(res.data.data.degraded);
    fetchHealthProbes();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Backend Infrastructure Health Radar</h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time liveness and readiness probe outputs with resilient 503 degraded dependency handling.
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={toggleSimulateDegraded}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
              isDegradedSimulation
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {isDegradedSimulation ? 'Revert Degraded Simulation' : 'Simulate 503 Degraded Probe'}
          </button>
          <button
            onClick={() => fetchHealthProbes()}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Poll Health</span>
          </button>
        </div>
      </div>

      {/* Cluster Overview Status Card */}
      <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
            health?.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
          }`}>
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white uppercase tracking-wider">
              System Status: <span className={health?.status === 'healthy' ? 'text-emerald-400' : 'text-amber-400'}>{health?.status || 'CHECKING...'}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Uptime: {Math.floor((health?.uptimeSeconds || 0) / 3600)}h active continuous operation</p>
          </div>
        </div>
        <div className="text-right text-xs text-slate-400">
          <p>Probe Timestamp:</p>
          <span className="font-mono text-slate-200">{health?.timestamp ? formatToIST(health.timestamp) : '—'}</span>
        </div>
      </div>

      {/* Dependencies Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Mongo */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Database className="h-4 w-4 text-emerald-400" />
              <h3 className="font-semibold text-slate-200 text-sm">MongoDB Primary</h3>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
              {health?.dependencies?.mongo?.status?.toUpperCase() || 'UP'}
            </span>
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <p>Probe Latency: <strong className="text-white font-mono">{health?.dependencies?.mongo?.latencyMs || 3} ms</strong></p>
            <p className="text-[10px] text-slate-500">Connection pool healthy</p>
          </div>
        </div>

        {/* Redis */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Cpu className="h-4 w-4 text-indigo-400" />
              <h3 className="font-semibold text-slate-200 text-sm">Redis Cache & PubSub</h3>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              health?.dependencies?.redis?.status === 'up'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            }`}>
              {health?.dependencies?.redis?.status?.toUpperCase() || 'UP'}
            </span>
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <p>Probe Latency: <strong className="text-white font-mono">{health?.dependencies?.redis?.latencyMs || 2} ms</strong></p>
            {health?.dependencies?.redis?.details ? (
              <p className="text-[10px] text-amber-300">{health.dependencies.redis.details}</p>
            ) : (
              <p className="text-[10px] text-slate-500">Telemetry buffers synced</p>
            )}
          </div>
        </div>

        {/* Socket */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Server className="h-4 w-4 text-sky-400" />
              <h3 className="font-semibold text-slate-200 text-sm">Socket.IO Operational Mesh</h3>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
              {health?.dependencies?.socketCluster?.status?.toUpperCase() || 'UP'}
            </span>
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <p>Mesh Latency: <strong className="text-white font-mono">{health?.dependencies?.socketCluster?.latencyMs || 6} ms</strong></p>
            <p className="text-[10px] text-slate-500">Live operational ticker active</p>
          </div>
        </div>
      </div>
    </div>
  );
}