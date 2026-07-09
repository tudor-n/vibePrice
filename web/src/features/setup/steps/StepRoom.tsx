/**
 * Setup step 3: the owner's first room type + starting rate. This is the
 * base price every recommendation is computed from.
 */

import { useEffect, useRef, useState } from 'react';
import { useCreateRoomType } from '../../../api/hooks';
import { ErrorState } from '../../../components/States';
import type { Property } from '../../../api/types';

export function StepRoom({ property }: { property: Property }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const createRoomType = useCreateRoomType();
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('2');
  const [basePrice, setBasePrice] = useState('');
  const [currency, setCurrency] = useState('RON');

  const capacityValue = Number(capacity);
  const basePriceValue = Number(basePrice);
  const canSubmit =
    name.trim() !== '' &&
    Number.isFinite(capacityValue) &&
    capacityValue >= 1 &&
    Number.isFinite(basePriceValue) &&
    basePriceValue > 0 &&
    currency.trim().length === 3 &&
    !createRoomType.isPending;

  return (
    <div className="setup-step">
      <h1 ref={headingRef} tabIndex={-1}>
        Add your first room type
      </h1>
      <p className="page-intro">
        This sets the starting price every recommendation is based on — you
        can add more room types later in Settings.
      </p>
      <form
        className="stacked-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          createRoomType.mutate({
            propertyId: property.id,
            body: {
              name: name.trim(),
              capacity: capacityValue,
              basePrice: basePriceValue,
              currency: currency.trim().toUpperCase(),
            },
          });
        }}
      >
        <label className="field">
          Room type name
          <input
            type="text"
            value={name}
            placeholder="Double room"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Sleeps
          <input
            type="number"
            min={1}
            step={1}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
          />
        </label>
        <label className="field">
          Price per night
          <input
            type="number"
            min={0}
            step="0.01"
            value={basePrice}
            placeholder="350"
            onChange={(event) => setBasePrice(event.target.value)}
          />
        </label>
        <label className="field">
          Currency
          <input
            type="text"
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          Continue
        </button>
      </form>
      {createRoomType.isError && <ErrorState error={createRoomType.error} />}
    </div>
  );
}
