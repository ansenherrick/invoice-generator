import type { InvoiceDraft, InvoiceSummary } from "../types/index.js";

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateInvoiceSummary = (draft: InvoiceDraft): InvoiceSummary => {
  const subtotal = roundCurrency(
    draft.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
  );
  const discountAmount = roundCurrency(draft.discountAmount ?? 0);
  const taxAmount =
    draft.taxAmount !== undefined
      ? roundCurrency(draft.taxAmount)
      : roundCurrency(subtotal * ((draft.taxRate ?? 0) / 100));
  const total = roundCurrency(subtotal + taxAmount - discountAmount);

  return {
    subtotal,
    taxAmount,
    discountAmount,
    total,
  };
};
