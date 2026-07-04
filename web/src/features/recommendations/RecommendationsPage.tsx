import { useMemo, useState } from 'react';
import {
  useRecommendations,
  useUpdateRecommendationStatus,
} from '../../api/hooks';
import { useSelectedProperty } from '../../app/PropertyContext';
import type { Recommendation } from '../../api/types';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { RecommendationCard } from './RecommendationCard';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + 30);
  return { from: isoDate(from), to: isoDate(to) };
}

/** Group recommendations by stay month so owners scan period by period. */
function groupByPeriod(recommendations: Recommendation[]): Map<string, Recommendation[]> {
  const groups = new Map<string, Recommendation[]>();
  const sorted = [...recommendations].sort((a, b) =>
    a.stayDate.localeCompare(b.stayDate),
  );
  const monthFormat = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
  });
  for (const recommendation of sorted) {
    const parsed = Date.parse(recommendation.stayDate);
    const label = Number.isNaN(parsed)
      ? 'Unknown period'
      : monthFormat.format(parsed);
    const bucket = groups.get(label);
    if (bucket) {
      bucket.push(recommendation);
    } else {
      groups.set(label, [recommendation]);
    }
  }
  return groups;
}

export function RecommendationsPage() {
  const [{ from, to }, setRange] = useState(defaultRange);
  // Property comes from the app-wide selector in the header.
  const { properties, property } = useSelectedProperty();

  const recommendations = useRecommendations(property?.id, from, to);
  const updateStatus = useUpdateRecommendationStatus();

  const roomTypeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const roomType of property?.roomTypes ?? []) {
      names.set(roomType.id, roomType.name);
    }
    return names;
  }, [property]);

  if (properties.isPending) return <LoadingState what="your properties" />;
  if (properties.isError) return <ErrorState error={properties.error} />;
  if (!properties.data || properties.data.length === 0) {
    return (
      <EmptyState message="No properties yet. Add your first property in Settings to start receiving price recommendations." />
    );
  }

  const groups = recommendations.data ? groupByPeriod(recommendations.data) : null;

  return (
    <div className="page">
      <h2>Recommendations</h2>
      <p className="page-intro">
        Suggested prices for upcoming stay dates, each with the full reasoning.
        Accept the ones you agree with — nothing changes without your approval.
      </p>

      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setRange((r) => ({ ...r, from: event.target.value }))}
          />
        </label>
        <label className="field">
          To
          <input
            type="date"
            value={to}
            onChange={(event) => setRange((r) => ({ ...r, to: event.target.value }))}
          />
        </label>
      </form>

      {updateStatus.isError && <ErrorState error={updateStatus.error} />}

      {recommendations.isPending && <LoadingState what="recommendations" />}
      {recommendations.isError && <ErrorState error={recommendations.error} />}
      {groups && groups.size === 0 && (
        <EmptyState message="No recommendations for this period yet. Trigger a refresh from the Dashboard or widen the date range." />
      )}

      {groups &&
        [...groups.entries()].map(([period, items]) => (
          <section key={period} className="rec-group">
            <h3 className="rec-group-title">{period}</h3>
            <div className="rec-group-list">
              {items.map((recommendation) => (
                <RecommendationCard
                  key={recommendation.id}
                  recommendation={recommendation}
                  roomTypeName={roomTypeNames.get(recommendation.roomTypeId)}
                  busy={updateStatus.isPending}
                  onAccept={(recommendationId) =>
                    updateStatus.mutate({ recommendationId, status: 'accepted' })
                  }
                  onDismiss={(recommendationId) =>
                    updateStatus.mutate({ recommendationId, status: 'dismissed' })
                  }
                />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
