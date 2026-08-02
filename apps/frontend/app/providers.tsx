"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/shared/toast";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { HierarchyConfigProvider } from "@/hooks/use-hierarchy-config";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            // Keep showing the previous page's rows while the next one loads,
            // so paging and filtering do not flash an empty table.
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            /**
             * Retry transient failures only. Retrying a 401/403/404 just delays
             * the error the user needs to see, and re-sending a rejected write
             * is worse than useless.
             */
            retry: (failureCount, error: any) => {
              const status = error?.response?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
          },
          mutations: {
            // A write is never retried automatically: it may have already been
            // applied, and a duplicate payment record is unrecoverable.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HierarchyConfigProvider>
        <ToastProvider>
          <ErrorBoundary label="app">{children}</ErrorBoundary>
        </ToastProvider>
      </HierarchyConfigProvider>
    </QueryClientProvider>
  );
}
