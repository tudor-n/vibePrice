import type { Recommendation, RecommendationFactor } from '../../api/types';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { Money } from '../../components/Money';

/**
 * THE core component of PricePilot: one dated price recommendation rendered
 * as a plain-language argument a hotel owner can trust — what we recommend,
 * why (every engine factor as a readable sentence), what it is worth, and
 * how fresh the underlying data is.
 *
 * The `factors` payload is versioned (engine_version). This renderer must
 * stay backward compatible: unknown rule names and extra fields are fine —
 * we always render the `reason` sentence and the adjustment chip.
 */

function formatAdjustment(pct: number): string {
  const formatted = new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(pct);
  return `${formatted}%`;
}

function adjustmentClass(pct: number): string {
  if (pct > 0) return 'chip chip-up';
  if (pct < 0) return 'chip chip-down';
  return 'chip chip-flat';
}

function formatDate(isoDate: string): string {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return isoDate;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function FactorItem({ factor }: { factor: RecommendationFactor }) {
  return (
    <li className="factor">
      <span className={adjustmentClass(factor.adjustment_pct)}>
        {formatAdjustment(factor.adjustment_pct)}
      </span>
      <span className="factor-reason">{factor.reason}</span>
    </li>
  );
}

interface RecommendationCardProps {
  recommendation: Recommendation;
  roomTypeName?: string;
  onAccept?: (recommendationId: string) => void;
  onDismiss?: (recommendationId: string) => void;
  /** Disables the action buttons while a status update is in flight. */
  busy?: boolean;
  /** Terracotta ring after arriving here from a calendar day cell. */
  highlighted?: boolean;
}

export function RecommendationCard({
  recommendation,
  roomTypeName,
  onAccept,
  onDismiss,
  busy = false,
  highlighted = false,
}: RecommendationCardProps) {
  const { factors } = recommendation;
  // Defensive: the payload is server-produced, versioned JSON. Render what
  // we can, never crash the card over a shape drift.
  const factorList: RecommendationFactor[] = Array.isArray(factors?.factors)
    ? factors.factors
    : [];
  const impact = factors?.expected_impact;
  const freshness = factors?.data_freshness;

  const isPending = recommendation.status === 'pending';

  return (
    <article
      className={highlighted ? 'rec-card rec-card-highlight' : 'rec-card'}
      aria-label="Price recommendation"
    >
      <header className="rec-card-header">
        <div>
          <h3 className="rec-card-date">{formatDate(recommendation.stayDate)}</h3>
          {roomTypeName && <p className="rec-card-room">{roomTypeName}</p>}
        </div>
        <span className={`status status-${recommendation.status}`}>
          {recommendation.status}
        </span>
      </header>

      <p className="rec-price-line">
        <span className="rec-price-current">
          <Money amount={recommendation.currentPrice} currency={recommendation.currency} />
        </span>
        <span className="rec-price-arrow" aria-hidden="true">
          →
        </span>
        <span className="rec-price-recommended">
          <Money
            amount={recommendation.recommendedPrice}
            currency={recommendation.currency}
          />
        </span>
        <span className="rec-price-label">recommended</span>
      </p>

      <section className="rec-why">
        <h4>Why this price</h4>
        {factorList.length > 0 ? (
          <ul className="factor-list">
            {factorList.map((factor, index) => (
              <FactorItem key={`${factor.rule}-${index}`} factor={factor} />
            ))}
          </ul>
        ) : (
          <p className="state state-empty">
            Reasoning details are unavailable for this recommendation.
          </p>
        )}
        {typeof factors?.base_price === 'number' && (
          <p className="rec-base-note">
            Starting from your base price of{' '}
            <Money
              amount={factors.base_price}
              currency={factors.currency ?? recommendation.currency}
            />
            .
          </p>
        )}
      </section>

      <section className="rec-impact">
        <h4>What it is worth</h4>
        {impact ? (
          <p>
            Estimated{' '}
            <strong>
              <Money amount={impact.estimate} currency={impact.currency} />
            </strong>{' '}
            extra revenue between {formatDate(impact.period_start)} and{' '}
            {formatDate(impact.period_end)}.
            <span className="rec-impact-method"> ({impact.method})</span>
          </p>
        ) : (
          <p>
            Estimated{' '}
            <strong>
              <Money
                amount={recommendation.expectedImpact}
                currency={recommendation.currency}
              />
            </strong>{' '}
            extra revenue.
          </p>
        )}
      </section>

      <footer className="rec-card-footer">
        <div className="rec-freshness">
          <FreshnessBadge label="nearby hotel prices" timestamp={freshness?.scraped_rates_at} />
          <FreshnessBadge label="events" timestamp={freshness?.events_at} />
        </div>
        {isPending && (onAccept || onDismiss) && (
          <div className="rec-actions">
            {onAccept && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => onAccept(recommendation.id)}
              >
                Accept price
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => onDismiss(recommendation.id)}
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}
