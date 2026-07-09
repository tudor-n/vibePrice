/**
 * Onboarding wizard resume logic. Purely derived from `useProperties()`
 * server state so the wizard always resumes at the right step, even after a
 * reload mid-onboarding — no wizard-only client state to go stale.
 *
 * Step-derivation rule (shared/contracts has no opinion here — this is a
 * client-only UX concern):
 *   no properties                          -> step 1 (name)
 *   property exists, placeStatus!=resolved -> step 2 (confirm place)
 *   property resolved, no room types       -> step 3 (room)
 *   property resolved, >=1 room type       -> step 4 (competitors) [later task]
 */

import { useProperties } from '../../api/hooks';
import type { Property } from '../../api/types';

export type SetupStep = 1 | 2 | 3 | 4 | 5 | 'done';

export function deriveStep(properties: Property[]): { step: SetupStep; property?: Property } {
  if (properties.length === 0) return { step: 1 };
  const property = properties[0]; // onboarding is single-property; header selector is hidden here
  if (property.placeStatus !== 'resolved') return { step: 2, property };
  if (property.roomTypes.length === 0) return { step: 3, property };
  return { step: 4, property }; // steps 4/5 handled in a later task
}

export function useSetupProgress() {
  const properties = useProperties();
  const data = properties.data ?? [];
  return { properties, ...deriveStep(data) };
}
