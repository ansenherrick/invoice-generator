import { calculateInvoiceSummary, type InvoiceDraft, type InvoiceStatus } from "@invoice/shared";
import { env } from "../config/env.js";
import { invoiceRepository } from "../repositories/invoiceRepository.js";
import { devDataStore } from "./devDataStore.js";

const normalizeNumericFields = (draft: InvoiceDraft): InvoiceDraft => ({
  ...draft,
  items: draft.items.map((item) => ({
    ...item,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
  })),
  taxRate: draft.taxRate !== undefined ? Number(draft.taxRate) : undefined,
  taxAmount: draft.taxAmount !== undefined ? Number(draft.taxAmount) : undefined,
  discountAmount: draft.discountAmount !== undefined ? Number(draft.discountAmount) : undefined,
});

const ensureComputedSummary = (draft: InvoiceDraft) => {
  const normalizedDraft = normalizeNumericFields(draft);
  const summary = calculateInvoiceSummary(normalizedDraft);

  return {
    ...normalizedDraft,
    taxAmount: summary.taxAmount,
    discountAmount: summary.discountAmount,
  };
};

export const invoiceService = {
  async list(userId: string) {
    return env.useDevData ? devDataStore.listInvoices(userId) : invoiceRepository.findAllByUserId(userId);
  },

  async get(invoiceId: string, userId: string) {
    return env.useDevData ? devDataStore.getInvoice(invoiceId, userId) : invoiceRepository.findById(invoiceId, userId);
  },

  async create(userId: string, payload: { status: InvoiceStatus; sourceFormat: string; data: InvoiceDraft }) {
    const data = ensureComputedSummary(payload.data);
    return env.useDevData
      ? devDataStore.createInvoice(userId, payload.status, payload.sourceFormat, data)
      : invoiceRepository.create(userId, payload.status, data.templateId, payload.sourceFormat, data);
  },

  async update(
    invoiceId: string,
    userId: string,
    payload: { status: InvoiceStatus; sourceFormat: string; data: InvoiceDraft },
  ) {
    const data = ensureComputedSummary(payload.data);
    return env.useDevData
      ? devDataStore.updateInvoice(invoiceId, userId, payload.status, payload.sourceFormat, data)
      : invoiceRepository.update(invoiceId, userId, payload.status, data.templateId, payload.sourceFormat, data);
  },
};
