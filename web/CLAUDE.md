# web/ — PricePilot dashboard (agent guide)

React 19 + TypeScript + Vite SPA for hotel owners. Served by nginx in Docker
(port 80), `npm run dev` on :5173 locally. Root rules in `../CLAUDE.md` apply.

## Stack

- React 19, react-router-dom 7, @tanstack/react-query 5 — that's it. **No UI
  framework, no chart library** (charts land later; keep placeholder sections).
- Plain CSS: one stylesheet, `src/styles/global.css`, with CSS-variable design
  tokens. Extend tokens; don't inline magic colors/sizes.
- Vitest + React Testing Library (`src/test/setup.ts` registers jest-dom).

## Folder map

```
src/
├── main.tsx            # QueryClientProvider + RouterProvider
├── App.tsx / router.tsx
├── styles/global.css   # design tokens + all styling
├── api/
│   ├── client.ts       # fetch wrapper: base URL, auth headers, ApiError, login()
│   ├── types.ts        # mirrors shared/contracts/openapi.yaml + factors contract
│   └── hooks.ts        # react-query hooks — the only API access path
├── auth/               # session.ts (token storage), RequireAuth.tsx (route guard)
├── app/                # PropertyContext.tsx — app-wide selected property
├── components/         # shared: Layout, Money, FreshnessBadge, States
├── features/           # one folder per page: login/, dashboard/,
│                       # recommendations/, competitors/, events/, settings/
└── test/               # fixtures.ts, setup.ts, renderWithProviders.tsx
```

## Commands (run from `web/`)

```bash
npm run dev        # Vite dev server on :5173
npm test           # vitest (watch); `npm test -- --run` for CI mode
npm run typecheck  # tsc --noEmit against tsconfig.app.json
npm run build      # tsc -b && vite build → dist/
npm run preview    # serve the production build locally
```

## Conventions (review-blockers if violated)

- **Types mirror `shared/contracts/openapi.yaml`.** Update `src/api/types.ts`
  in the same PR as any API change. Never let types drift from the contract.
- **react-query for all server state.** No `useEffect` fetching, ever. Add new
  endpoints as hooks in `src/api/hooks.ts`; pages consume hooks only.
- **Feature-folder structure.** A page and its private components live under
  `src/features/<name>/`. Only genuinely shared pieces go in `src/components/`.
- **Money is display-only.** Format with `Money`/`formatMoney`
  (Intl, ro-RO); never compute prices or derive money figures client-side —
  server numbers are the truth (root CLAUDE.md hard rule).
- **Factors renderer stays backward compatible per `engine_version`.** The
  `factors` JSON (`shared/contracts/recommendation-factors.md`) is versioned:
  tolerate unknown extra fields and unknown `rule` names — always render the
  `reason` sentence. Never crash a card over payload drift.
- **Every page handles loading / error / empty** (use `src/components/States.tsx`).
- **Accessibility & legibility first.** Users are often older, non-technical
  hotel owners: ≥16px text, high contrast, visible focus, real labels on form
  controls, plain language over jargon. Data freshness must stay visible
  (`FreshnessBadge`).
## Auth

- **Session storage** (`src/auth/session.ts`): the JWT from
  `POST /auth/login` lives in localStorage — `pricepilot.token`,
  `pricepilot.expiresAt`, `pricepilot.user` (UserInfo JSON, per openapi.yaml).
  `getActiveSession()` returns `null` for missing, corrupt, or expired
  sessions; expired == logged out everywhere.
- **API client** (`src/api/client.ts`): sends `Authorization: Bearer <token>`
  while a valid session exists; otherwise falls back to the dev-only
  `X-Tenant-Id` header from localStorage (Settings page) — keep that fallback,
  dev tooling relies on it. Any 401 clears the session, redirects the browser
  to `/login`, and throws `UnauthorizedError` (an `ApiError` subclass) so
  callers can ignore it. `login()` opts out of the redirect (its 401 means
  wrong credentials) and stores the session on success.
- **Route guard** (`src/auth/RequireAuth.tsx`): everything under the Layout
  requires a non-expired session OR the dev tenant-id override; otherwise it
  redirects to `/login`. `/login` itself sits outside the Layout and shows a
  demo-credentials hint in dev builds only (`import.meta.env.DEV`).
- The 401 error copy on the login page ("Email sau parolă greșită.") is the
  one deliberately Romanian string in the UI; keep the rest English for now.
- **Selected property** (`src/app/PropertyContext.tsx`): the Layout header's
  `<select>` sets it (persisted as `pricepilot.propertyId`); pages read it via
  `useSelectedProperty()` — never run a per-page property selector.
