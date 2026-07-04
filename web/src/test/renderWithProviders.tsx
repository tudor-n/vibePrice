/**
 * Test render helper: wraps a UI tree in the providers the app supplies at
 * runtime (react-query + a memory router). Pass `routes` to mount additional
 * destinations (e.g. a probe element for redirect assertions).
 */

import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

export interface ExtraRoute {
  path: string;
  element: ReactElement;
}

export function renderWithProviders(
  ui: ReactNode,
  {
    route = '/',
    path = '/',
    routes = [],
  }: { route?: string; path?: string; routes?: ExtraRoute[] } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
          {routes.map((extra) => (
            <Route key={extra.path} path={extra.path} element={extra.element} />
          ))}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
