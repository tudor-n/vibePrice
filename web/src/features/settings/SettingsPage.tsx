import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getTenantId, setTenantId } from '../../api/client';
import {
  useCreateProperty,
  usePickPlace,
  useProperties,
  useResolveProperty,
} from '../../api/hooks';
import { AsyncStatus } from '../../components/AsyncStatus';
import { Money } from '../../components/Money';
import { PlacePicker } from '../../components/PlacePicker';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { formatRating } from '../../components/formatRating';
import type { Property } from '../../api/types';

function PropertyCard({ property }: { property: Property }) {
  const pickPlace = usePickPlace();
  const resolveProperty = useResolveProperty();
  const ratingText = formatRating(property.rating, property.ratingCount);

  // The "search by a different name" field always submits a string (an
  // empty one means "search again using the property's own name") —
  // convert '' to undefined so useResolveProperty falls back to that.
  function research(query: string) {
    resolveProperty.mutate({
      propertyId: property.id,
      query: query === '' ? undefined : query,
    });
  }

  // Candidate picker + free-text re-search, shared by the "resolved"
  // (tucked under "Not the right place?") and "failed" (shown directly)
  // states. Built once so the pending/error rendering isn't duplicated.
  const picker = (
    <>
      <PlacePicker
        candidates={property.placeCandidates}
        pending={pickPlace.isPending || resolveProperty.isPending}
        onPick={(placeId) => pickPlace.mutate({ propertyId: property.id, placeId })}
        onResearch={research}
      />
      {pickPlace.isError && <ErrorState error={pickPlace.error} />}
      {resolveProperty.isError && <ErrorState error={resolveProperty.error} />}
    </>
  );

  return (
    <div className="property-block">
      <h4>
        {property.name} · {property.city}
      </h4>

      {property.placeStatus === 'unresolved' && (
        <AsyncStatus
          phase="working"
          workingText="Finding your place on Google…"
          onRetry={() => resolveProperty.mutate({ propertyId: property.id })}
        />
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
          {picker}
        </details>
      )}

      {property.placeStatus === 'failed' && picker}

      {property.roomTypes.length === 0 ? (
        <EmptyState
          message="You haven't added a room type yet."
          action={{ label: 'Add a room type', to: '/setup' }}
        />
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
        Tell us the name and city, and we&apos;ll find it on Google
        automatically — then start keeping an eye on nearby hotels for you.
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
      <h2>Your hotel</h2>

      <AddPropertyForm />

      <section className="panel">
        <h3>Your properties and base prices</h3>
        <p className="page-intro">
          Base prices are the starting point for every price we suggest.
          Editing them here is coming soon — for now they&apos;re managed by
          your onboarding contact.
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
