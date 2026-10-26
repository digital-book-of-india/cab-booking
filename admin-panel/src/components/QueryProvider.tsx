'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000, // 30 seconds fresh
            gcTime: 5 * 60 * 1000, // 5 minutes cache
            refetchOnWindowFocus: false,
            retry: (failureCount, error: unknown) => {
              // Don't retry on 4xx client errors (400, 401, 403, 404, 422)
              const status =
                (error as { response?: { status?: number } })?.response?.status ||
                (error as { status?: number })?.status;
              if (status && status >= 400 && status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
