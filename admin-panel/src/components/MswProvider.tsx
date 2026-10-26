'use client';

import { useEffect, useState } from 'react';

export function MswProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_USE_MOCKS !== 'false') {
      import('@/mocks/browser')
        .then(({ worker }) => worker.start())
        .then(() => setReady(true))
        .catch(() => setReady(true));
    } else {
      setReady(true);
    }
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white font-sans">
        <div className="flex items-center space-x-3 text-sm tracking-wide">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <span>Starting Admin Panel Engine...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
