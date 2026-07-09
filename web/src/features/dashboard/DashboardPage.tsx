import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useEvents, useRecommendations, useTriggerJob } from '../../api/hooks';
import { useSelectedProperty } from '../../app/PropertyContext';
import { clearSetupDismissed, isSetupDismissed } from '../../app/setupState';
import { getActiveSession } from '../../auth/session';
import { formatMoney } from '../../components/Money';
import { AsyncStatus, type AsyncPhase } from '../../components/AsyncStatus';
import { Explainer } from '../../components/Explainer';
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

/**
 * Local progress through handleRefresh's three sequential jobs (see
 * shared/contracts/jobs.md for the job types). 'rates' | 'events' | 'engine'
 * name whichever job is currently in flight — the ones before it in
 * REFRESH_STEP_LABELS have already resolved. 'done' / 'failed' are terminal.
 */
type RefreshStep = 'idle' | 'rates' | 'events' | 'engine' | 'done' | 'failed';

const REFRESH_STEP_LABELS = ['Prices', "What's on", 'Recalculating'] as const;

function refreshStepIndex(step: RefreshStep): number {
  switch (step) {
    case 'rates':
      return 0;
    case 'events':
      return 1;
    case 'engine':
      return 2;
    case 'done':
      return REFRESH_STEP_LABELS.length;
    default:
      return -1; // 'idle' | 'failed' — nothing to tick yet
  }
}

/**
 * "Prices ✓ · What's on ✓ · Recalculating…" — ticks a step to ✓ once its
 * mutateAsync call in handleRefresh has resolved, and marks the one
 * currently in flight with an ellipsis. Pure so tests pin the exact copy.
 */
export function refreshStepsText(step: RefreshStep): string {
  const currentIndex = refreshStepIndex(step);
  return REFRESH_STEP_LABELS.map((label, index) => {
    if (index < currentIndex) return `${label} ✓`;
    if (index === currentIndex) return `${label}…`;
    return label;
  }).join(' · ');
}

/** Maps the refresh state machine onto AsyncStatus's phase prop. */
function refreshStepPhase(step: RefreshStep): AsyncPhase | null {
  if (step === 'idle') return null;
  if (step === 'failed') return 'failed';
  if (step === 'done') return 'done';
  return 'working'; // 'rates' | 'events' | 'engine' — a job is in flight
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
  // Tracks progress through the three sequential jobs in handleRefresh so
  // the owner sees real progress instead of a vague "queued".
  const [refreshStep, setRefreshStep] = useState<RefreshStep>('idle');
  const refreshPhase = refreshStepPhase(refreshStep);
  const busy = refreshPhase === 'working';

  const firstName = getActiveSession()?.user.displayName.trim().split(/\s+/)[0];
  const greeting = firstName
    ? `${greetingForHour(nowHour)}, ${firstName}`
    : greetingForHour(nowHour);

  if (properties.isPending) return <LoadingState what="your properties" />;
  if (properties.isError) return <ErrorState error={properties.error} />;
  if (!property) {
    // Brand-new owner (zero properties) who hasn't left the wizard: send them
    // straight into it. Loop-safe — the /setup guard only bounces BACK when
    // dismissed, and this redirect only fires when NOT dismissed.
    if (!isSetupDismissed()) {
      return <Navigate to="/setup" replace />;
    }
    // They skipped setup earlier: offer a way back in (clearing the flag so
    // the guard lets them through).
    return (
      <div className="empty-card">
        <img src={houseTerracotta} alt="" />
        <h3>Let&apos;s set up your hotel</h3>
        <p>
          A few quick steps — your hotel name, your first room rate, and
          we&apos;ll find nearby hotels and work out your first price
          suggestion.
        </p>
        <Link to="/setup" className="btn btn-primary" onClick={() => clearSetupDismissed()}>
          Start setup →
        </Link>
      </div>
    );
  }

  // Resume nudge: the owner has a property but hasn't finished onboarding it
  // (place unresolved or no room types yet). A quiet link back into the wizard
  // closes the gap for anyone who backgrounded out mid-setup.
  const needsSetup = property.placeStatus !== 'resolved' || property.roomTypes.length === 0;

  async function handleRefresh() {
    if (!property || busy) return;
    setRefreshStep('rates');
    try {
      // The real pipeline, in dependency order (shared/contracts/jobs.md):
      // fresh competitor rates → fresh events → recompute recommendations.
      await triggerJob.mutateAsync({
        type: 'scrape.competitor_rates',
        payload: { city: property.city, property_id: property.id },
      });
      setRefreshStep('events');
      await triggerJob.mutateAsync({
        type: 'ingest.events',
        payload: { city: property.city },
      });
      setRefreshStep('engine');
      await triggerJob.mutateAsync({
        type: 'engine.generate_recommendations',
        payload: { property_id: property.id, horizon_days: 90 },
      });
      setRefreshStep('done');
    } catch {
      // The failed AsyncStatus below shows the error and offers Try again.
      setRefreshStep('failed');
    }
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
        <h2>{greeting}</h2>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void handleRefresh()}
        >
          <IconRefresh />
          {busy ? 'Refreshing…' : 'Check for new prices'}
        </button>
      </div>
      <HandUnderline width={188} />
      <p className="page-intro">
        {property.name} · {property.city} — here's what changed while you slept.
      </p>
      {needsSetup && (
        <p className="resume-nudge">
          Your hotel isn&apos;t fully set up yet.{' '}
          <Link to="/setup" onClick={() => clearSetupDismissed()}>
            Finish setting up →
          </Link>
        </p>
      )}
      {refreshPhase && (
        <AsyncStatus
          phase={refreshPhase}
          workingText={refreshStepsText(refreshStep)}
          doneText={refreshStepsText('done')}
          failedText="We couldn't refresh your prices just now."
          onRetry={() => void handleRefresh()}
        />
      )}

      <div className="card-grid">
        <section className="summary-card">
          <img className="corner-art" src={houseTerracotta} alt="" />
          <h3>Prices to review</h3>
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
          <h3>
            Extra income if you accept all{' '}
            <Explainer label="extra income if you accept all">
              Adds up the estimated extra revenue from every price suggestion
              that&apos;s still waiting for your decision.
            </Explainer>
          </h3>
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
                  ? 'across your pending price suggestions'
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
              <EmptyState message={`Nothing's coming up in ${property.city} right now.`} />
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
            Your month at a glance — every night compared with what nearby
            hotels charge, with the days worth acting on called out.{' '}
            <Link to="/recommendations">Open the price calendar</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
