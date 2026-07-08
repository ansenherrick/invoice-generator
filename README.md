# Freelance Toolset

A combined freelance toolset built as one repo, one deployable Vercel app, and one Supabase-backed backend with separate product domains inside it:

- `apps/web`: React + Vite frontend
- `apps/api`: Express + PostgreSQL backend
- `packages/shared`: shared invoice types, time-tracking types, totals logic, template registry, and import/export parsers

The merged app currently contains two modules:

- `Invoice Builder`: profiles, clients, draft/finalized invoices, PDF export
- `Time Tracker`: shift tracking, manual entries, break tracking, shift exports

These modules share authentication and deployment infrastructure, but they do not share business tables. Tracker data stays in tracker tables, invoice data stays in invoice tables, and the handoff between them uses the compact `.invoice` import/export contract rather than direct invoice reads from tracker records.

## Included features

- Email/password account registration and login
- Per-account saved freelancer profile
- Logo upload and signature upload
- Saved primary and secondary payment methods
- Reusable saved clients with load/edit/delete support
- Time tracking with live shifts, manual shifts, and break tracking
- Shift export to CSV and compact `.invoice`
- Draft invoice saving and re-opening
- Finalized invoice saving
- Direct PDF export from the invoice preview
- Import from `.csv`, `.json`, and compact `.invoice`
- Internal tracker-to-invoice handoff through compact `.invoice`
- Copy direct compact-import links
- Template registry with a first `modern-minimal` template

## Local setup

1. Copy `.env.example` to `.env`
2. Start Postgres:

   ```bash
   docker compose up -d
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create database tables:

   ```bash
   npm run db:setup
   ```

5. Run the app:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:5173`

## Local dev mode without Postgres

If you just want to test the full UI and account flow locally, run the API in dev-data mode:

```bash
npm run dev:api:devdata
```

This writes local test data to `apps/api/dev-data.json`, so registration, login, profile saving, clients, and invoice drafts work without Postgres.

## Architecture notes

- This repo is intended to deploy as one Vercel app and use one Supabase project.
- Authentication is shared at the app level through the `users` table.
- Invoice data and tracker data are kept separate in different table families inside the same Postgres database.
- The invoice module does not query tracker tables to create invoices. It consumes the same compact `.invoice` handoff format used by external integrations.
- User profile data is stored as JSONB in Postgres so future invoice fields and templates can evolve without an early migration burden.
- Invoice drafts and finalized invoices are also stored as JSONB, with `status`, `template_id`, and `source_format` indexed separately for flexibility.
- Time tracker shifts, breaks, and exports live in their own tracker tables.
- Uploads use a storage abstraction boundary. Locally they are written to `uploads/`, and when Supabase env vars are present they are pushed to Supabase Storage.
- The frontend imports shared parsing logic from `packages/shared`, so the internal tracker and any external tool can use the same `.invoice` contract.

## Supabase storage note

For logos and signatures, Supabase Storage usage is typically small if we keep files lightweight:

- logos: usually tens to a few hundred KB
- signatures: usually very small transparent PNGs

That means storage cost should stay low for this use case, especially if we add file-size limits and optionally compress uploads later.

## Key docs

- [Deployment guide](./docs/deployment.md)
- [Architecture and domain separation](./docs/architecture.md)
- [Supabase + Vercel checklist](./docs/supabase-vercel-checklist.md)
- [Compact `.invoice` format](./docs/invoice-format.md)
- [Tracker/invoice handoff](./docs/clock-keeper-integration.md)
