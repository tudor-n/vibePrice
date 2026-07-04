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

## Full-container alternative

`docker compose up --build` runs db + api (migrates + seeds) + dataplane scheduler + web
on :5173. Then run step 3's two commands (with `DATABASE_URL` pointing at localhost) to
seed rates and enqueue the engine job — the containerized scheduler picks it up within 5s.
