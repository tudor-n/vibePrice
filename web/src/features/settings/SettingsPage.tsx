import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getTenantId, setTenantId } from '../../api/client';
import {
  useCreateProperty,
  usePickPlace,
  useProperties,
  useResolveProperty,
} from '../../api/hooks';
import { Money } from '../../components/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import type { Property } from '../../api/types';

/** "★ 4.5 (200 reviews)", or null when there is no rating on file yet. */
function formatRating(rating?: number, ratingCount?: number): string | null {
  if (typeof rating !== 'number') return null;
  const count =
    typeof ratingCount === 'number'
      ? ` (${ratingCount} review${ratingCount === 1 ? '' : 's'})`
      : '';
  return `★ ${rating.toFixed(1)}${count}`;
}

/**
 * Candidate picker + free-text re-search, shared by the "resolved" (tucked
 * under "Not the right place?") and "failed" (shown directly) property card
 * states. One hook instance per property card keeps mutation state isolated
 * when several properties render at once.
 */
function PlaceCorrection({ property }: { property: Property }) {
  const pickPlace = usePickPlace();
  const resolveProperty = useResolveProperty();
  const [selectedCandidate, setSelectedCandidate] = useState('');
  const [query, setQuery] = useState('');

  return (
    <div className="place-correction">
      {property.placeCandidates.length > 0 && (
        <form
          className="stacked-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedCandidate) return;
            pickPlace.mutate({ propertyId: property.id, placeId: selectedCandidate });
          }}
        >
          <fieldset className="field">
            <legend>Pick the right place</legend>
            {property.placeCandidates.map((candidate) => {
              const ratingText = formatRating(candidate.rating, candidate.ratingCount);
              return (
                <label key={candidate.placeId} className="candidate-option">
                  <input
                    type="radio"
                    name={`place-candidate-${property.id}`}
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
            disabled={!selectedCandidate || pickPlace.isPending}
          >
            Use this place
          </button>
          {pickPlace.isError && <ErrorState error={pickPlace.error} />}
        </form>
      )}

      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          resolveProperty.mutate({
            propertyId: property.id,
            query: query.trim() === '' ? undefined : query.trim(),
          });
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
        <button type="submit" className="btn btn-secondary" disabled={resolveProperty.isPending}>
          Search again
        </button>
        {resolveProperty.isError && <ErrorState error={resolveProperty.error} />}
        {resolveProperty.isSuccess && (
          <p className="state state-loading" role="status">
            Searching Google again — this can take a minute.
          </p>
        )}
      </form>
    </div>
  );
}

function PropertyCard({ property }: { property: Property }) {
  const ratingText = formatRating(property.rating, property.ratingCount);

  return (
    <div className="property-block">
      <h4>
        {property.name} · {property.city}
      </h4>

      {property.placeStatus === 'unresolved' && (
        <p className="state state-loading" role="status">
          Finding your place on Google…
        </p>
      )}

      {property.placeStatus === 'resolved' && (
        <div className="place-summary">
          <p>{property.address ?? property.city}</p>
          {ratingText && <p>{ratingText}</p>}
          {typeof property.latitude === 'number' && typeof property.longitude === 'number' && (
            <span className="place-chip">
              Map pin: {property.latitude.toFixed(4)}, {property.longitude.toFixed(4)}
            </span>
          )}
        </div>
      )}

      {property.placeStatus === 'failed' && (
        <p className="state state-error" role="alert">
          We couldn&apos;t find it on Google. Try searching with a different name below.
        </p>
      )}

      {property.placeStatus === 'resolved' && (
        <details className="place-correction-toggle">
          <summary>Not the right place?</summary>
          <PlaceCorrection property={property} />
        </details>
      )}

      {property.placeStatus === 'failed' && <PlaceCorrection property={property} />}

      {property.roomTypes.length === 0 ? (
        <EmptyState message="No room types configured for this property." />
      ) : (
        <table className="data-table">
          <caption className="visually-hidden">Room types for {property.name}</caption>
          <thead>
            <tr>
              <th scope="col">Room type</th>
              <th scope="col">Sleeps</th>
              <th scope="col">Base price</th>
              <th scope="col">Current price</th>
            </tr>
          </thead>
          <tbody>
            {property.roomTypes.map((roomType) => (
              <tr key={roomType.id}>
                <td>{roomType.name}</td>
                <td>{roomType.capacity}</td>
                <td>
                  <Money amount={roomType.basePrice} currency={roomType.currency} />
                </td>
                <td>
                  <Money amount={roomType.currentPrice} currency={roomType.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AddPropertyForm() {
  const createProperty = useCreateProperty();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [justCreated, setJustCreated] = useState(false);

  const canSubmit = name.trim() !== '' && city.trim() !== '' && !createProperty.isPending;

  return (
    <section className="panel">
      <h3>Add your property</h3>
      <p className="page-intro">
        Tell us the name and city, and we&apos;ll find it on Google automatically
        — then start watching nearby competitors for you.
      </p>
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          createProperty.mutate(
            { name: name.trim(), city: city.trim() },
            {
              onSuccess: () => {
                setName('');
                setCity('');
                setJustCreated(true);
              },
            },
          );
        }}
      >
        <label className="field">
          Property name
          <input
            type="text"
            value={name}
            placeholder="Casa Luca"
            onChange={(event) => {
              setName(event.target.value);
              setJustCreated(false);
            }}
          />
        </label>
        <label className="field">
          City
          <input
            type="text"
            value={city}
            placeholder="Sibiu"
            onChange={(event) => {
              setCity(event.target.value);
              setJustCreated(false);
            }}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Add property
        </button>
      </form>
      {createProperty.isError && <ErrorState error={createProperty.error} />}
      {justCreated && (
        <p className="state state-loading" role="status">
          Added! We&apos;re looking it up on Google now.
        </p>
      )}
    </section>
  );
}

export function SettingsPage() {
  const properties = useProperties();
  const queryClient = useQueryClient();

  const [tenantInput, setTenantInput] = useState(() => getTenantId() ?? '');
  const [saved, setSaved] = useState(false);

  return (
    <div className="page">
      <h2>Settings</h2>

      <AddPropertyForm />

      <section className="panel">
        <h3>Your properties and base prices</h3>
        <p className="page-intro">
          Base prices are the starting point for every recommendation. Editing
          them here is coming soon — for now they are managed by your onboarding
          contact.
        </p>
        {properties.isPending && <LoadingState what="your properties" />}
        {properties.isError && <ErrorState error={properties.error} />}
        {properties.data && properties.data.length === 0 && (
          <EmptyState message="No properties yet. Add one above to get started." />
        )}
        {properties.data?.map((property) => (
          <PropertyCard key={property.id} property={property} />
        ))}
      </section>

      <section className="panel">
        <h3>Developer: tenant</h3>
        <p className="page-intro">
          Dev-only stub — sets the <code>X-Tenant-Id</code> header for API
          calls. Replaced by real sign-in before launch.
        </p>
        <form
          className="stacked-form"
          onSubmit={(event) => {
            event.preventDefault();
            setTenantId(tenantInput);
            setSaved(true);
            // New tenant means all cached server state is invalid.
            void queryClient.invalidateQueries();
          }}
        >
          <label className="field">
            Tenant ID
            <input
              type="text"
              value={tenantInput}
              placeholder="00000000-0000-0000-0000-000000000000"
              onChange={(event) => {
                setTenantInput(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <button type="submit" className="btn btn-primary">
            Save tenant
          </button>
        </form>
        {saved && (
          <p className="state state-loading" role="status">
            Tenant saved. Data on all pages now loads for this tenant.
          </p>
        )}
      </section>
    </div>
  );
}
