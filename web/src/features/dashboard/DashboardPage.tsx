import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEvents, useRecommendations, useTriggerJob } from '../../api/hooks';
import { useSelectedProperty } from '../../app/PropertyContext';
import { getActiveSession } from '../../auth/session';
import { formatMoney } from '../../components/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { TownSilhouette } from '../../components/Townscape';
import { Bunting, HandUnderline, IconRefresh } from '../../components/icons';
import houseTerracotta from '../../assets/houses/house-terracotta.png';
import houseOchre from '../../assets/houses/house-ochre.png';
import houseChurch from '../../assets/houses/house-church.png';
import houseSage from '../../assets/houses/house-sage.png';
import houseRose from '../../assets/houses/house-rose.png';
import houseBlue from '../../assets/houses/house-blue.png';
import lamppost from '../../assets/houses/lamppost.png';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Time-of-day greeting; pure so tests pin the boundaries. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

interface DashboardPageProps {
  /** Local hour 0–23; injectable so tests are deterministic. */
  nowHour?: number;
}

export function DashboardPage({ nowHour = new Date().getHours() }: DashboardPageProps) {
  // Property comes from the app-wide selector in the header.
  const { properties, property } = useSelectedProperty();

  const today = isoDate(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 60);

  const recommendations = useRecommendations(property?.id, today, isoDate(horizon));
  const events = useEvents(property?.city, today, isoDate(horizon));
  const triggerJob = useTriggerJob();
  // True from the first click until all three jobs are accepted (or one fails);
  // the mutation's own isPending flickers off between the sequential calls.
  const [refreshing, setRefreshing] = useState(false);

  const firstName = getActiveSession()?.user.displayName.trim().split(/\s+/)[0];
  const greeting = firstName
    ? `${greetingForHour(nowHour)}, ${firstName}`
    : greetingForHour(nowHour);

  if (properties.isPending) return <LoadingState what="your properties" />;
  if (properties.isError) return <ErrorState error={properties.error} />;
  if (!property) {
    return (
      <EmptyState message="Welcome to PricePilot. Add your first property in Settings and we will start watching prices for you." />
    );
  }

  async function handleRefresh() {
    if (!property || refreshing) return;
    setRefreshing(true);
    try {
      // The real pipeline, in dependency order (shared/contracts/jobs.md):
      // fresh competitor rates → fresh events → recompute recommendations.
      await triggerJob.mutateAsync({
        type: 'scrape.competitor_rates',
        payload: { city: property.city, property_id: property.id },
      });
      await triggerJob.mutateAsync({
        type: 'ingest.events',
        payload: { city: property.city },
      });
      await triggerJob.mutateAsync({
        type: 'engine.generate_recommendations',
        payload: { property_id: property.id, horizon_days: 90 },
      });
    } catch {
      // The mutation state carries the error; the ErrorState below shows it.
    } finally {
      setRefreshing(false);
    }
  }

  const busy = refreshing || triggerJob.isPending;

  const pending = (recommendations.data ?? []).filter((r) => r.status === 'pending');

  // Display-only aggregation of server-provided estimates — we never derive
  // new money figures client-side. Only shown when all estimates share a
  // currency; mixed currencies cannot be summed honestly.
  const currencies = new Set(pending.map((r) => r.currency));
  const totalImpact =
    pending.length > 0 && currencies.size === 1
      ? {
          amount: pending.reduce((sum, r) => sum + r.expectedImpact, 0),
          currency: pending[0].currency,
        }
      : null;

  const nextBigEvent = (events.data ?? [])
    .filter((e) => e.endDate >= today)
    .sort((a, b) => b.impactScore - a.impactScore)[0];

  return (
    <div className="page">
      <div className="page-header-row">
        <h2>{greeting}</h2>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void handleRefresh()}
        >
          <IconRefresh />
          {busy ? 'Refreshing…' : 'Refresh data now'}
        </button>
      </div>
      <HandUnderline width={188} />
      <p className="page-intro">
        {property.name} · {property.city} — here's what changed while you slept.
      </p>
      {triggerJob.isError && <ErrorState error={triggerJob.error} />}
      {!busy && triggerJob.isSuccess && (
        <p className="state state-loading" role="status">
          Refresh queued — new competitor prices, events and recommendations
          will appear shortly.
        </p>
      )}

      <div className="card-grid">
        <section className="summary-card">
          <img className="corner-art" src={houseTerracotta} alt="" />
          <h3>Pending recommendations</h3>
          {recommendations.isPending && <LoadingState what="recommendations" />}
          {recommendations.isError && <ErrorState error={recommendations.error} />}
          {recommendations.data && (
            <>
              <p className="summary-value">{pending.length}</p>
              <p className="summary-hint">
                {pending.length === 0
                  ? 'All caught up — nothing waiting for your decision.'
                  : 'price suggestions waiting for your decision'}
              </p>
            </>
          )}
        </section>

        <section className="summary-card">
          <img className="corner-art" src={houseOchre} alt="" />
          <h3>Estimated total impact</h3>
          {recommendations.isPending && <LoadingState what="estimates" />}
          {recommendations.isError && <ErrorState error={recommendations.error} />}
          {recommendations.data && (
            <>
              <p
                className={
                  totalImpact
                    ? 'summary-value summary-value-positive'
                    : 'summary-value'
                }
              >
                {totalImpact ? formatMoney(totalImpact.amount, totalImpact.currency) : '—'}
              </p>
              <p className="summary-hint">
                {totalImpact
                  ? 'if you accept all pending recommendations'
                  : 'no pending estimates for the next 60 days'}
              </p>
            </>
          )}
        </section>

        <section className="summary-card">
          <img className="corner-art" src={houseChurch} alt="" />
          <h3>Next big event</h3>
          {events.isPending && <LoadingState what="events" />}
          {events.isError && <ErrorState error={events.error} />}
          {events.data &&
            (nextBigEvent ? (
              <>
                <p className="summary-value summary-value-text">{nextBigEvent.name}</p>
                <p className="summary-hint">
                  {nextBigEvent.startDate} → {nextBigEvent.endDate} · impact{' '}
                  {nextBigEvent.impactScore}/100
                </p>
              </>
            ) : (
              <EmptyState message={`No upcoming events found for ${property.city}.`} />
            ))}
        </section>
      </div>

      <section className="calendar-teaser">
        <div className="teaser-silhouette" aria-hidden="true">
          <TownSilhouette />
        </div>
        <Bunting />
        <div className="house-row" aria-hidden="true">
          <img src={houseSage} alt="" className="hr-sage" />
          <img src={lamppost} alt="" className="hr-lamp" />
          <img src={houseTerracotta} alt="" className="hr-terracotta" />
          <img src={houseRose} alt="" className="hr-rose" />
          <img src={houseChurch} alt="" className="hr-church" />
          <img src={houseBlue} alt="" className="hr-blue" />
          <img src={lamppost} alt="" className="hr-lamp" />
          <img src={houseOchre} alt="" className="hr-ochre" />
        </div>
        <div className="calendar-teaser-copy">
          <h3>Price calendar</h3>
          <p>
            Your month at a glance — every night against the local competitor
            band, with the days worth acting on called out.{' '}
            <Link to="/recommendations">Open the price calendar</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
