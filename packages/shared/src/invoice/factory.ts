import type { InvoiceDraft, ProfileData } from "../types/index.js";

export const createEmptyProfile = (email = ""): ProfileData => ({
  displayName: "",
  businessName: "",
  email,
  addressLines: [],
  paymentPrimary: {
    label: "Preferred Payment",
    details: [],
  },
  paymentSecondary: {
    label: "Secondary Payment",
    details: [],
  },
});

export const createEmptyInvoiceDraft = (): InvoiceDraft => ({
  invoiceNumber: `INV-${new Date().toISOString().slice(0, 10)}`,
  issueDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date().toISOString().slice(0, 10),
  currency: "USD",
  projectName: "",
  client: {
    name: "",
    businessName: "",
    email: "",
    addressLines: [],
  },
  items: [
    {
      id: crypto.randomUUID(),
      task: "",
      description: "",
      quantity: 1,
      unitPrice: 0,
      unitLabel: "qty",
      date: "",
      notes: "",
    },
  ],
  notes: "",
  taxRate: 0,
  discountAmount: 0,
  templateId: "modern-minimal",
});
