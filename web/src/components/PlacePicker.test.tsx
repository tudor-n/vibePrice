import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlacePicker } from './PlacePicker';
import type { PlaceCandidate } from '../api/types';

const candidates: PlaceCandidate[] = [
  {
    placeId: 'place-1',
    name: 'Casa Luca',
    formattedAddress: 'Sibiu, Romania',
    rating: 4.5,
    ratingCount: 200,
  },
  {
    placeId: 'place-2',
    name: 'Casa Luca Boutique',
    formattedAddress: 'Sibiu Old Town',
    rating: 4.8,
    ratingCount: 12,
  },
];

describe('PlacePicker', () => {
  it('renders one radio per candidate with name, address, and rating', () => {
    render(<PlacePicker candidates={candidates} onPick={vi.fn()} onResearch={vi.fn()} />);

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(
      screen.getByLabelText(/Casa Luca · Sibiu, Romania · ★ 4\.5 \(200 reviews\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Casa Luca Boutique · Sibiu Old Town · ★ 4\.8 \(12 reviews\)/),
    ).toBeInTheDocument();
  });

  it('disables submit until a candidate is chosen, then calls onPick(placeId)', () => {
    const onPick = vi.fn();
    render(<PlacePicker candidates={candidates} onPick={onPick} onResearch={vi.fn()} />);

    const submit = screen.getByRole('button', { name: 'Use this place' });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Casa Luca Boutique/));
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onPick).toHaveBeenCalledWith('place-2');
  });

  it('calls onResearch(query) from the search-by-a-different-name field', () => {
    const onResearch = vi.fn();
    render(<PlacePicker candidates={[]} onPick={vi.fn()} onResearch={onResearch} />);

    fireEvent.change(screen.getByLabelText('Search by a different name'), {
      target: { value: 'Pensiunea Rustic, Brasov' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));

    expect(onResearch).toHaveBeenCalledWith('Pensiunea Rustic, Brasov');
  });

  it('disables both submits while pending', () => {
    render(<PlacePicker candidates={candidates} onPick={vi.fn()} onResearch={vi.fn()} pending />);

    expect(screen.getByRole('button', { name: 'Use this place' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Search again' })).toBeDisabled();
  });

  it('names radios uniquely per instance so two pickers on one page do not collide', () => {
    render(
      <div>
        <PlacePicker candidates={candidates} onPick={vi.fn()} onResearch={vi.fn()} />
        <PlacePicker candidates={candidates} onPick={vi.fn()} onResearch={vi.fn()} />
      </div>,
    );
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    const names = new Set(radios.map((radio) => radio.name));
    expect(names.size).toBe(2);
  });
});
