/**
 * App-wide selected property. The Layout's header <select> writes it; pages
 * read it instead of running their own selectors. The choice is remembered
 * in localStorage across visits. If the stored id no longer exists (or none
 * was ever picked), consumers fall back to the first property.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useProperties } from '../api/hooks';
import type { Property } from '../api/types';

const PROPERTY_STORAGE_KEY = 'pricepilot.propertyId';

interface PropertyContextValue {
  selectedPropertyId: string | null;
  setSelectedPropertyId: (propertyId: string) => void;
}

const PropertyContext = createContext<PropertyContextValue | null>(null);

export function PropertyProvider({ children }: { children: ReactNode }) {
  const [selectedPropertyId, setSelectedState] = useState<string | null>(() =>
    localStorage.getItem(PROPERTY_STORAGE_KEY),
  );

  const setSelectedPropertyId = useCallback((propertyId: string) => {
    localStorage.setItem(PROPERTY_STORAGE_KEY, propertyId);
    setSelectedState(propertyId);
  }, []);

  return (
    <PropertyContext.Provider
      value={{ selectedPropertyId, setSelectedPropertyId }}
    >
      {children}
    </PropertyContext.Provider>
  );
}

export function usePropertySelection(): PropertyContextValue {
  const context = useContext(PropertyContext);
  if (!context) {
    throw new Error('usePropertySelection must be used inside PropertyProvider');
  }
  return context;
}

/**
 * The properties query plus the currently selected property (falling back to
 * the first one when nothing valid is selected). The one-stop hook for pages.
 */
export function useSelectedProperty(): {
  properties: ReturnType<typeof useProperties>;
  property: Property | undefined;
} {
  const { selectedPropertyId } = usePropertySelection();
  const properties = useProperties();
  const property =
    properties.data?.find((p) => p.id === selectedPropertyId) ??
    properties.data?.[0];
  return { properties, property };
}
