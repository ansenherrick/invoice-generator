# Architecture

## Deployment target

This repo is designed to run as:

- one Vercel project
- one frontend served from `apps/web`
- one API served from `apps/api` through `api/index.js`
- one Supabase project for Postgres and storage

## Domain separation

The app is intentionally split into two business domains inside the same deployment:

- invoice domain
- time-tracker domain

They share:

- `users`
- authentication
- deployment
- infrastructure environment variables

They do not share business tables.

### Invoice tables

- `profiles`
- `invoices`
- `saved_clients`

### Time-tracker tables

- `shifts`
- `shift_breaks`
- `shift_exports`

## Handoff rule

The invoice module should not build invoice drafts by directly querying time-tracker business data.

Instead, the time-tracker module exports a compact `.invoice` payload, and the invoice module imports that payload through the same parsing flow used for external imports.

That gives you:

- a hard boundary between tracker data and invoice data
- a reusable import/export contract
- fewer hidden cross-domain dependencies
- easier future extraction if one module ever needs to move

## Supabase usage

Supabase is used as shared infrastructure, not as a merged data model.

- Postgres stores both domains in separate table families
- Storage holds uploaded invoice assets such as logos and signatures
- The current app uses its own `users` table rather than Supabase Auth

## Vercel usage

Vercel hosts both modules as one app:

- static frontend output from `apps/web/dist`
- API requests rewritten to `api/index.js`

The browser sees one origin, while the server keeps invoice and tracker logic separated behind route boundaries.
