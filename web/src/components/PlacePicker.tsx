/**
 * Candidate picker + free-text re-search: pick the right Google Place from a
 * list of candidates, or search again by a different name. Generalized from
 * the markup that used to live inline in SettingsPage's PlaceCorrection —
 * radios are named per PlacePicker instance (useId) so several pickers can
 * render on one page without their candidate groups colliding.
 */

import { useId, useState } from 'react';
import type { PlaceCandidate } from '../api/types';

export interface PlacePickerProps {
  candidates: PlaceCandidate[];
  onPick: (placeId: string) => void;
  onResearch: (query: string) => void;
  pending?: boolean;
}

/** "★ 4.5 (200 reviews)", or null when there is no rating on file yet. */
function formatRating(rating?: number, ratingCount?: number): string | null {
  if (typeof rating !== 'number') return null;
  const count =
    typeof ratingCount === 'number'
      ? ` (${ratingCount} review${ratingCount === 1 ? '' : 's'})`
      : '';
  return `★ ${rating.toFixed(1)}${count}`;
}

export function PlacePicker({ candidates, onPick, onResearch, pending = false }: PlacePickerProps) {
  const groupId = useId();
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [query, setQuery] = useState('');

  return (
    <div className="place-picker">
      {candidates.length > 0 && (
        <form
          className="stacked-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedCandidate) return;
            onPick(selectedCandidate);
          }}
        >
          <fieldset className="field">
            <legend>Pick the right place</legend>
            {candidates.map((candidate) => {
              const ratingText = formatRating(candidate.rating, candidate.ratingCount);
              return (
                <label key={candidate.placeId} className="candidate-option">
                  <input
                    type="radio"
                    name={`place-candidate-${groupId}`}
                    value={candidate.placeId}
                    checked={selectedCandidate === candidate.placeId}
                    onChange={() => setSelectedCandidate(candidate.placeId)}
                  />
                  <span>
                    {candidate.name}
                    {candidate.formattedAddress && ` · ${candidate.formattedAddress}`}
                    {ratingText && ` · ${ratingText}`}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={!selectedCandidate || pending}
          >
            Use this place
          </button>
        </form>
      )}

      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          onResearch(query.trim());
        }}
      >
        <label className="field">
          Search by a different name
          <input
            type="text"
            value={query}
            placeholder="e.g. Pensiunea Rustic, Brașov"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          Search again
        </button>
      </form>
    </div>
  );
}
