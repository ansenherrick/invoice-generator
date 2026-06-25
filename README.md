# Invoice Generator

A local-first, modular freelance invoicing app built as a single repo with:

- `apps/web`: React + Vite frontend
- `apps/api`: Express + PostgreSQL backend
- `packages/shared`: shared invoice types, totals logic, template registry, and import/export parsers

The first template is based on the attached minimalist invoice reference and is structured so additional templates can be added later without rewriting the editor or storage model.

## Included features

- Email/password account registration and login
- Per-account saved freelancer profile
- Logo upload and signature upload
- Saved primary and secondary payment methods
- Reusable saved clients with load/edit/delete support
- Draft invoice saving and re-opening
- Finalized invoice saving
- Direct PDF export from the invoice preview
- Import from `.csv`, `.json`, and compact `.invoice`
- Export to compact `.invoice` for Clock Keeper handoff
- Copy direct Clock Keeper import links
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

- User profile data is stored as JSONB in Postgres so future invoice fields and templates can evolve without an early migration burden.
- Invoice drafts and finalized invoices are also stored as JSONB, with `status`, `template_id`, and `source_format` indexed separately for flexibility.
- Uploads use a storage abstraction boundary. Locally they are written to `uploads/`, and when Supabase env vars are present they are pushed to Supabase Storage.
- The frontend imports shared parsing logic from `packages/shared`, so Clock Keeper and this app can use the same `.invoice` contract if you want.

## Supabase storage note

For logos and signatures, Supabase Storage usage is typically small if we keep files lightweight:

- logos: usually tens to a few hundred KB
- signatures: usually very small transparent PNGs

That means storage cost should stay low for this use case, especially if we add file-size limits and optionally compress uploads later.

## Suggested next build steps

1. Add richer template switching and template-specific renderers
2. Add customer-specific tax and currency defaults
3. Add signed private asset URLs if you want non-public storage
4. Add direct import session API if Clock Keeper payloads outgrow URL transfer
5. Add automated deployment checks
