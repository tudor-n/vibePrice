# Usability Overhaul — Design

**Date:** 2026-07-09
**Status:** Approved (design); implementation plan to follow.

## Context

Owner's goal (their words): make the app *"very accessible to people that are not
tech savvy — foolproofed and incredibly obvious and intuitive."* Triggered by the
observation that the just-landed Google Places feature *"is not very intuitive on
the UI."*

Grounding observation: the app **already** has a strong accessible *visual*
foundation — the watercolor design system (`web/src/styles/global.css`) explicitly
targets older, non-technical owners with ≥16px body, AA-adjusted contrast, generous
spacing, and warm illustrations. So this is **not** a fonts/colors problem. The gap
is **flow and comprehension**:

- A brand-new owner (no property) lands on a Dashboard that passively says "Add your
  first property in Settings" — no guided action; they must *find* Settings.
- The core value chain (add property → Google resolves → competitors appear →
  recommendations) is scattered across four pages with nothing narrating it.
- Background work (place resolution, competitor discovery, refresh) happens
  **invisibly**: if the dataplane worker isn't running, a property sits "unresolved"
  forever with no signal — the "infinite spinner" problem.
- Copy mixes plain language with jargon ("competitor band", "impact",
  "Recommendations").

## Goals

Make a non-technical owner's path obvious end-to-end, via three interlocking
workstreams:

1. **Guided onboarding** — a full-screen `/setup` wizard that walks a new owner from
   nothing to their **first real price recommendation**.
2. **Async transparency** — one reusable pattern that makes every background job
   visible (working → progress → done) and never hangs (timeout → "slow" → retry).
3. **Plain-language rewrite** — one consistent, human voice across all copy, plus
   actionable empty states and inline explainers.

## Non-goals (explicit follow-ups)

- Live typeahead place search ("picker B" — dropdown updating as you type). Needs a
  synchronous search path (a documented backend→Google read exception, or a
  search-job+poll); deferred until that architecture is decided. This slice ships the
  "Did you mean?" candidate picker (picker A) instead.
- Self-service account signup (still login-only with the seeded demo user).
- Room-type **editing** and the accept-a-recommendation-sets-`current_price` loop
  (wave-4 proper).
- The reviews / proximity pricing rules.
- i18n (copy stays English per repo rules; i18n is a later concern).

## Architecture

Mostly `web/`, one small backend addition, **no dataplane changes** — the wizard
orchestrates jobs that already exist (`resolve_place`, `discover_competitors`,
`scrape.competitor_rates`, `ingest.events`, `engine.generate_recommendations`).

```
1. GUIDED ONBOARDING (the spine)
   Full-screen /setup wizard, auto-entered when a logged-in owner has no property:
   ① Hotel name + town  → creates property, kicks off resolve_place
   ② "Did you mean?"    → pick from the top-5 Google matches already fetched
   ③ Your room + rate   → creates a room type (NEW backend endpoint)
   ④ Finding competitors→ discovery runs (async, real progress)
   ⑤ Your first prices  → runs scrape→events→engine, shows the first recommendation

2. ASYNC TRANSPARENCY (woven through 1, then reused app-wide)
   Shared AsyncStatus: working → progress → done, plus a timeout "slow" state
   ("taking longer than usual… the setup service may not be running") + retry.
   Applied at: place resolve, competitor discovery, dashboard "refresh".

3. PLAIN-LANGUAGE REWRITE (app-wide)
   One consistent human voice across nav, titles, buttons, hints, empty states,
   errors, tooltips. Actionable empty states (buttons, not text pointers).
   Inline "?" explainers on the remaining metrics (competitor band, extra income).
```

**New vs reused:**
- *New backend:* one endpoint — room-type create (`POST /properties/{id}/room-types`).
- *New web:* `/setup` wizard + steps; reusable `AsyncStatus`; reusable `PlacePicker`
  ("Did you mean?", shared by wizard + Settings); `Explainer` ("?" popover); a full
  copy sweep.
- *Reused as-is:* every dataplane job, the watercolor tokens, react-query, auth.

**Scope honesty:** large but cohesive. The **plan** sequences it — backend room-type
first, then wizard + async pattern, then the app-wide copy rewrite — so each piece
lands and is testable on its own.

## Workstream 1 — Onboarding wizard

**Route & trigger.** New `/setup` route **outside** the main Layout (full-screen, no
sidebar/topbar). The route guard sends a logged-in owner with **zero properties**
here automatically; anyone with ≥1 property who visits `/setup` is redirected to
`/` (Home). A quiet "Skip for now" on every step drops to the dashboard (never
trapped); the dashboard keeps a "Finish setting up" nudge until the owner has a
property **and** at least one room.

**One thing per screen**, progress dots at the foot, one big primary action:

| Step | Screen | Action |
|---|---|---|
| ① Name | "What's your hotel called?" name + town (city) | `POST /properties {name, city}` → fires `resolve_place`; advance |
| ② Confirm | "Which one is you?" — the `PlacePicker` over the top-5 candidates (name · address · ★rating), plus "None of these → search by a different name" | `PATCH /properties/{id}/place {placeId}` |
| ③ Room | "Your most common room, and what you charge" — name · sleeps · price/night · currency | `POST /properties/{id}/room-types` (new) |
| ④ Competitors | "Finding hotels near you…" — `AsyncStatus`, shows discovered names/ratings as they land | polls the competitors list until non-empty / timeout |
| ⑤ Prices | "Here's your first price suggestion" — runs scrape→events→engine, shows the first recommendation card (price + plain "why"); `[ Looks good — take me in → ]` → `/` | sequences the 3 jobs, polls recommendations |

**Async inside the wizard.** Steps ②, ④, ⑤ depend on background jobs; each uses
`AsyncStatus` (Workstream 2). The wizard **never blocks forever** and never shows a
raw spinner with no exit: on timeout it offers *"Try again"* or *"Keep working in the
background"* (→ dashboard). If resolution fails (no Google match), ② offers
"search by a different name" or "skip".

**State & resume.** The wizard reads real server state (property `placeStatus`,
competitors list, recommendations) via react-query — no local duplication of truth.
On reload it **resumes at the correct step** by inspecting what already exists
(property created? place resolved? room added? competitors found?), so a refresh
never loses progress.

## Workstream 2 — Async transparency

**`AsyncStatus`** — a shared component driven by react-query polling of a real server
signal, rendering one of four states with plain copy and a **deadline**:

| State | Copy (example) | Trigger |
|---|---|---|
| WORKING | "Finding your place on Google…" | signal not yet advanced, within budget |
| DONE | "Found it ✓ — ★4.4, 1,280 reviews" | signal reached success |
| SLOW | "This is taking longer than usual. The setup service may not be running. `[Try again]` `[Keep working in the background]`" | timeout budget elapsed without advance |
| FAILED | "We couldn't reach Google just now. `[Try again]`" | signal reached a failure state |

**Slow/worker-down detection (no new backend).** Each async action already has an
observable server signal: `property.placeStatus` (`unresolved`→`resolved`/`failed`),
the competitors list becoming non-empty, or a `jobs/{id}` status. `AsyncStatus` polls
that signal on an interval and runs a **timeout clock**; if the signal hasn't advanced
within the budget (≈20s resolve, ≈40s discovery — configurable per use), it flips to
SLOW. This is exactly the "unresolved forever because the worker isn't polling" case,
now surfaced instead of hung.

**Applied (this slice):**
- Wizard ② (resolve), ④ (discovery), ⑤ (first-price pipeline).
- **Dashboard "refresh"** — today fires 3 jobs and only says "queued". Becomes a real
  3-step progress (`Prices ✓ · What's on ✓ · Recalculating…`) with the same
  SLOW/FAILED fallback.
- **Settings property card** — the existing resolving/failed states fold onto this
  same component for consistent behaviour everywhere.

**Principle:** every async action shows what's happening, roughly how long, and always
offers a way forward — no infinite spinners, no dead ends.

## Workstream 3 — Plain-language rewrite + inline help

One consistent, warm, second-person voice across **all** user-facing copy. Principles:
short sentences; "you/your"; no jargon; always say *why*; numbers with context.
English (i18n later). Representative before→after:

| Where | Now | Rewritten |
|---|---|---|
| Nav | Recommendations / Competitors / Events | **Prices to review / Nearby hotels / What's on** |
| Nav | Dashboard / Settings | **Home / Your hotel** |
| Dashboard empty | "Add your first property in Settings…" | **"Let's set up your hotel"** + `[ Start setup → ]` |
| Refresh button | "Refresh data now" | **"Check for new prices"** |
| Metric | "Estimated total impact" | **"Extra income if you accept all"** |
| Rec card | "competitor band 380–455" | **"Nearby hotels charge 380–455 for these nights"** |
| Error | raw `ApiError` text | **"We couldn't reach Google just now — `[Try again]`"** |
| Competitors empty | "No competitors." | **"We're still finding hotels near you…"** (+ status) |

**`Explainer`** — a small accessible "?" popover on the few metrics that stay
technical (competitor band, extra income/impact, lead-time): one-sentence plain
explanation; keyboard-reachable; dismissible; screen-reader labelled.

**Actionable empty states everywhere** — every "nothing here yet" becomes a button
that does the obvious next thing, not a sentence telling you where to go.

**Scope:** Home, Prices to review, Nearby hotels, What's on, Your hotel (Settings),
login, the wizard, and shared components (States, errors). Nav renames change display
labels only (route URLs may stay). Every change is mirrored in component tests.

## Backend — room-type create (the one backend piece)

`POST /properties/{propertyId}/room-types {name, capacity, basePrice, currentPrice?,
currency?}` → 201 + RoomType.

- Endpoint-layer validation: `name` non-blank; `capacity ≥ 1`; `basePrice > 0` and
  `decimal.Round(v,2) == v`; `currency` exactly 3 letters, default `RON`;
  `currentPrice` defaults to `basePrice`.
- Tenant-scoped through the filtered context; foreign `propertyId` → **404, never
  403**; `TenantId` from `ITenantContext`, never the body.
- `openapi.yaml` moves in the same commit; TDD (WebApplicationFactory + SQLite),
  mirroring the foundation's endpoint tests.
- Web: wizard step ③ posts here; Settings gains a **"Your rooms"** list + **"Add
  room"** form on the property card (create-only).

## Accessibility (beyond legibility)

- Wizard: focus moves to each step's heading on advance; one clear primary action per
  screen; `≥44px` targets; visible focus; real labels on every control.
- `AsyncStatus` uses `aria-live="polite"` so status changes are announced to screen
  readers.
- Honor `prefers-reduced-motion` for the animated working states.

## Testing (TDD)

- **Backend:** room-type create — defaults (`currentPrice`=`basePrice`, currency
  `RON`), validation (capacity 0, price ≤ 0, 3-decimal price, bad currency → 400),
  foreign property → 404.
- **Web (Vitest/RTL, mocked fetch + fake timers):** full wizard (each step,
  candidate pick, room create, skip/escape, **resume-on-reload**); `AsyncStatus` all
  four states incl. the **timeout→SLOW** transition (fake timers); `Explainer`
  open/close + a11y; every existing page test updated for new copy + actionable empty
  states.
- **Verify:** `dotnet build && dotnet test`; `npm test -- --run`, `npm run typecheck`,
  `npm run build`. No dev-DB dependency (room-type is SQLite-tested; wizard runs on
  mocked fetch).

## Definition of done

- [ ] Tests written and passing across touched areas.
- [ ] `openapi.yaml` updated for room-type create (same commit); `web/types.ts`
      mirrors it.
- [ ] No tenant leak: room-type create tenant-scoped; foreign id → 404.
- [ ] Wizard never dead-ends (skip/retry/background on every async step); resumes on
      reload.
- [ ] a11y: focus management, `aria-live` status, reduced-motion, ≥44px, labels.
- [ ] Code-reviewer agent ran on the diff; findings addressed.

## Open items for later specs

- Live typeahead place search (picker B) + its synchronous-search architecture.
- Self-service account signup.
- Room-type editing + accept-loop `current_price` update.
- Reviews / proximity pricing rules; i18n.
