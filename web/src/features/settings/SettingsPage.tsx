import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getTenantId, setTenantId } from '../../api/client';
import { useProperties } from '../../api/hooks';
import { Money } from '../../components/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';

export function SettingsPage() {
  const properties = useProperties();
  const queryClient = useQueryClient();

  const [tenantInput, setTenantInput] = useState(() => getTenantId() ?? '');
  const [saved, setSaved] = useState(false);

  return (
    <div className="page">
      <h2>Settings</h2>

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
          <EmptyState message="No properties yet. Property creation from the dashboard is coming soon." />
        )}
        {properties.data?.map((property) => (
          <div key={property.id} className="property-block">
            <h4>
              {property.name} · {property.city}
            </h4>
            {property.roomTypes.length === 0 ? (
              <EmptyState message="No room types configured for this property." />
            ) : (
              <table className="data-table">
                <caption className="visually-hidden">
                  Room types for {property.name}
                </caption>
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
