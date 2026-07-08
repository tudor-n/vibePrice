/**
 * TypeScript mirrors of the API schemas in `shared/contracts/openapi.yaml`
 * and the reasoning payload in `shared/contracts/recommendation-factors.md`.
 *
 * Contract rule: update this file in the same PR as any API/contract change.
 * The `factors` payload is versioned (`engine_version`) — types here stay
 * tolerant of unknown extra fields so old clients render new payloads.
 */

// --- openapi.yaml: components/schemas -------------------------------------

export interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  role: string;
  tenantId: string;
}

// --- openapi.yaml: POST /auth/login ----------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  /** JWT (HS256); sent as `Authorization: Bearer <token>`. */
  token: string;
  /** ISO date-time after which the token is invalid. */
  expiresAt: string;
  user: UserInfo;
}

export interface RoomType {
  id: string;
  name: string;
  capacity: number;
  basePrice: number;
  currentPrice: number;
  currency: string;
}

/**
 * Derived server-side from `placeResolvedAt` / the `place_candidates`
 * sentinel — never stored directly. See shared/contracts/place-candidates.md.
 */
export type PlaceStatus = 'unresolved' | 'resolved' | 'failed';

/** A single Google Places search result, stored for the correction UI. */
export interface PlaceCandidate {
  placeId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  ratingCount?: number;
}

export interface Property {
  id: string;
  name: string;
  city: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  ratingCount?: number;
  placeStatus: PlaceStatus;
  placeCandidates: PlaceCandidate[];
  roomTypes: RoomType[];
}

export interface PropertyCreate {
  name: string;
  city: string;
  address?: string;
}

/** PATCH /properties/{id}/place — owner picks a stored candidate. */
export interface PlacePick {
  placeId: string;
}

/** POST /properties/{id}/resolve-place — owner-triggered re-search. */
export interface ResolvePlace {
  query?: string;
}

export type RecommendationStatus = 'pending' | 'accepted' | 'dismissed';

export interface Recommendation {
  id: string;
  roomTypeId: string;
  /** Stay date, ISO `date` (no time component). */
  stayDate: string;
  currentPrice: number;
  recommendedPrice: number;
  currency: string;
  expectedImpact: number;
  status: RecommendationStatus;
  factors: RecommendationFactors;
  createdAt: string;
}

export interface CompetitorRate {
  stayDate: string;
  price: number;
  currency: string;
  capturedAt: string;
}

export interface Competitor {
  id: string;
  name: string;
  /** OTA listing URL; absent for some auto-discovered places. */
  sourceUrl?: string;
  rating?: number;
  ratingCount?: number;
  latitude?: number;
  longitude?: number;
  latestRates: CompetitorRate[];
}

export interface EventItem {
  id: string;
  city: string;
  name: string;
  startDate: string;
  endDate: string;
  /** 0–100 demand impact score. */
  impactScore: number;
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;
  error?: string;
}

export interface JobCreate {
  /** See shared/contracts/jobs.md for valid types. */
  type: string;
  payload?: Record<string, unknown>;
}

// --- recommendation-factors.md: the engine's reasoning payload -------------
//
// Versioned JSON. Every type below carries an index signature so renderers
// tolerate fields added by future engine versions; `rule` names are open
// strings — the UI must render `reason` even for rules it has never seen.

export interface RecommendationFactor {
  rule: string;
  adjustment_pct: number;
  /** Human-readable sentence; always render this, whatever the rule. */
  reason: string;
  [extra: string]: unknown;
}

export interface ExpectedImpact {
  estimate: number;
  currency: string;
  period_start: string;
  period_end: string;
  method: string;
  [extra: string]: unknown;
}

export interface DataFreshness {
  scraped_rates_at?: string;
  events_at?: string;
  [extra: string]: unknown;
}

export interface RecommendationFactors {
  engine_version: string;
  base_price: number;
  currency: string;
  factors: RecommendationFactor[];
  recommended_price: number;
  expected_impact: ExpectedImpact;
  data_freshness: DataFreshness;
  [extra: string]: unknown;
}
