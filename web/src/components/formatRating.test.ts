import { describe, expect, it } from 'vitest';
import { formatRating } from './formatRating';

describe('formatRating', () => {
  it('formats a rating with a review count', () => {
    expect(formatRating(4.5, 200)).toBe('★ 4.5 (200 reviews)');
  });

  it('uses the singular "review" for a count of 1', () => {
    expect(formatRating(4.5, 1)).toBe('★ 4.5 (1 review)');
  });

  it('omits the review count when it is absent', () => {
    expect(formatRating(4.5)).toBe('★ 4.5');
  });

  it('returns null when there is no rating on file yet', () => {
    expect(formatRating(undefined, 12)).toBeNull();
  });
});
