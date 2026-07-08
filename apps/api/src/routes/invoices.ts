import { Router } from "express";
import type { InvoiceDraft, InvoiceStatus } from "@invoice/shared";
import { getUserId, requireAuth } from "../middleware/auth.js";
import { invoiceService } from "../services/invoiceService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const invoicesRouter = Router();

invoicesRouter.use(requireAuth);

invoicesRouter.get("/", asyncHandler(async (request, response) => {
  const invoices = await invoiceService.list(getUserId(request));
  response.json({
    invoices,
  });
}));

invoicesRouter.get("/:invoiceId", asyncHandler(async (request, response) => {
  const invoice = await invoiceService.get(String(request.params.invoiceId), getUserId(request));

  if (!invoice) {
    response.status(404).json({
      error: "Invoice not found.",
    });
    return;
  }

  response.json({
    invoice,
  });
}));

invoicesRouter.post("/", asyncHandler(async (request, response) => {
  const { status, sourceFormat, data } = request.body as {
    status: InvoiceStatus;
    sourceFormat: string;
    data: InvoiceDraft;
  };

  const invoice = await invoiceService.create(getUserId(request), {
    status,
    sourceFormat: sourceFormat ?? "manual",
    data,
  });

  response.status(201).json({
    invoice,
  });
}));

invoicesRouter.put("/:invoiceId", asyncHandler(async (request, response) => {
  const { status, sourceFormat, data } = request.body as {
    status: InvoiceStatus;
    sourceFormat: string;
    data: InvoiceDraft;
  };

  const invoice = await invoiceService.update(String(request.params.invoiceId), getUserId(request), {
    status,
    sourceFormat: sourceFormat ?? "manual",
    data,
  });

  if (!invoice) {
    response.status(404).json({
      error: "Invoice not found.",
    });
    return;
  }

  response.json({
    invoice,
  });
}));
