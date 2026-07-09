/**
 * Onboarding wizard resume logic. Purely derived from `useProperties()` +
 * `useCompetitors()` server state so the wizard always resumes at the right
 * step, even after a reload mid-onboarding — no wizard-only client state to
 * go stale.
 *
 * Step-derivation rule (shared/contracts has no opinion here — this is a
 * client-only UX concern):
 *   no properties                          -> step 1 (name)
 *   property exists, placeStatus!=resolved -> step 2 (confirm place)
 *   property resolved, no room types       -> step 3 (room)
 *   property resolved, no competitors yet  -> step 4 (competitors)
 *   property resolved, >=1 competitor      -> step 5 (first price)
 */

import { useCompetitors, useProperties } from '../../api/hooks';
import type { Property } from '../../api/types';

export type SetupStep = 1 | 2 | 3 | 4 | 5 | 'done';

export function deriveStep(
  properties: Property[],
  competitorCount: number,
): { step: SetupStep; property?: Property } {
  if (properties.length === 0) return { step: 1 };
  const property = properties[0]; // onboarding is single-property; header selector is hidden here
  if (property.placeStatus !== 'resolved') return { step: 2, property };
  if (property.roomTypes.length === 0) return { step: 3, property };
  if (competitorCount === 0) return { step: 4, property };
  return { step: 5, property };
}

export function useSetupProgress() {
  const properties = useProperties();
  const data = properties.data ?? [];
  const property = data[0];
  const competitors = useCompetitors(property?.id);
  const competitorCount = competitors.data?.length ?? 0;
  return { properties, competitors, ...deriveStep(data, competitorCount) };
}
