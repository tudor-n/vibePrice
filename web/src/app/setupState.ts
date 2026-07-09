/**
 * Client-side "I've left the setup wizard" milestone.
 *
 * Onboarding completion has no clean server signal: a fully set-up owner and
 * an owner paused mid-step-5 look identical server-side (steps 4–5 auto-advance
 * purely from server state), and step 1 already creates a property — so a
 * property-count guard would bounce the owner out of the wizard before step 2.
 * Instead we record the moment the owner deliberately leaves the wizard
 * ("Skip for now" / "take me in") in localStorage, and route on that.
 *
 * Loop-safety contract (see SetupGuard + DashboardPage):
 *   - SetupGuard redirects /setup → / ONLY when dismissed.
 *   - DashboardPage redirects / → /setup ONLY when (zero properties AND NOT dismissed).
 * The two conditions are mutually exclusive, so the pair can never ping-pong.
 */

const SETUP_DISMISSED_KEY = 'pricepilot.setupDismissed';

export function isSetupDismissed(): boolean {
  return localStorage.getItem(SETUP_DISMISSED_KEY) === '1';
}

export function dismissSetup(): void {
  localStorage.setItem(SETUP_DISMISSED_KEY, '1');
}

export function clearSetupDismissed(): void {
  localStorage.removeItem(SETUP_DISMISSED_KEY);
}
