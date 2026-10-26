'use client';

import { useState, useEffect } from 'react';
import { runDay8VerificationSuite } from '@/tests/verification-matrix.test';
import { ShieldCheck, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

export default function VerificationMatrixPage() {
  const [suiteResult, setSuiteResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const executeSuite = () => {
    setRunning(true);
    setTimeout(() => {
      const res = runDay8VerificationSuite();
      setSuiteResult(res);
      setRunning(false);
    }, 300);
  };

  useEffect(() => {
    executeSuite();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Day 8: Full Acceptance Verification Matrix</h1>
            <p className="text-xs text-slate-500 mt-0.5">Automated QA assertions: Currency precision, RBAC boundaries, PII redaction & idempotency.</p>
          </div>
        </div>
        <button
          onClick={executeSuite}
          disabled={running}
          className="flex items-center space-x-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
        >
          <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          <span>{running ? 'Executing Tests...' : 'Re-run Test Matrix'}</span>
        </button>
      </div>

      {suiteResult && (
        <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-xs space-y-6">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs text-slate-500 uppercase font-semibold">Total Assertions</span>
              <p className="text-2xl font-bold text-slate-900 mt-1 font-mono">{suiteResult.total}</p>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <span className="text-xs text-emerald-700 uppercase font-semibold">Passed</span>
              <p className="text-2xl font-bold text-emerald-700 mt-1 font-mono">{suiteResult.passed}</p>
            </div>
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
              <span className="text-xs text-rose-700 uppercase font-semibold">Failed</span>
              <p className="text-2xl font-bold text-rose-700 mt-1 font-mono">{suiteResult.failed}</p>
            </div>
          </div>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden">
            {suiteResult.results.map((r: any, idx: number) => (
              <div key={idx} className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/80 transition">
                <div className="flex items-center space-x-3">
                  {r.status === 'PASS' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  )}
                  <div>
                    <p className="font-semibold text-slate-900">{r.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{r.message}</p>
                  </div>
                </div>
                <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                  r.status === 'PASS' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}