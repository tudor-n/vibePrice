/**
 * Setup step 1: hotel name + town. Creating the property enqueues a
 * resolve_place job server-side; on success the `properties` query
 * invalidates and `useSetupProgress` advances the wizard to step 2 on its
 * own — this component never navigates itself.
 */

import { useEffect, useRef, useState } from 'react';
import { useCreateProperty } from '../../../api/hooks';
import { ErrorState } from '../../../components/States';

export function StepName() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const createProperty = useCreateProperty();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');

  const canSubmit = name.trim() !== '' && city.trim() !== '' && !createProperty.isPending;

  return (
    <div className="setup-step">
      <h1 ref={headingRef} tabIndex={-1}>
        What&apos;s your hotel called?
      </h1>
      <p className="page-intro">
        We&apos;ll use this to find your listing on Google and start watching
        nearby competitors for you.
      </p>
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          createProperty.mutate({ name: name.trim(), city: city.trim() });
        }}
      >
        <label className="field">
          What&apos;s your hotel called?
          <input
            type="text"
            value={name}
            placeholder="Casa Luca"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Which town?
          <input
            type="text"
            value={city}
            placeholder="Sibiu"
            onChange={(event) => setCity(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Continue
        </button>
      </form>
      {createProperty.isError && <ErrorState error={createProperty.error} />}
    </div>
  );
}
