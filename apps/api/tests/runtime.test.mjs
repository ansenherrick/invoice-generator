import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";

process.env.DATABASE_URL = "postgresql://test:test@postgres:5432/test?sslmode=disable";
process.env.STORAGE_BACKEND = "local";
process.env.USE_DEV_DATA = "false";
const { pool } = await import("../dist/db/pool.js");
const { healthRouter } = await import("../dist/routes/health.js");

test("Docker database connections honor explicit SSL settings", async () => {
  const { default: pg } = await import("pg");
  const local = new pg.Client(pool.options);
  assert.equal(local.connectionParameters.host, "postgres");
  assert.equal(local.connectionParameters.ssl, false);
  const secure = new pg.Client({ ...pool.options, connectionString: "postgresql://test:test@db.example.com/test?sslmode=verify-full" });
  assert.ok(secure.connectionParameters.ssl);
  assert.notEqual(secure.connectionParameters.ssl.rejectUnauthorized, false);
});

test("local storage ignores leftover hosted-storage credentials", () => {
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    const { env } = await import('./dist/config/env.js');
    await import('./dist/services/storageService.js');
    if (env.storageBackend !== 'local') throw new Error('Expected local storage');
  `], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, STORAGE_BACKEND: "local", SUPABASE_URL: "invalid-old-hosted-url", SUPABASE_SERVICE_ROLE_KEY: "unused" },
    stdio: "pipe",
  });
});

test("health reports failed database connections without exposing details", async () => {
  const app = express();
  app.use("/health", healthRouter);
  const server = app.listen(0, "127.0.0.1");
  const originalQuery = pool.query;
  try {
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/health`;
    pool.query = async () => { throw new Error("private connection details"); };
    const failed = await fetch(url);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { ok: false, error: "Database unavailable." });
    pool.query = async () => ({ rows: [{ "?column?": 1 }] });
    const recovered = await fetch(url);
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), { ok: true });
  } finally {
    pool.query = originalQuery;
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
