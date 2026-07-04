import { useState } from 'react';
import { useCompetitors } from '../../api/hooks';
import { useSelectedProperty } from '../../app/PropertyContext';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { Money } from '../../components/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';

export function CompetitorsPage() {
  // Property comes from the app-wide selector in the header.
  const { properties, property } = useSelectedProperty();
  const competitors = useCompetitors(property?.id);

  // Form stub: tracking a new competitor will POST to
  // /properties/{id}/competitors once the backend endpoint is live.
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [stubMessage, setStubMessage] = useState<string | null>(null);

  if (properties.isPending) return <LoadingState what="your properties" />;
  if (properties.isError) return <ErrorState error={properties.error} />;
  if (!properties.data || properties.data.length === 0) {
    return <EmptyState message="Add a property in Settings before tracking competitors." />;
  }

  return (
    <div className="page">
      <h2>Competitors</h2>
      <p className="page-intro">
        The properties we watch for you, with their most recently scraped
        nightly rates.
      </p>

      {competitors.isPending && <LoadingState what="competitors" />}
      {competitors.isError && <ErrorState error={competitors.error} />}
      {competitors.data && competitors.data.length === 0 && (
        <EmptyState message="No competitors tracked yet. Add one below with its booking-site URL." />
      )}

      {competitors.data?.map((competitor) => (
        <section key={competitor.id} className="panel">
          <div className="panel-header">
            <h3>{competitor.name}</h3>
            <a href={competitor.sourceUrl} target="_blank" rel="noreferrer">
              View listing
            </a>
          </div>
          {competitor.latestRates.length === 0 ? (
            <EmptyState message="No rates captured yet for this competitor." />
          ) : (
            <table className="data-table">
              <caption className="visually-hidden">
                Latest scraped rates for {competitor.name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Stay date</th>
                  <th scope="col">Nightly rate</th>
                  <th scope="col">Captured</th>
                </tr>
              </thead>
              <tbody>
                {competitor.latestRates.map((rate) => (
                  <tr key={`${rate.stayDate}-${rate.capturedAt}`}>
                    <td>{rate.stayDate}</td>
                    <td>
                      <Money amount={rate.price} currency={rate.currency} />
                    </td>
                    <td>
                      <FreshnessBadge label="rate" timestamp={rate.capturedAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      <section className="panel">
        <h3>Track a new competitor</h3>
        <form
          className="stacked-form"
          onSubmit={(event) => {
            event.preventDefault();
            // TODO: wire to POST /properties/{propertyId}/competitors.
            setStubMessage(
              `Got it — "${newName || 'this competitor'}" will be trackable once competitor management ships.`,
            );
          }}
        >
          <label className="field">
            Competitor name
            <input
              type="text"
              value={newName}
              placeholder="Hotel Împăratul Romanilor"
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label className="field">
            Booking site URL
            <input
              type="url"
              value={newUrl}
              placeholder="https://www.booking.com/hotel/…"
              onChange={(event) => setNewUrl(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={newUrl.trim() === ''}>
            Start tracking
          </button>
        </form>
        {stubMessage && (
          <p className="state state-loading" role="status">
            {stubMessage}
          </p>
        )}
      </section>
    </div>
  );
}
