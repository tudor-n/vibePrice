import { useState } from 'react';
import { useEvents, useProperties } from '../../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';

function impactLevel(score: number): { className: string; label: string } {
  if (score >= 70) return { className: 'impact impact-high', label: 'High impact' };
  if (score >= 40) return { className: 'impact impact-medium', label: 'Medium impact' };
  return { className: 'impact impact-low', label: 'Low impact' };
}

export function EventsPage() {
  const properties = useProperties();
  const defaultCity = properties.data?.[0]?.city;
  const [cityOverride, setCityOverride] = useState<string | null>(null);
  const city = cityOverride ?? defaultCity;

  const events = useEvents(city);

  return (
    <div className="page">
      <h2>What&apos;s on</h2>
      <p className="page-intro">
        Concerts, festivals and holidays that bring visitors to your city —
        the busiest ones directly shape the prices we suggest.
      </p>

      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          City
          <input
            type="text"
            value={city ?? ''}
            placeholder="Sibiu"
            onChange={(event) => setCityOverride(event.target.value)}
          />
        </label>
      </form>

      {properties.isPending && !cityOverride && <LoadingState what="your city" />}
      {!city && !properties.isPending && (
        <EmptyState message="Type a city above to see what's coming up." />
      )}

      {city && events.isPending && <LoadingState what="events" />}
      {city && events.isError && <ErrorState error={events.error} />}
      {city && events.data && events.data.length === 0 && (
        <EmptyState message={`Nothing's coming up in ${city} right now.`} />
      )}

      {city && events.data && events.data.length > 0 && (
        <ul className="event-list">
          {[...events.data]
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map((event) => {
              const level = impactLevel(event.impactScore);
              return (
                <li key={event.id} className="event-item panel">
                  <div>
                    <h3>{event.name}</h3>
                    <p className="event-dates">
                      {event.startDate} → {event.endDate} · {event.city}
                    </p>
                  </div>
                  <span className={level.className}>
                    {level.label} · {event.impactScore}/100
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
