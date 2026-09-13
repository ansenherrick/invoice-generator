# Freelance Toolset

A combined freelance toolset hosted on this PC with Docker, local PostgreSQL, and a persistent local upload volume:

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

The live site at `https://freelance.ansenherrick.com` uses the sibling
`desktop-services` stack. For its deployment and maintenance commands, see
[Local server deployment](docs/local-server.md). Supabase and Vercel are not
required. The steps below are for a separate development environment.

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

- The current deployment runs the frontend, API, and PostgreSQL in Docker on this PC.
- Authentication is shared at the app level through the `users` table.
- Invoice data and tracker data are kept separate in different table families inside the same Postgres database.
- The invoice module does not query tracker tables to create invoices. It consumes the same compact `.invoice` handoff format used by external integrations.
- User profile data is stored as JSONB in Postgres so future invoice fields and templates can evolve without an early migration burden.
- Invoice drafts and finalized invoices are also stored as JSONB, with `status`, `template_id`, and `source_format` indexed separately for flexibility.
- Time tracker shifts, breaks, and exports live in their own tracker tables.
- Uploads use local files by default (`STORAGE_BACKEND=local`). Supabase storage requires an explicit `STORAGE_BACKEND=supabase` setting as well as credentials; leftover credentials do not switch storage providers.
- The frontend imports shared parsing logic from `packages/shared`, so the internal tracker and any external tool can use the same `.invoice` contract.

## Data on this PC

Accounts, profiles, invoices, and time-tracker records use the local database.
Logos and signatures use the Docker upload volume. This is a fresh deployment;
previous Supabase accounts, records, and files have not been imported.

## Key docs

- [Local server deployment](./docs/local-server.md)
- [Legacy hosted deployment guide](./docs/deployment.md)
- [Architecture and domain separation](./docs/architecture.md)
- [Supabase + Vercel checklist](./docs/supabase-vercel-checklist.md)
- [Compact `.invoice` format](./docs/invoice-format.md)
- [Tracker/invoice handoff](./docs/clock-keeper-integration.md)
