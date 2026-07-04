/**
 * React Query hooks — the only way pages talk to the API.
 * Convention: no useEffect fetching anywhere in web/.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  Competitor,
  EventItem,
  Job,
  JobCreate,
  Property,
  Recommendation,
} from './types';

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () => apiFetch<Property[]>('/properties'),
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
