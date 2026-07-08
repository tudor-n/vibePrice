# Handoff: PricePilot — Watercolor Storybook Redesign (Login, Dashboard, Recommendations)

## Overview
A visual redesign of **PricePilot** — a dynamic pricing tool for hotels, guesthouses and short-term rentals (owners are often older and non-technical). The redesign wraps the existing product in a warm, hand-drawn "watercolor storybook" theme evoking old European towns (Sibiu / Prague / Paris). It covers three surfaces:

1. **Login** — split layout with a large watercolor townscape hero beside the sign-in form.
2. **Dashboard** — the existing summary cards (pending recommendations, estimated impact, next event, price calendar) reskinned, with an illustrated deep-teal sidebar.
3. **Recommendations + Price Calendar** — a real month calendar (your rate vs. competitor band per night) plus an inline recommendation card and an illustrated empty state.

The data structure and information architecture of the original app are unchanged — this is a styling/illustration layer over the existing features.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes that show the intended look, layout and behavior. They are **not production code to copy directly**. They are authored as "Design Components" (a custom `.dc.html` streaming format with a `support.js` runtime and inline styles) — that runtime is **not** meant to ship.

The task is to **recreate these designs in the target codebase's existing environment**. This project already has a React + TypeScript frontend (`hotel-price/web`, Vite, React Router, TanStack Query) with a plain-CSS token system in `src/styles/global.css`. Recreate the designs there using the existing components, routing, hooks and CSS-variable conventions — port the *visual language* (below) into that token system rather than pasting inline styles.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, illustrations and interactions are specified. Recreate the UI pixel-closely using the codebase's existing libraries and patterns. All hex values, font sizes and measurements below are exact and taken from the prototypes.

---

## Design Tokens

### Color palette
| Token (suggested) | Hex | Usage |
|---|---|---|
| `--bg-paper` | `#f4ece0` | App background (warm parchment) |
| `--bg-card` | `#fffdf8` | Card / panel surface |
| `--bg-cream` | `#fbf6ec` | Topbar, secondary panels, login form side |
| `--bg-hero` | `#f3e7d2` | Illustration backdrop |
| `--ink` | `#3b3229` | Primary text (warm near-black) |
| `--ink-soft` | `#6f6357` | Secondary text |
| `--ink-muted` | `#8a7c6a` | Labels, captions, uppercase eyebrows |
| `--line` | `#e6dcc7` | Card borders / hairlines |
| `--line-input` | `#d9cdb8` | Input borders |
| `--line-dashed` | `#d8c6a4` | Dashed decorative borders |
| `--terracotta` | `#c96f4a` | Primary accent / CTA, active nav |
| `--terracotta-hover` | `#b5654a` | CTA hover |
| `--terracotta-ink` | `#a9522f` | Link hover, event text, hand-drawn underline |
| `--teal` | `#2f4a47` | Sidebar background |
| `--teal-text` | `#e7efe9` | Sidebar text |
| `--teal-text-dim` | `#cfe0d8` | Sidebar inactive nav items |
| `--gold` | `#e6c07a` | Logo mark stroke on teal, sun/lamp glow |
| `--green` | `#196a3e` | Positive impact figures |
| `--green-soft` | `#6f9a86` | "Room to raise" marker, positive icon |
| `--amber` | `#d9a441` | "Well placed" calendar marker |
| `--warn-bg` | `#fdf0dc` | Demo/notice callout background |
| `--warn-text` | `#8a4b08` | Notice text |
| `--info-blue` | `#0f4675` | Recommended-price figure |

Illustration-only washes (SVG fills, not UI tokens): sage `#9fbc9b`/`#6f9a86`, terracotta roof `#d98c6a`/`#b5654a`, cream `#ece0c4`, church teal `#3f6f6a`, dusty blue `#9fc0d6`/`#5e88a6`, rose `#d9a79f`/`#b47d76`, ochre `#e0b25e`/`#c98a3c`, window glow `#f6e2b0`, ink outline `#4a3b2f`. Sunset sky gradient stops: `#c9d2da → #e4c6b6 → #f2c89e → #f8daa4 → #f6e6c6` (top→bottom).

### Typography
Two Google Fonts:
- **DM Serif Display** — display/headings. Used at 22–52px. Italic variant used for taglines and the topbar "Your pricing copilot".
- **Spectral** (weights 400/500/600/700) — body, labels, buttons, inputs, data.

Type scale in use:
- Big metric numerals: DM Serif Display 44–52px, line-height 1
- Page title (h2): DM Serif Display 32px
- Panel title (h3): DM Serif Display 24px
- Card title: DM Serif Display 21–22px
- Body: Spectral 15–16px, line-height ~1.6
- Eyebrow label: Spectral 13px, weight 600, `text-transform:uppercase`, `letter-spacing:0.05em`, color `--ink-muted`
- Button: Spectral 15px, weight 700
- Nav item: Spectral 16px

### Spacing, radius, shadow
- Card padding: 22–26px. Section gaps: 20–24px.
- Border radius: inputs/buttons `10–11px`, cards `15–16px`, pills `999px`, calendar day cells `10px`.
- Card border: `1.5px solid #e6dcc7`. Decorative dashed: `1.5px dashed #d8c6a4`.
- Card shadow: `0 10px 24px rgba(59,50,41,0.06)`.
- Modal/hero shadow: `0 24px 60px rgba(59,50,41,0.22)`.
- CTA shadow: `0 6px 16px rgba(201,111,74,0.3)`.
- Input focus ring: `border-color:#c96f4a; box-shadow:0 0 0 3px rgba(201,111,74,0.16)`.

---

## Screens / Views

### 1. Login (option 1a — chosen direction)
**Purpose:** Owner signs in.
**Layout:** Centered card `1000×640`, `border-radius:18px`, split into two columns:
- **Left illustration panel** `460px` wide, `#f3e7d2`, holds the full-bleed watercolor townscape (see Illustration System). Top-left: logo lockup (house-roof SVG mark + "PricePilot" in DM Serif Display 24px, cream `#fbf6ec`). A top-down dark gradient (`rgba(47,74,71,0.42)→0`) improves logo contrast. Bottom: tagline "Prices your whole street can't argue with." (DM Serif Display 24px) + subline (Spectral 15px) over a subtle text-shadow / frosted treatment for legibility against the sunset.
- **Right form panel** (flex:1, padding 56px, vertically centered): "Welcome back" (DM Serif Display 30px), subline (Spectral 16px, `--ink-soft`), then a form (max-width 360px):
  - Email + Password fields — label (Spectral 600, 15px) stacked above input; input `13px 15px`, `1.5px solid #d9cdb8`, radius 11px, bg `#fffdf8`, focus ring as above.
  - "Remember me" checkbox + "Forgot password?" link row.
  - "Sign in" button — full-width, terracotta, Spectral 700 16px, radius 11px, CTA shadow.
  - Demo-account notice — `#fdf0dc` bg, dashed `#e6c79a` border, `#8a4b08` text: `ana@casaluca.ro · password123`.
  - Bottom: subtle "New to PricePilot? / help" link.

### 2. Dashboard
**Purpose:** Morning overview of what changed and what needs a decision.
**Layout:** Full-height flex: `246px` sidebar + main column.
- **Sidebar** `#2f4a47`, padding `26px 18px 0`, flex column:
  - Logo lockup (gold-stroke mark + cream wordmark).
  - Nav items (Dashboard, Recommendations, Competitors, Events, Settings): row, `gap:12px`, padding `12px 14px`, radius 11px, Spectral 16px. Active = terracotta bg + white text; inactive = `#cfe0d8`, hover `rgba(255,255,255,0.08)`. Each has a hand-drawn line icon (18px, `stroke-width:1.7`, round caps).
  - **Bottom illustration:** `village-sidebar.png` pinned flush to the bottom edge, full sidebar width, filling roughly the bottom quarter. It is a packed watercolor terrace of houses + two lampposts standing on a cobbled street (baked into the PNG).
- **Topbar** `#fbf6ec`, `1px solid #e6dcc7`, padding `16px 28px`, space-between: italic "Your pricing copilot" (DM Serif Display 18px) · property switcher ("Casa Luca, Sibiu" + chevron) · "Ana Popescu" · "Log out" outline button.
- **Content** padding `28px 32px`:
  - Header row: "Good morning, Ana" (DM Serif Display 32px) + "Refresh data now" outline button (terracotta, with refresh icon).
  - Subtitle: "Casa Luca · Sibiu — here's what changed while you slept." (Spectral 16px).
  - **Three summary cards** (`grid`, 3 cols, gap 20px), each `#fffdf8`, `1.5px solid #e6dcc7`, radius 15px, card shadow, a decorative corner line-icon top-right (28% opacity family color), eyebrow label (padded-right 40px to clear the icon), and a big DM Serif Display numeral:
    1. **Pending recommendations** — "3", gold gem icon, sub "price suggestions waiting for your decision".
    2. **Estimated total impact** — "+3.400 RON" (`#196a3e`), green up-chart icon, sub "if you accept all pending recommendations".
    3. **Next big event** — "Sibiu Theatre Festival" (23px), terracotta star icon, "12 Jun → 21 Jun · impact 88/100".
  - **Price calendar panel** — dashed-border card; on the dashboard this can link out to the full calendar (see screen 3). Decorative faint town silhouette / house cluster along the bottom-right, plus bunting.

### 3. Recommendations + Price Calendar
**Purpose:** Review suggested price changes and see the month at a glance.
**Layout:** Same sidebar + topbar shell as Dashboard (Recommendations nav item active).
- **Page header:** "Recommendations & price calendar" (DM Serif Display 32px) with a hand-drawn terracotta underline SVG (a wobbly `<path>` stroke-width 2.6, round caps), then a Spectral 16px intro.
- **Price calendar card** (`#fffdf8`, radius 16px):
  - Header: month label "June 2026" (DM Serif Display 24px) + "Casa Luca · Double Deluxe" caption; right-aligned legend with three colored dots — green "Room to raise", amber "Well placed", terracotta "Near the top".
  - Weekday header row (Mon–Sun), Spectral 12px 600 uppercase muted.
  - **6 week rows × 7 day cells.** Each cell: `min-height:96px`, radius 10px, `1px solid #ece2cf`. Background varies: out-of-month `#f1ece2`; event day `#fdeedd`; weekend `#f6efe2`; normal `#fffdf8`.
    - Top row of cell: day number (600 13px; event days `#a9522f`, others `#6f6357`) + optional **FITS event pill** (`#f7dcc4` bg, `#a9522f` text, tiny spire glyph) on days 12–21.
    - Price: DM Serif Display 19px + " RON" caption.
    - Competitor range caption: "vs {low}–{high}" (Spectral 10.5px muted).
    - **Position bar:** 5px track `#eadfc9`, a 10px circular marker positioned by where the price sits in the competitor band; marker color green/amber/terracotta by position (`<0.42`, `<0.72`, else).
- **Two-column row below** (`grid` 1.55fr / 1fr):
  - **Live recommendation card** — date title "Sat, 14 June 2026" + "Double Deluxe · FITS opening weekend", "Pending" pill. Price change: `350 RON` (struck-through, muted) → `440 RON` (DM Serif Display 34px, `#0f4675`) "recommended". "Why this price" list — three factor rows, each a green `+15% / +12% / +5%` pill (`#e2f3e8` bg, `#196a3e` text) + plain-language reason. Impact callout (`#f6efe2`): "Estimated +3,400 RON … if accepted." Footer: freshness caption + "Accept price" (terracotta CTA) / "Dismiss" (outline) buttons.
  - **Empty state** — dashed card, centered: `house-sage.png` (96px), "All quiet on your street" (DM Serif Display 21px), Spectral 15px explanation. Template for all empty/loading states.

---

## Interactions & Behavior
- **Nav:** clicking a sidebar item routes to that page and sets the active (terracotta) style. Wire to existing React Router routes.
- **Refresh data now:** triggers the existing job/refetch (the app already has a "trigger job" hook + TanStack Query invalidation). Show a loading state on the button while running.
- **Accept price / Dismiss:** call the existing recommendation accept/dismiss mutations; optimistically remove the card and update the "pending" count + impact figure.
- **Property switcher:** dropdown of the owner's properties; changing it refetches dashboard/calendar data.
- **Calendar (suggested next step):** clicking a day with a pending change scrolls to / opens its recommendation card.
- **Hover states:** CTA darkens to `#b5654a`; outline buttons fill to `#faeee6`/`#f4ece0`; inactive nav items get `rgba(255,255,255,0.08)`; links go `#c96f4a → #a9522f`.
- **Focus:** inputs show the terracotta focus ring (see tokens). Preserve visible focus for keyboard users (audience skews older — keep contrast high, hit targets ≥44px).
- **Animation (login only, keep restrained):** the townscape birds gently flap and clouds drift slowly. The **dashboard and data screens have no animation** by design — it's a serious tool. Respect `prefers-reduced-motion`.

## State Management
Reuse the existing frontend data layer (TanStack Query hooks in `hotel-price/web/src/api/`). State needed per screen:
- **Login:** email, password, rememberMe, submitting, error. Auth via existing flow.
- **Dashboard:** selected property; queries for events, recommendations (pending count + summed impact), next event; refresh-job pending flag.
- **Recommendations/Calendar:** selected property + month; recommendations list; per-day derived model (price, competitor low/high, band position → marker color, event flag). In the prototype the calendar model is computed client-side from month/first-weekday + an events map; in production derive it from real rate + competitor data.

## Design Tokens
See the **Design Tokens** section above (colors, type, spacing, radius, shadow) — all values are exact.

## Assets
All illustrations are custom, hand-made for this design (watercolor + ink-wobble SVG filters, rasterized to PNG). Located in `assets/houses/` in this bundle:
- `house-sage.png`, `house-terracotta.png`, `house-rose.png`, `house-church.png`, `house-blue.png`, `house-ochre.png` — individual town houses (used in clusters + empty states).
- `lamppost.png` — street lamp.
- `village-sidebar.png` — the packed terrace + cobbled street baked in, for the dashboard sidebar foot.
- The **login townscape** and the small **skyline silhouettes** are inline SVG (see `Townscape.dc.html`) — a wide watercolor town with sunset sky, drifting clouds, birds, church spire, mansard roofs, "eyes of Sibiu" dormers, lit windows and a cobblestone street. Recreate as an SVG asset or exported illustration; the SVG source in `Townscape.dc.html` is the reference (note the `feTurbulence`/`feDisplacementMap` filters give the hand-drawn wobble, and a paper-grain overlay).
- Fonts: **DM Serif Display** + **Spectral** from Google Fonts.

No third-party icon library — all icons are inline SVG line icons (`stroke-width:1.7`, round caps/joins). Recreate or match with your existing icon set.

## Files
Design-reference prototypes included in this bundle (open in a browser to view):
- `PricePilot Redesign.dc.html` — login (1a) + dashboard, side by side on a canvas.
- `PricePilot Recommendations.dc.html` — recommendations + price calendar + empty state.
- `Townscape.dc.html` — the reusable townscape illustration (hero + silhouette variants); SVG source for the login hero.
- `support.js` — the prototype runtime (reference only; **do not ship**).
- `assets/houses/*.png` — the illustration assets listed above.

> The `.dc.html` files use inline styles and a streaming component runtime purely so the prototype renders. Port the **visual language** into the app's existing React components + CSS tokens — do not copy the inline styles or `support.js`.
