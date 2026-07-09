/**
 * Full-screen onboarding wizard, mounted at /setup OUTSIDE the app Layout
 * (no sidebar/topbar — see router.tsx). Resumes at whatever step
 * `useSetupProgress` derives from server state, so a reload mid-onboarding
 * lands the owner back where they left off.
 */

import { useNavigate } from 'react-router-dom';
import { useSetupProgress } from './useSetupProgress';
import { dismissSetup } from '../../app/setupState';
import { StepName } from './steps/StepName';
import { StepConfirmPlace } from './steps/StepConfirmPlace';
import { StepRoom } from './steps/StepRoom';
import { StepCompetitors } from './steps/StepCompetitors';
import { StepFirstPrices } from './steps/StepFirstPrices';
import { ErrorState, LoadingState } from '../../components/States';

const TOTAL_STEPS = 5;

function ProgressDots({ current }: { current: number }) {
  return (
    <div className="setup-progress">
      <p className="visually-hidden">
        Step {current} of {TOTAL_STEPS}
      </p>
      <span className="setup-dots" aria-hidden="true">
        {Array.from({ length: TOTAL_STEPS }, (_, index) => (
          <span
            key={index}
            className={index < current ? 'setup-dot setup-dot-filled' : 'setup-dot'}
          />
        ))}
      </span>
    </div>
  );
}

export function SetupWizard() {
  const navigate = useNavigate();
  const { properties, step, property } = useSetupProgress();

  let content: React.ReactNode;
  if (properties.isPending) {
    content = <LoadingState what="your setup progress" />;
  } else if (properties.isError) {
    content = <ErrorState error={properties.error} />;
  } else if (step === 1) {
    content = <StepName />;
  } else if (step === 2 && property) {
    content = <StepConfirmPlace property={property} />;
  } else if (step === 3 && property) {
    content = <StepRoom property={property} />;
  } else if (step === 4 && property) {
    content = <StepCompetitors property={property} />;
  } else if (property) {
    // step 5 (and the not-reachable 'done', which only exists as a
    // transient client-side value once the owner leaves the wizard).
    content = <StepFirstPrices property={property} />;
  }

  const currentDot = typeof step === 'number' ? step : TOTAL_STEPS;

  return (
    <div className="setup">
      <div className="setup-shell">
        <ProgressDots current={currentDot} />
        {content}
        <button
          type="button"
          className="btn btn-ghost setup-skip"
          onClick={() => {
            // "Skip for now" is the owner deliberately leaving the wizard —
            // record the milestone so the guard/dashboard stop routing them
            // back in (they can re-enter from the dashboard nudge).
            dismissSetup();
            navigate('/');
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
