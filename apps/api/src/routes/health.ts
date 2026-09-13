import { Router } from "express";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/", async (_request, response) => {
  try {
    if (!env.useDevData) {
      await pool.query("SELECT 1");
    }
    response.json({ ok: true });
  } catch {
    response.status(503).json({ ok: false, error: "Database unavailable." });
  }
});
