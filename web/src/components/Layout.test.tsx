import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Layout } from './Layout';
import { PropertyProvider } from '../app/PropertyContext';
import { renderWithProviders } from '../test/renderWithProviders';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('Layout — navigation', () => {
  it('uses plain-language labels; routes and icons stay unchanged', async () => {
    renderWithProviders(
      <PropertyProvider>
        <Layout />
      </PropertyProvider>,
    );
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });

    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Prices to review' })).toHaveAttribute(
      'href',
      '/recommendations',
    );
    expect(within(nav).getByRole('link', { name: 'Nearby hotels' })).toHaveAttribute(
      'href',
      '/competitors',
    );
    expect(within(nav).getByRole('link', { name: "What's on" })).toHaveAttribute(
      'href',
      '/events',
    );
    expect(within(nav).getByRole('link', { name: 'Your hotel' })).toHaveAttribute(
      'href',
      '/settings',
    );

    // The old jargon labels are gone.
    expect(within(nav).queryByText('Dashboard')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Recommendations')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Competitors')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Events')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Settings')).not.toBeInTheDocument();
  });
});
