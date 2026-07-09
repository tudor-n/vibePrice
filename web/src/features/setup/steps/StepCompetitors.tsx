/**
 * Setup step 4: nearby competitors, auto-discovered in the background
 * (discover_competitors is chain-enqueued from resolve_place — see
 * shared/contracts/jobs.md). `useCompetitors` polls every 3s while the list
 * is empty (see `competitorsRefetchInterval` in api/hooks.ts) so this step
 * clears itself without a reload. `reDiscover` re-fires resolve-place, which
 * chain-enqueues discovery again — a lightweight retry that doesn't require
 * a dedicated endpoint.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCompetitors, useResolveProperty } from '../../../api/hooks';
import { AsyncStatus } from '../../../components/AsyncStatus';
import { ErrorState } from '../../../components/States';
import type { Property } from '../../../api/types';

/** "★ 4.5 (200 reviews)", or null when there is no rating on file yet. */
function formatRating(rating?: number, ratingCount?: number): string | null {
  if (typeof rating !== 'number') return null;
  const count =
    typeof ratingCount === 'number'
      ? ` (${ratingCount} review${ratingCount === 1 ? '' : 's'})`
      : '';
  return `★ ${rating.toFixed(1)}${count}`;
}

export function StepCompetitors({ property }: { property: Property }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const competitors = useCompetitors(property.id);
  const resolveProperty = useResolveProperty();

  const list = competitors.data ?? [];

  function reDiscover() {
    resolveProperty.mutate({ propertyId: property.id });
  }

  return (
    <div className="setup-step">
      <h1 ref={headingRef} tabIndex={-1}>
        Finding your competitors…
      </h1>
      <p className="page-intro">
        We look for hotels and guesthouses near you on Google, so every price
        we suggest is compared to what they are charging.
      </p>

      {list.length === 0 ? (
        <AsyncStatus
          phase="working"
          workingText="Finding hotels near you…"
          failedText="We couldn't finish finding nearby hotels."
          timeoutMs={40000}
          onRetry={reDiscover}
          onBackground={() => navigate('/')}
        />
      ) : (
        <>
          <ul className="discovered-list">
            {list.map((competitor) => {
              const ratingText = formatRating(competitor.rating, competitor.ratingCount);
              return (
                <li key={competitor.id} className="discovered-item">
                  <span className="discovered-item-name">{competitor.name}</span>
                  <span className="discovered-item-rating">{ratingText ?? 'No rating yet'}</span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              // The wizard's own step derivation already reacts to this same
              // competitors query (see useSetupProgress); invalidating here
              // just means "don't make me wait for the next poll tick".
              void queryClient.invalidateQueries({ queryKey: ['competitors', property.id] });
            }}
          >
            Next
          </button>
        </>
      )}

      {competitors.isError && <ErrorState error={competitors.error} />}
      {resolveProperty.isError && <ErrorState error={resolveProperty.error} />}
    </div>
  );
}
