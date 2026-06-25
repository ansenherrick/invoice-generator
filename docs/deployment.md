# Deployment guide

## Target architecture

- frontend: Vercel static hosting from `apps/web/dist`
- backend: Express on Vercel via `api/index.ts`
- database: Supabase Postgres
- asset storage: Supabase Storage

## Required environment variables

- `DATABASE_URL`
- `JWT_SECRET`
- `WEB_ORIGIN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

## Recommended values

- `DATABASE_URL`: use the Supabase transaction pooler connection string for serverless deployments
- `WEB_ORIGIN`: your deployed app origin, for example `https://your-invoice-app.vercel.app`
- `SUPABASE_STORAGE_BUCKET`: `invoice-assets`

## Supabase setup

1. Create a Supabase project
2. Create a public bucket named `invoice-assets`
3. Run the SQL schema from `apps/api/src/db/schema.sql`
4. Copy the Postgres pooler connection string into `DATABASE_URL`
5. Copy the project URL and service role key into the matching env vars

## Vercel setup

1. Import this repo into Vercel
2. Keep the root directory at the repo root
3. Vercel will use `vercel.json`
4. Add the required environment variables
5. Deploy

## Notes

- The frontend talks to `/api/*`, so same-origin deployment stays simple
- Supabase Storage is used automatically when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present
- Local file uploads remain available in development when Supabase env vars are absent
