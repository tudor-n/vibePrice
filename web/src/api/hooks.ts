/**
 * React Query hooks — the only way pages talk to the API.
 * Convention: no useEffect fetching anywhere in web/.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, login } from './client';
import type {
  Competitor,
  EventItem,
  Job,
  JobCreate,
  LoginRequest,
  PlacePick,
  Property,
  PropertyCreate,
  Recommendation,
  ResolvePlace,
} from './types';

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: LoginRequest) => login(email, password),
    onSuccess: () => {
      // A new identity invalidates everything cached for the previous one.
      void queryClient.invalidateQueries();
    },
  });
}

/**
 * While any property is still `unresolved` (its resolve_place job hasn't
 * landed yet), poll every 3s so the Settings page's "Finding your place on
 * Google…" state clears itself without the owner refreshing the page.
 * Stops once every property has settled (resolved or failed).
 */
export function propertiesRefetchInterval(properties: Property[] | undefined): number | false {
  const anyUnresolved = properties?.some((property) => property.placeStatus === 'unresolved') ?? false;
  return anyUnresolved ? 3000 : false;
}

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () => apiFetch<Property[]>('/properties'),
    refetchInterval: (query) => propertiesRefetchInterval(query.state.data),
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PropertyCreate) =>
      apiFetch<Property>('/properties', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });
}

export interface PickPlaceInput {
  propertyId: string;
  placeId: string;
}

export function usePickPlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, placeId }: PickPlaceInput) =>
      apiFetch<Property>(`/properties/${propertyId}/place`, {
        method: 'PATCH',
        body: JSON.stringify({ placeId } satisfies PlacePick),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
  });
}

export interface ResolvePropertyInput {
  propertyId: string;
  /** Search text override; omit to use the property's name + city. */
  query?: string;
}

export function useResolveProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, query }: ResolvePropertyInput) =>
      apiFetch<Job>(`/properties/${propertyId}/resolve-place`, {
        method: 'POST',
        body: JSON.stringify({ query } satisfies ResolvePlace),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useRecommendations(
  propertyId: string | undefined,
  from?: string,
  to?: string,
) {
  return useQuery({
    queryKey: ['recommendations', propertyId, from ?? null, to ?? null],
    enabled: Boolean(propertyId),
    queryFn: () => {
      if (!propertyId) throw new Error('propertyId is required');
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const query = params.toString();
      return apiFetch<Recommendation[]>(
        `/properties/${propertyId}/recommendations${query ? `?${query}` : ''}`,
      );
    },
  });
}

export interface UpdateRecommendationStatusInput {
  recommendationId: string;
  status: 'accepted' | 'dismissed';
}

export function useUpdateRecommendationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recommendationId, status }: UpdateRecommendationStatusInput) =>
      apiFetch<void>(`/recommendations/${recommendationId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
    },
  });
}

export function useCompetitors(propertyId: string | undefined) {
  return useQuery({
    queryKey: ['competitors', propertyId],
    enabled: Boolean(propertyId),
    queryFn: () => {
      if (!propertyId) throw new Error('propertyId is required');
      return apiFetch<Competitor[]>(`/properties/${propertyId}/competitors`);
    },
  });
}

/** Untrack a discovered competitor (soft-delete; row stays for history). */
export function useUntrackCompetitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (competitorId: string) =>
      apiFetch<void>(`/competitors/${competitorId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['competitors'] });
    },
  });
}

export function useEvents(city: string | undefined, from?: string, to?: string) {
  return useQuery({
    queryKey: ['events', city, from ?? null, to ?? null],
    enabled: Boolean(city),
    queryFn: () => {
      if (!city) throw new Error('city is required');
      const params = new URLSearchParams({ city });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return apiFetch<EventItem[]>(`/events?${params.toString()}`);
    },
  });
}

export function useTriggerJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: JobCreate) =>
      apiFetch<Job>('/jobs', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
