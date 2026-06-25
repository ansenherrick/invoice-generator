import { Router } from "express";
import { invoiceTemplates } from "@invoice/shared";

export const templatesRouter = Router();

templatesRouter.get("/", (_request, response) => {
  response.json({
    templates: invoiceTemplates,
  });
});
