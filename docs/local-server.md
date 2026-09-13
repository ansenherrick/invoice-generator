# Local server deployment

The live freelance site is `https://freelance.ansenherrick.com`. Cloudflare
routes it to the desktop's port 8081. Nginx serves the frontend and forwards
`/api/` and `/uploads/` to the local API. There is no Vercel or Supabase runtime
dependency in this deployment.

## Database and files

The sibling `C:\Services\desktop-services` Compose project supplies:

- `DATABASE_URL=postgresql://appuser:<password>@postgres:5432/invoice_generator?sslmode=disable`
- `USE_DEV_DATA=false`
- `STORAGE_BACKEND=local`
- `UPLOAD_DIR=uploads`, resolved to `/app/uploads` inside the API container
- `WEB_ORIGIN=https://freelance.ansenherrick.com` through the public overlay
- `JWT_SECRET` from the ignored runtime `.env` file

PostgreSQL's port is internal to Docker. `sslmode=disable` applies to that
internal database connection; visitors still use HTTPS. Remote PostgreSQL
deployments must specify their own TLS requirements in `DATABASE_URL`.

The `personal-desktop-services_postgres_data` volume stores database data, and
`personal-desktop-services_invoice_uploads` stores logos and signatures. Rebuilding
the API preserves both. Do not remove these volumes during updates.

This is a fresh local deployment. No accounts or data are imported from Supabase;
register an account on the local deployment's public site.

The SQL under `apps/api/supabase/migrations` is ordinary PostgreSQL schema SQL,
also used by the local stack. Its directory name does not require Supabase.
Legacy hosted configuration is retained for reference, but is not used here.

## Update the API

Run in `C:\Services\desktop-services`:

```powershell
docker compose -f compose.yaml -f compose.cloudflare.yaml up -d --build --no-deps invoice-api
docker compose -f compose.yaml -f compose.cloudflare.yaml ps
Invoke-RestMethod https://freelance.ansenherrick.com/api/health
```

The Docker build runs the API regression tests. The health endpoint now checks
PostgreSQL and returns HTTP 503 when the database connection fails.

## End-to-end verification

The smoke test uses a randomly named disposable account to verify registration,
login, database persistence, invoices, time tracking, and local image uploads.
It deletes only its own account, related records, and image files afterward.

Run from `C:\Services\invoice-generator`:

```powershell
docker exec personal-desktop-services-invoice-api-1 mkdir -p /app/deployment
docker cp deployment/smoke-local.mjs personal-desktop-services-invoice-api-1:/app/deployment/smoke-local.mjs
docker exec personal-desktop-services-invoice-api-1 node /app/deployment/smoke-local.mjs
```

Before relying on this host, back up both the database and upload volume.
