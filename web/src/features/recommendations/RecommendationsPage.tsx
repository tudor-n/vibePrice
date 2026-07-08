import { useMemo, useState } from 'react';
import {
  useRecommendations,
  useUpdateRecommendationStatus,
} from '../../api/hooks';
import { useSelectedProperty } from '../../app/PropertyContext';
import type { Recommendation } from '../../api/types';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { HandUnderline } from '../../components/icons';
import { RecommendationCard } from './RecommendationCard';
import { PriceCalendar } from './PriceCalendar';
import type { CalendarRow } from './calendarModel';
import houseSage from '../../assets/houses/house-sage.png';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The calendar horizon: today through the engine's 90-day window. */
function calendarRange(): { from: string; to: string } {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + 90);
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

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function RecommendationsPage() {
  const [{ from, to }] = useState(calendarRange);
  // Property comes from the app-wide selector in the header.
  const { properties, property } = useSelectedProperty();

  const recommendations = useRecommendations(property?.id, from, to);
  const updateStatus = useUpdateRecommendationStatus();
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const roomTypeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const roomType of property?.roomTypes ?? []) {
      names.set(roomType.id, roomType.name);
    }
    return names;
  }, [property]);

  // Calendar input: recommendations joined with their room type display name.
  const calendarRows: CalendarRow[] = useMemo(
    () =>
      (recommendations.data ?? []).map((recommendation) => ({
        ...recommendation,
        roomTypeName:
          roomTypeNames.get(recommendation.roomTypeId) ?? 'Unknown room type',
      })),
    [recommendations.data, roomTypeNames],
  );

  if (properties.isPending) return <LoadingState what="your properties" />;
  if (properties.isError) return <ErrorState error={properties.error} />;
  if (!properties.data || properties.data.length === 0) {
    return (
      <EmptyState message="No properties yet. Add your first property in Settings to start receiving price recommendations." />
    );
  }

  function handleDayClick(recommendationId: string) {
    setHighlightId(recommendationId);
    const card = document.getElementById(`rec-${recommendationId}`);
    card?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  const groups = recommendations.data ? groupByPeriod(recommendations.data) : null;

  return (
    <div className="page">
      <h2>Recommendations &amp; price calendar</h2>
      <HandUnderline width={210} />
      <p className="page-intro">
        Your rate for each night against the local competitor band — with the
        days worth acting on called out. Accept the suggestions you agree
        with; nothing changes without your approval.
      </p>

      {updateStatus.isError && <ErrorState error={updateStatus.error} />}

      {recommendations.isPending && <LoadingState what="recommendations" />}
      {recommendations.isError && <ErrorState error={recommendations.error} />}

      {groups && groups.size === 0 && (
        <div className="empty-card">
          <img src={houseSage} alt="" />
          <h3>All quiet on your street</h3>
          <p>
            No price suggestions for the next 90 days. Trigger a refresh from
            the Dashboard and we'll nudge you the moment something changes.
          </p>
        </div>
      )}

      {property && calendarRows.length > 0 && (
        <PriceCalendar
          rows={calendarRows}
          propertyName={property.name}
          onDayClick={handleDayClick}
        />
      )}

      {groups &&
        [...groups.entries()].map(([period, items]) => (
          <section key={period} className="rec-group">
            <h3 className="rec-group-title">{period}</h3>
            <div className="rec-group-list">
              {items.map((recommendation) => (
                <div key={recommendation.id} id={`rec-${recommendation.id}`}>
                  <RecommendationCard
                    recommendation={recommendation}
                    roomTypeName={roomTypeNames.get(recommendation.roomTypeId)}
                    busy={updateStatus.isPending}
                    highlighted={highlightId === recommendation.id}
                    onAccept={(recommendationId) =>
                      updateStatus.mutate({ recommendationId, status: 'accepted' })
                    }
                    onDismiss={(recommendationId) =>
                      updateStatus.mutate({ recommendationId, status: 'dismissed' })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
