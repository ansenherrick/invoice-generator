# `.invoice` format

This repo includes a compact plaintext export format intended for Clock Keeper and other lightweight integrations.

## Version header

The first line is always:

```text
INVC1
```

## Key/value rows

Each following line is `key=value`.

### Invoice-level fields

```text
inv=INV-2026-06-23
iss=2026-06-23
due=2026-06-30
cur=USD
prj=Website Refresh
cn=Acme Client
cb=Acme LLC
ce=team@acme.com
ca=123 Main St;Suite 200
txr=0
txa=
dsc=0
nts=Thanks for your business
```

### Item rows

Each item row uses:

```text
it=task|quantity|unitPrice|unitLabel|date|notes
```

Example:

```text
it=Homepage UX updates|3|85|hours|2026-06-22|Clock Keeper export
```

## Why this format

- small and easy to generate
- readable in a text editor
- easy to parse without heavy dependencies
- flexible enough for Clock Keeper exports

## Recommended Clock Keeper export contract

At minimum, Clock Keeper should populate:

- `inv`
- `iss`
- `due`
- `cur`
- `cn`
- one or more `it=` rows

If Clock Keeper only knows task-level data, that is still enough for this app to import and finish the invoice manually.
