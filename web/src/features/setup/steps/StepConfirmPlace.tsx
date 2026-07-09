/**
 * Setup step 2: confirm the Google place resolved for the new property.
 * `placeStatus` stays "unresolved" both while the resolve_place job hasn't
 * finished yet (no candidates) AND after it has (candidates present, owner
 * hasn't picked one) — see shared/contracts/place-candidates.md. This step
 * shows the working status for the first case and the picker for the rest.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePickPlace, useResolveProperty } from '../../../api/hooks';
import { AsyncStatus } from '../../../components/AsyncStatus';
import { PlacePicker } from '../../../components/PlacePicker';
import { ErrorState } from '../../../components/States';
import type { Property } from '../../../api/types';

export function StepConfirmPlace({ property }: { property: Property }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const navigate = useNavigate();
  const pickPlace = usePickPlace();
  const resolveProperty = useResolveProperty();

  const stillSearching = property.placeStatus === 'unresolved' && property.placeCandidates.length === 0;

  return (
    <div className="setup-step">
      <h1 ref={headingRef} tabIndex={-1}>
        Is this your place?
      </h1>
      <p className="page-intro">
        We searched Google for {property.name} in {property.city}.
      </p>

      {property.placeStatus === 'failed' && (
        <p className="state state-error" role="alert">
          We couldn&apos;t find it on Google. Try searching with a different name below.
        </p>
      )}

      {stillSearching ? (
        <AsyncStatus
          phase="working"
          workingText="Finding your place on Google…"
          onRetry={() => resolveProperty.mutate({ propertyId: property.id })}
          onBackground={() => navigate('/')}
        />
      ) : (
        <PlacePicker
          candidates={property.placeCandidates}
          pending={pickPlace.isPending || resolveProperty.isPending}
          onPick={(placeId) => pickPlace.mutate({ propertyId: property.id, placeId })}
          onResearch={(query) =>
            resolveProperty.mutate({
              propertyId: property.id,
              query: query.trim() === '' ? undefined : query.trim(),
            })
          }
        />
      )}
      {pickPlace.isError && <ErrorState error={pickPlace.error} />}
      {resolveProperty.isError && <ErrorState error={resolveProperty.error} />}
    </div>
  );
}
