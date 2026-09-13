import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
  // Let pg honor explicit SSL settings in DATABASE_URL (for example,
  // sslmode=disable on the internal Docker network). Hostnames do not imply TLS.
  connectionString: env.databaseUrl,
  connectionTimeoutMillis: 3000,
});
