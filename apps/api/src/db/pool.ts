import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

const databaseHost = (() => {
  try {
    return new URL(env.databaseUrl).hostname;
  } catch {
    return "";
  }
})();

const shouldUseSsl =
  Boolean(databaseHost) &&
  !["localhost", "127.0.0.1"].includes(databaseHost) &&
  !env.useDevData;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: shouldUseSsl
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
});
