/**
 * Setup step 4: nearby competitors, auto-discovered in the background
 * (discover_competitors is chain-enqueued from resolve_place — see
 * shared/contracts/jobs.md). This step opts into `useCompetitors`'s polling
 * ({ poll: true }) so the list fills in every 3s while empty and the wizard
 * advances itself without a reload; polling is off by default elsewhere (e.g.
 * the Competitors page, where "zero competitors" can be a permanent state).
 * `reDiscover` re-fires resolve-place, which chain-enqueues discovery again —
 * a lightweight retry that doesn't require a dedicated endpoint.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCompetitors, useResolveProperty } from '../../../api/hooks';
import { AsyncStatus } from '../../../components/AsyncStatus';
import { ErrorState } from '../../../components/States';
import { formatRating } from '../../../components/formatRating';
import type { Property } from '../../../api/types';

export function StepCompetitors({ property }: { property: Property }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const competitors = useCompetitors(property.id, { poll: true });
  const resolveProperty = useResolveProperty();

  const list = competitors.data ?? [];

  function reDiscover() {
    resolveProperty.mutate({ propertyId: property.id });
  }

  return (
    <div className="setup-step">
      <h1 ref={headingRef} tabIndex={-1}>
        Finding hotels near you…
      </h1>
      <p className="page-intro">
        We look for hotels and guesthouses near you on Google, so every price
        we suggest is compared to what they are charging.
      </p>

      {list.length === 0 ? (
        <AsyncStatus
          phase="working"
          workingText="Looking on Google now…"
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
