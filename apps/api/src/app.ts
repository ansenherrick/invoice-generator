import fs from "node:fs";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { healthRouter } from "./routes/health.js";
import { invoicesRouter } from "./routes/invoices.js";
import { profileRouter } from "./routes/profile.js";
import { shiftsRouter } from "./routes/shifts.js";
import { templatesRouter } from "./routes/templates.js";

export const createApp = () => {
  if (!fs.existsSync(env.uploadDir)) {
    fs.mkdirSync(env.uploadDir, {
      recursive: true,
    });
  }

  const app = express();

  app.use(
    cors({
      origin: env.webOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    }),
  );
  app.use(express.json({ limit: "4mb" }));
  app.use("/uploads", express.static(env.uploadDir));

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/invoices", invoicesRouter);
  app.use("/api/shifts", shiftsRouter);

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled API error", error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error.",
    });
  });

  return app;
};
