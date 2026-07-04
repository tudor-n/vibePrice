import { useEvents, useProperties, useRecommendations, useTriggerJob } from '../../api/hooks';
import { formatMoney } from '../../components/Money';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function DashboardPage() {
  const properties = useProperties();
  const property = properties.data?.[0];

  const today = isoDate(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 60);

  const recommendations = useRecommendations(property?.id, today, isoDate(horizon));
  const events = useEvents(property?.city, today, isoDate(horizon));
  const triggerJob = useTriggerJob();

  if (properties.isPending) return <LoadingState what="your properties" />;
  if (properties.isError) return <ErrorState error={properties.error} />;
  if (!property) {
    return (
      <EmptyState message="Welcome to PricePilot. Add your first property in Settings and we will start watching prices for you." />
    );
  }

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
        <h2>Dashboard</h2>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={triggerJob.isPending}
          onClick={() => triggerJob.mutate({ type: 'refresh_all' })}
        >
          {triggerJob.isPending ? 'Refreshing…' : 'Refresh data now'}
        </button>
      </div>
      <p className="page-intro">
        {property.name} · {property.city}
      </p>
      {triggerJob.isError && <ErrorState error={triggerJob.error} />}
      {triggerJob.isSuccess && (
        <p className="state state-loading" role="status">
          Refresh queued — new competitor prices and events will appear shortly.
        </p>
      )}

      <div className="card-grid">
        <section className="summary-card">
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
          <h3>Estimated total impact</h3>
          {recommendations.isPending && <LoadingState what="estimates" />}
          {recommendations.isError && <ErrorState error={recommendations.error} />}
          {recommendations.data && (
            <>
              <p className="summary-value">
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

      <section className="chart-placeholder" aria-label="Price calendar chart placeholder">
        <h3>Price calendar</h3>
        <p>
          A calendar chart of your prices vs. competitors is coming soon. Until
          then, the Recommendations page lists every suggested change with its
          full reasoning.
        </p>
      </section>
    </div>
  );
}
