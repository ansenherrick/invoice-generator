import { Router } from "express";
import { getUserId, requireAuth } from "../middleware/auth.js";
import { clientService } from "../services/clientService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const clientsRouter = Router();

clientsRouter.use(requireAuth);

clientsRouter.get("/", asyncHandler(async (request, response) => {
  const clients = await clientService.list(getUserId(request));
  response.json({ clients });
}));

clientsRouter.post("/", asyncHandler(async (request, response) => {
  try {
    const client = await clientService.create(getUserId(request), request.body);
    response.status(201).json({ client });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to save client.",
    });
  }
}));

clientsRouter.put("/:clientId", asyncHandler(async (request, response) => {
  try {
    const client = await clientService.update(String(request.params.clientId), getUserId(request), request.body);

    if (!client) {
      response.status(404).json({ error: "Client not found." });
      return;
    }

    response.json({ client });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Unable to update client.",
    });
  }
}));

clientsRouter.delete("/:clientId", asyncHandler(async (request, response) => {
  const removed = await clientService.remove(String(request.params.clientId), getUserId(request));

  if (!removed) {
    response.status(404).json({ error: "Client not found." });
    return;
  }

  response.status(204).send();
}));
