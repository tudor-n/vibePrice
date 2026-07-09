import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { EventsPage } from './EventsPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import type { EventItem, Property } from '../../api/types';

const property: Property = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Casa Luca',
  city: 'Sibiu',
  placeStatus: 'resolved',
  placeCandidates: [],
  roomTypes: [],
};

const fitsEvent: EventItem = {
  id: '0d9c3f9a-9a1f-4a8f-9a55-1c2b3d4e5f60',
  city: 'Sibiu',
  name: 'FITS',
  startDate: '2026-06-12',
  endDate: '2026-06-21',
  impactScore: 90,
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();
let propertyRows: Property[] = [];
let eventRows: EventItem[] = [];

beforeEach(() => {
  propertyRows = [property];
  eventRows = [];
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/properties')) return jsonResponse(propertyRows);
    if (url.includes('/events')) return jsonResponse(eventRows);
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
});

afterEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function renderPage() {
  return renderWithProviders(<EventsPage />);
}

describe('EventsPage — plain-language copy', () => {
  it('titles the page "What\'s on" with a jargon-free intro', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: "What's on" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Events' })).not.toBeInTheDocument();
  });

  it('invites typing a city when none is known yet', async () => {
    propertyRows = [];
    renderPage();
    expect(await screen.findByText("Type a city above to see what's coming up.")).toBeInTheDocument();
  });

  it('shows a plain, city-specific message when nothing is coming up', async () => {
    eventRows = [];
    renderPage();
    expect(await screen.findByText("Nothing's coming up in Sibiu right now.")).toBeInTheDocument();
  });

  it('lists events with the city typed in, keeping the impact label visible', async () => {
    eventRows = [fitsEvent];
    renderPage();
    expect(await screen.findByText('FITS')).toBeInTheDocument();
    expect(screen.getByText(/High impact/)).toBeInTheDocument();
    expect(screen.getByText(/90\/100/)).toBeInTheDocument();
  });

  it('lets the owner override the city by typing in the field', async () => {
    eventRows = [fitsEvent];
    renderPage();
    await screen.findByText('FITS');

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Brasov' } });
    expect(screen.getByLabelText('City')).toHaveValue('Brasov');
  });
});
