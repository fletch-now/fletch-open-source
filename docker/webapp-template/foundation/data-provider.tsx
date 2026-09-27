import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
interface Props { children: ReactNode; }

export function DataProvider({ children }: Props): ReactElement {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
