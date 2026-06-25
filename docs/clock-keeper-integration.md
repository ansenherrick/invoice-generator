# Clock Keeper integration

The invoice app supports two integration styles with Clock Keeper.

## Option 1: direct web handoff

Best for an `Export to Invoice App` button.

1. Build the compact `.invoice` plaintext payload in Clock Keeper
2. Base64url-encode it
3. Open the invoice app with:

```text
https://your-invoice-app.vercel.app/?import=<URL_SAFE_BASE64_PAYLOAD>
```

The invoice app stores that payload locally if the user is not logged in yet, then imports it automatically after login.

## Option 2: file export

Best for a simpler first pass.

1. Export a `.invoice` file from Clock Keeper
2. Upload it in the invoice app

## Recommended Clock Keeper implementation

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
