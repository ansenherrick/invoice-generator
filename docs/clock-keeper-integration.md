# Tracker To Invoice Handoff

This repo uses one handoff contract between the time-tracker module and the invoice module: compact `.invoice` import/export payloads.

That same contract can also be used by an external tracker such as the older Clock Keeper app.

## Internal app behavior

Inside this merged app, the time tracker does **not** pass raw shift records into the invoice module.

Instead it:

1. builds a compact `.invoice` payload from selected completed shifts
2. hands that payload to the invoice import flow
3. lets the invoice module parse it the same way it parses external imports

This keeps tracker data and invoice data separate even though they run in one Vercel app and one Supabase project.

## Option 1: direct web handoff

Best for an external tracker with an `Export to Invoice App` button.

1. Build the compact `.invoice` plaintext payload in Clock Keeper
2. Base64url-encode it
3. Open the invoice app with:

```text
https://your-invoice-app.vercel.app/?import=<URL_SAFE_BASE64_PAYLOAD>
```

The app stores that payload locally if the user is not logged in yet, then imports it automatically after login.

## Option 2: file export

Best for a simpler external integration.

1. Export a `.invoice` file from Clock Keeper
2. Upload it in the invoice app

## Recommended external tracker implementation

Use the same compact contract from `docs/invoice-format.md`.

### Example pseudocode

```ts
const invoiceText = [
  "INVC1",
  `inv=${invoiceNumber}`,
  `iss=${issueDate}`,
  `due=${dueDate}`,
  `cur=USD`,
  `cn=${clientName}`,
  ...items.map(
    (item) => `it=${[item.task, item.quantity, item.unitPrice, item.unitLabel ?? "hours", item.date ?? "", item.notes ?? ""].join("|")}`,
  ),
].join("\\n");

const payload = btoa(unescape(encodeURIComponent(invoiceText)))
  .replace(/\\+/g, "-")
  .replace(/\\//g, "_")
  .replace(/=+$/g, "");

window.open(`https://your-invoice-app.vercel.app/?import=${payload}`, "_blank");
```

## When to use which

- Use **direct web handoff** for the smoothest UX
- Use **file export** if your payloads may get too large for URL-based transfer
