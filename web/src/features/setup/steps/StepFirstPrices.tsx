/**
 * Setup step 5: run the real pricing pipeline once (mirrors the dashboard's
 * "Refresh data now" — same three jobs, same order, see
 * shared/contracts/jobs.md) and wait for the first recommendation to land.
 * If one already exists (resumed session), it renders immediately — no need
 * to re-click the button.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecommendations, useTriggerJob } from '../../../api/hooks';
import { dismissSetup } from '../setupState';
import { AsyncStatus } from '../../../components/AsyncStatus';
import { ErrorState } from '../../../components/States';
import { Money } from '../../../components/Money';
import type { Property, RecommendationFactor } from '../../../api/types';

const HORIZON_DAYS = 90;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function StepFirstPrices({ property }: { property: Property }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const navigate = useNavigate();
  const triggerJob = useTriggerJob();
  const [triggered, setTriggered] = useState(false);
  const [pipelineFailed, setPipelineFailed] = useState(false);

  const today = isoDate(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  const recommendations = useRecommendations(property.id, today, isoDate(horizon), {
    poll: triggered,
  });
  const firstPending = (recommendations.data ?? []).find((r) => r.status === 'pending');

  async function runPipeline() {
    setPipelineFailed(false);
    setTriggered(true);
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
        payload: { property_id: property.id, horizon_days: HORIZON_DAYS },
      });
    } catch {
      setPipelineFailed(true);
    }
  }

  const waiting = triggered && !firstPending;

  return (
    <div className="setup-step">
      <h1 ref={headingRef} tabIndex={-1}>
        Let&apos;s see your first price
      </h1>

      {!triggered && !firstPending && (
        <>
          <p className="page-intro">
            We&apos;ll check nearby prices and what&apos;s on in {property.city}, then
            work out a recommended price for your first night — so you can
            see exactly how PricePilot thinks before you rely on it.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void runPipeline()}>
            Show me my first price
          </button>
        </>
      )}

      {waiting && (
        <AsyncStatus
          phase={pipelineFailed ? 'failed' : 'working'}
          workingText="Working out your first price…"
          failedText="We couldn't work out your first price just now."
          onRetry={() => void runPipeline()}
          onBackground={() => navigate('/')}
        />
      )}

      {firstPending && (() => {
        // Defensive: `factors` is server-produced, versioned JSON (see
        // shared/contracts/recommendation-factors.md) — render what we can,
        // never crash the step over a shape drift.
        const factorList: RecommendationFactor[] = Array.isArray(firstPending.factors?.factors)
          ? firstPending.factors.factors
          : [];
        return (
          <div className="setup-first-price">
            <p className="rec-price-line">
              <span className="rec-price-current">
                <Money amount={firstPending.currentPrice} currency={firstPending.currency} />
              </span>
              <span className="rec-price-arrow" aria-hidden="true">
                →
              </span>
              <span className="rec-price-recommended">
                <Money amount={firstPending.recommendedPrice} currency={firstPending.currency} />
              </span>
              <span className="rec-price-label">recommended</span>
            </p>

            <section className="rec-why">
              <h2>Why this price</h2>
              {factorList.length > 0 ? (
                <ul className="factor-list">
                  {factorList.map((factor, index) => (
                    <li key={`${factor.rule}-${index}`} className="factor">
                      <span className="factor-reason">{factor.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="state state-empty">
                  Reasoning details are unavailable for this recommendation.
                </p>
              )}
            </section>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                // Finishing the wizard: mark setup dismissed so the guard sends
                // the owner to the dashboard from here on, not back into /setup.
                dismissSetup();
                navigate('/');
              }}
            >
              Looks good — take me in →
            </button>
          </div>
        );
      })()}

      {recommendations.isError && <ErrorState error={recommendations.error} />}
    </div>
  );
}
