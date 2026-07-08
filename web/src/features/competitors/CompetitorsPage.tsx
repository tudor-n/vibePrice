import { useState } from 'react';
import { useCompetitors, useUntrackCompetitor } from '../../api/hooks';
import { useSelectedProperty } from '../../app/PropertyContext';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { Money } from '../../components/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import type { Competitor } from '../../api/types';

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two lat/lng points, for the display-only
 * "N km away" caption. Not money — client-side computation is fine here.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** "★ 4.3 (512 reviews)", or null when there is no rating on file yet. */
function formatRating(rating?: number, ratingCount?: number): string | null {
  if (typeof rating !== 'number') return null;
  const count =
    typeof ratingCount === 'number'
      ? ` (${ratingCount} review${ratingCount === 1 ? '' : 's'})`
      : '';
  return `★ ${rating.toFixed(1)}${count}`;
}

function CompetitorRow({
  competitor,
  distanceKm,
}: {
  competitor: Competitor;
  distanceKm: number | null;
}) {
  const untrackCompetitor = useUntrackCompetitor();
  const [confirming, setConfirming] = useState(false);
  const ratingText = formatRating(competitor.rating, competitor.ratingCount);

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>{competitor.name}</h3>
        {competitor.sourceUrl && (
          <a href={competitor.sourceUrl} target="_blank" rel="noreferrer">
            View listing
          </a>
        )}
      </div>
      <p>
        {ratingText ?? 'No rating yet'}
        {distanceKm !== null && ` · ${distanceKm.toFixed(1)} km away`}
      </p>

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

      {confirming ? (
        <div className="untrack-confirm">
          <p>This competitor stays removed from your tracking.</p>
          <div className="rec-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={untrackCompetitor.isPending}
              onClick={() =>
                untrackCompetitor.mutate(competitor.id, {
                  onSuccess: () => setConfirming(false),
                })
              }
            >
              Yes, untrack
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
          {untrackCompetitor.isError && <ErrorState error={untrackCompetitor.error} />}
        </div>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
          Untrack
        </button>
      )}
    </section>
  );
}

export function CompetitorsPage() {
  // Property comes from the app-wide selector in the header.
  const { properties, property } = useSelectedProperty();
  const competitors = useCompetitors(property?.id);

  if (properties.isPending) return <LoadingState what="your properties" />;
  if (properties.isError) return <ErrorState error={properties.error} />;
  if (!properties.data || properties.data.length === 0) {
    return <EmptyState message="Add a property in Settings before tracking competitors." />;
  }

  return (
    <div className="page">
      <h2>Competitors</h2>
      <p className="page-intro">
        We automatically discover nearby competitors on Google and keep an
        eye on their most recently scraped nightly rates.
      </p>

      {competitors.isPending && <LoadingState what="competitors" />}
      {competitors.isError && <ErrorState error={competitors.error} />}
      {competitors.data && competitors.data.length === 0 && (
        <EmptyState message="No competitors discovered yet. Check back after your property is resolved on Google." />
      )}

      {competitors.data?.map((competitor) => {
        const distanceKm =
          property &&
          typeof property.latitude === 'number' &&
          typeof property.longitude === 'number' &&
          typeof competitor.latitude === 'number' &&
          typeof competitor.longitude === 'number'
            ? haversineDistanceKm(
                property.latitude,
                property.longitude,
                competitor.latitude,
                competitor.longitude,
              )
            : null;
        return (
          <CompetitorRow key={competitor.id} competitor={competitor} distanceKm={distanceKm} />
        );
      })}
    </div>
  );
}
