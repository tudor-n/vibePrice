/**
 * "★ 4.5 (200 reviews)" — shared Google-rating caption used everywhere a
 * place/competitor candidate list renders a rating (PlacePicker, the
 * Nearby hotels page, Settings' place correction, the setup wizard's
 * discovery step). Returns null when there is no rating on file yet.
 */
export function formatRating(rating?: number, ratingCount?: number): string | null {
  if (typeof rating !== 'number') return null;
  const count =
    typeof ratingCount === 'number'
      ? ` (${ratingCount} review${ratingCount === 1 ? '' : 's'})`
      : '';
  return `★ ${rating.toFixed(1)}${count}`;
}
