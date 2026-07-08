# Supabase + Vercel Checklist

## Goal

Deploy this repo as:

- one Vercel app
- one Supabase project
- one shared backend
- separate invoice and time-tracker business tables

## 1. Prepare Supabase

1. Create a new Supabase project.
2. Open the SQL Editor.
3. Run:

   `apps/api/supabase/migrations/20260706_000001_freelance_toolset_initial.sql`

4. Open Storage.
5. Create a public bucket named `invoice-assets`.
6. Copy these values for later:
   `Project URL`
   `Service role key`
   `Transaction pooler DATABASE_URL`

## 2. Prepare Vercel

1. Import the `Invoice Generator` repository into Vercel.
2. Set the project root to `/`.
3. Confirm Vercel picks up [vercel.json](/Users/ansenherrick/Desktop/code/Invoice Generator/vercel.json:1).
4. Add these environment variables:

   `DATABASE_URL`
   `JWT_SECRET`
   `WEB_ORIGIN`
   `SUPABASE_URL`
   `SUPABASE_SERVICE_ROLE_KEY`
   `SUPABASE_STORAGE_BUCKET=invoice-assets`

5. Set `WEB_ORIGIN` to the final Vercel URL for this app.

## 3. Confirm data boundaries

After the migration runs, verify these table groups exist:

- Shared auth table:
  `users`
- Invoice tables:
  `profiles`
  `invoices`
  `saved_clients`
- Time-tracker tables:
  `shifts`
  `shift_breaks`
  `shift_exports`

The invoice module should only receive tracker data through `.invoice` handoff payloads, not direct tracker-table reads for invoice creation.

## 4. First deploy

1. Run a Vercel deploy.
2. Open the deployed app.
3. Register a new account.
4. Save a profile.
5. Create a manual shift in the Time Tracker.
6. Export or hand off that shift into the Invoice Builder.
7. Save a draft invoice.
8. Upload a logo or signature to confirm Supabase Storage works.

## 5. Local parity check

For local Postgres development, run:

```bash
npm run db:setup
```

That uses the same SQL artifact as the Supabase migration so local and hosted schema stay aligned.

## 6. Common failure points

- Vercel root accidentally set to `apps/api` instead of `/`
- Wrong `DATABASE_URL` format instead of the Supabase transaction pooler
- Missing `SUPABASE_SERVICE_ROLE_KEY`
- Missing `invoice-assets` storage bucket
- Old assumption that invoices can be built by directly reading tracker data
