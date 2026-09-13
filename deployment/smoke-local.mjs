// Run from /app inside the API container after deployment. Only this test's
// random account and uploads are removed; existing user data is untouched.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../apps/api/dist/db/pool.js";
import { env } from "../apps/api/dist/config/env.js";
import { createEmptyInvoiceDraft } from "../packages/shared/dist/index.js";

const base = process.env.SMOKE_BASE_URL ?? "https://freelance.ansenherrick.com";
const email = `local-smoke-${randomUUID()}@example.invalid`;
const password = randomUUID();
const uploadedPaths = [];
let token;
let userId;
const request = async (route, { method = "GET", body } = {}, status = 200) => {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!multipart && body ? { "Content-Type": "application/json" } : {}) },
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, status, `${method} ${route}: HTTP ${response.status}`);
  return response.json();
};

try {
  assert.equal(env.storageBackend, "local");
  assert.equal(env.useDevData, false);
  assert.equal(new URL(env.databaseUrl).hostname, "postgres");
  const db = await pool.query("SELECT current_database() AS name, ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
  assert.equal(db.rows[0].name, "invoice_generator");
  assert.equal(db.rows[0].ssl, false);
  await request("/api/health");
  console.log("PASS: real local PostgreSQL connection and database health.");

  const registered = await request("/api/auth/register", { method: "POST", body: { email, password } }, 201);
  userId = registered.user.id;
  const loggedIn = await request("/api/auth/login", { method: "POST", body: { email, password } });
  token = loggedIn.token;
  assert.equal((await request("/api/auth/me")).user.id, userId);
  const { profile } = await request("/api/profile");
  await request("/api/profile", { method: "PUT", body: { ...profile, businessName: "Local storage smoke test" } });
  assert.equal((await request("/api/profile")).profile.businessName, "Local storage smoke test");
  const stored = await pool.query("SELECT data FROM profiles WHERE user_id = $1", [userId]);
  assert.equal(stored.rows[0].data.businessName, "Local storage smoke test");
  console.log("PASS: registration, login, and profile persistence in local PostgreSQL.");

  const draft = createEmptyInvoiceDraft();
  const created = await request("/api/invoices", { method: "POST", body: { status: "draft", sourceFormat: "manual", data: draft } }, 201);
  assert.equal((await request(`/api/invoices/${created.invoice.id}`)).invoice.id, created.invoice.id);
  const shift = await request("/api/shifts/clock-in", { method: "POST" }, 201);
  assert.equal(shift.shifts.length, 1);
  await request(`/api/shifts/${shift.shifts[0].id}/clock-out`, { method: "POST", body: { notes: "Local smoke test" } });
  console.log("PASS: invoice persistence and time-tracker clock-in/clock-out.");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  for (const kind of ["logo", "signature"]) {
    const form = new FormData();
    form.set("file", new Blob([png], { type: "image/png" }), "smoke.png");
    const uploaded = await request(`/api/profile/${kind}`, { method: "POST", body: form });
    const url = uploaded.profile[`${kind}Url`];
    const folder = kind === "logo" ? "logos" : "signatures";
    assert.ok(url.startsWith(`/uploads/${folder}/${userId}/`));
    const localPath = path.resolve(env.uploadDir, url.slice("/uploads/".length));
    assert.ok(localPath.startsWith(path.resolve(env.uploadDir) + path.sep));
    uploadedPaths.push(localPath);
    assert.deepEqual(await fs.readFile(localPath), png);
    const publicFile = await fetch(`${base}${url}`);
    assert.equal(publicFile.status, 200);
    assert.deepEqual(Buffer.from(await publicFile.arrayBuffer()), png);
  }
  console.log("PASS: logos and signatures stored on the local volume and served over HTTPS.");
} finally {
  try {
    // The generated email uniquely identifies data created by this invocation.
    await pool.query("DELETE FROM users WHERE email = $1", [email]);
    if (userId) {
      for (const folder of ["logos", "signatures"]) {
        const directory = path.resolve(env.uploadDir, folder, userId);
        // No recursive removal: only files returned by our upload requests.
        for (const file of uploadedPaths.filter(file => path.dirname(file) === directory)) await fs.unlink(file);
        await fs.rmdir(directory).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }
  } finally {
    await pool.end();
  }
}
