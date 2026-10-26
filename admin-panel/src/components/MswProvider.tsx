'use client';

import { useEffect } from 'react';
import { ensureMswReady } from '@/lib/api-client';

export function MswProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    ensureMswReady();
  }, []);

  return <>{children}</>;
}
