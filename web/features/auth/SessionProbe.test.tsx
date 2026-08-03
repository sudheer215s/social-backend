import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { tokens } from '@/api-client';
import { server } from '@/mocks/server';
import { SessionProbe } from './SessionProbe';

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe('SessionProbe against MSW (F0-T08)', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
    tokens.clear();
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    tokens.set('msw-access-token', 600);
  });

  it('renders the current user from GET /v1/me', async () => {
    wrap(<SessionProbe />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /hello, msw user/i }),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId('username')).toHaveTextContent('@msw_user');
  });
});
