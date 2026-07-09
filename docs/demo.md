# Demo: zero → recommendations on the dashboard

Verified sequence (2026-07-04) for a fresh machine with Docker, .NET 9, Python 3.12+, Node.

## 1. Database + schema + demo world

```powershell
# repo root
docker compose up -d db

cd backend
dotnet tool restore
dotnet tool run dotnet-ef database update --project src/PricePilot.Infrastructure --startup-project src/PricePilot.Api --connection "Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=devpassword"
```

## 2. Backend API (seeds the demo tenant on boot)

```powershell
cd backend
$env:ASPNETCORE_ENVIRONMENT="Development"
$env:ASPNETCORE_URLS="http://localhost:8080"
$env:ConnectionStrings__Default="Host=localhost;Port=5432;Database=pricepilot;Username=pricepilot;Password=devpassword"
$env:JWT_SIGNING_KEY="dev-only-change-me-32-chars-minimum!!"
$env:Database__MigrateOnStartup="true"
$env:Demo__SeedOnStartup="true"
dotnet run --project src/PricePilot.Api
```

Seeds `shared/contracts/demo-seed.md`: tenant, user `demo@pricepilot.local` / `Demo1234!`,
"Pensiunea Piața Mică" (Sibiu), 2 room types, 3 competitors.

## 3. Demo competitor rates + recommendations

```powershell
cd dataplane   # one-time: py -3.12 -m venv .venv ; .venv\Scripts\pip install -e ".[dev]"
$env:DATABASE_URL = "postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
.venv\Scripts\python -m pricepilot.demo.seed
.venv\Scripts\python -c "from pricepilot.db.session import get_session_factory; from pricepilot.scheduler.jobs import enqueue_job; from pricepilot.scheduler.main import poll_once; s = get_session_factory()(); enqueue_job(s, 'engine.generate_recommendations', {'tenant_id': None, 'property_id': None, 'horizon_days': 90}); s.close(); print('handled:', poll_once())"
```

Expected: `{"generated": ~180, "skipped": 0}` — one pending recommendation per room type per day.

(Alternatively run the scheduler loop instead of `poll_once`: `python -m pricepilot.scheduler.main`.)

## 4. Dashboard

```powershell
cd web        # one-time: npm install
npm run dev   # http://localhost:5173
```

Log in with the demo credentials → pick "Pensiunea Piața Mică" → Recommendations.
Each card shows current → recommended price with the full reasoning (seasonality, FITS
event impact, competitor position, day-of-week, lead time) and estimated impact.

## Quick API check without the dashboard

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/v1/auth/login -ContentType "application/json" -Body '{"email":"demo@pricepilot.local","password":"Demo1234!"}'
$hdr = @{Authorization = "Bearer $($login.token)"}
$p = (Invoke-RestMethod -Headers $hdr http://localhost:8080/api/v1/properties)[0]
Invoke-RestMethod -Headers $hdr "http://localhost:8080/api/v1/properties/$($p.id)/recommendations?from=2026-07-05&to=2026-08-05" | Select-Object -First 2
```

## Google Places foundation

Verified sequence for the enter-property → resolve → auto-discover-competitors flow
(`docs/superpowers/specs/2026-07-08-google-places-foundation-design.md`). Uses the
same running stack as sections 1–4; `PLACES_PROVIDER=fixture` (the default — see
`.env.example`) makes this deterministic and free by replaying a saved Sibiu fixture,
so demo and tests never bill Google.

1. **Log in** with the demo credentials (section 2) and go to **Settings**.
2. Under **"Add your property"**, enter only a **name + city** — nothing else — e.g.
   `Hotel Continental Forum` / `Sibiu`, and submit. The backend creates the property
   row (`placeStatus: "unresolved"`) and enqueues a `resolve_place` job
   (`shared/contracts/jobs.md`).
3. **Run the dataplane worker** so it claims the job (either loop it or call
   `poll_once` twice — once for `resolve_place`, once for the `discover_competitors`
   job it chain-enqueues):
   ```powershell
   cd dataplane
   $env:DATABASE_URL = "postgresql+psycopg://pricepilot:devpassword@localhost:5432/pricepilot"
   $env:PLACES_PROVIDER = "fixture"   # default; explicit here for clarity
   .venv\Scripts\python -m pricepilot.scheduler.main
   ```
   With `PLACES_PROVIDER=fixture`, `resolve_place` replays
   `tests/fixtures/places/text_search_continental.json` (auto-picks "Hotel
   Continental Forum Sibiu", ★4.4, 1280 reviews) instead of calling Google.
4. Back in **Settings**, the property card flips from "Finding your place on
   Google…" to the resolved state: address, **★4.4 (1280 reviews)**, and a map-pin
   coordinate chip. If the auto-pick were wrong, "Not the right place?" reveals the
   other stashed candidate ("Hotel Continental") to pick instead, or a free-text
   "Search by a different name" box that re-enqueues `resolve_place`.
5. The chained `discover_competitors` job replays
   `tests/fixtures/places/nearby_lodging_sibiu.json` (`nearby(lat, lng,
   kind="lodging")`) and upserts three nearby hotels as tracked competitors —
   no manual competitor entry exists anymore.
6. Open the **Competitors** page: it now lists the discovered lodging (Hotel
   Împăratul Romanilor ★4.3, Golden Tulip Ana Dora Sibiu ★4.5, Hotel Silva Sibiu
   ★4.1) with rating, review count, and distance from the property. Click
   **Untrack** on one and confirm — it soft-deletes (`excludedAt` set) and drops
   off the list; discovery and the rate scraper skip it from then on.
7. Points of interest for Sibiu are seeded on backend startup (Piața Mare, Piața
   Mică, Podul Minciunilor, Muzeul Brukenthal, Centru istoric) and readable via
   `GET /points-of-interest?city=sibiu` — the reference data the (not-yet-built)
   proximity pricing rule will consume later.

A **real** demo (not fixture replay) sets `PLACES_PROVIDER=google` +
`GOOGLE_PLACES_API_KEY` after a one-time, human-in-the-loop capture:
`.venv\Scripts\python -m pricepilot.places.capture text "<a real Sibiu hotel>" --city sibiu`
and `... nearby --lat <r> --lng <r>` (see `dataplane/CLAUDE.md` for the scraper
`capture` CLI this mirrors); the sanitized output replaces the fixtures above so
the demo replays real Google data while tests still never call it live.

## Full-container alternative

`docker compose up --build` runs db + api (migrates + seeds) + dataplane scheduler + web
on :5173. Then run step 3's two commands (with `DATABASE_URL` pointing at localhost) to
seed rates and enqueue the engine job — the containerized scheduler picks it up within 5s.
