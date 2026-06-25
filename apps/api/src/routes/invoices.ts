import { Router } from "express";
import type { InvoiceDraft, InvoiceStatus } from "@invoice/shared";
import { getUserId, requireAuth } from "../middleware/auth.js";
import { invoiceService } from "../services/invoiceService.js";

export const invoicesRouter = Router();

invoicesRouter.use(requireAuth);

invoicesRouter.get("/", async (request, response) => {
  const invoices = await invoiceService.list(getUserId(request));
  response.json({
    invoices,
  });
});

invoicesRouter.get("/:invoiceId", async (request, response) => {
  const invoice = await invoiceService.get(request.params.invoiceId, getUserId(request));

  if (!invoice) {
    response.status(404).json({
      error: "Invoice not found.",
    });
    return;
  }

  response.json({
    invoice,
  });
});

invoicesRouter.post("/", async (request, response) => {
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
});

invoicesRouter.put("/:invoiceId", async (request, response) => {
  const { status, sourceFormat, data } = request.body as {
    status: InvoiceStatus;
    sourceFormat: string;
    data: InvoiceDraft;
  };

  const invoice = await invoiceService.update(request.params.invoiceId, getUserId(request), {
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
});
