import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../../");

const resolveUploadDir = () => {
  if (process.env.UPLOAD_DIR) {
    return path.resolve(repoRoot, process.env.UPLOAD_DIR);
  }

  return path.resolve(repoRoot, "uploads");
};

const storageBackend = process.env.STORAGE_BACKEND ?? "local";
if (!["local", "supabase"].includes(storageBackend)) {
  throw new Error("STORAGE_BACKEND must be local or supabase.");
}
if (storageBackend === "supabase" && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error("Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/invoice_generator?sslmode=disable",
  useDevData: process.env.USE_DEV_DATA === "true",
  jwtSecret: process.env.JWT_SECRET ?? "local-dev-secret",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  uploadDir: resolveUploadDir(),
  storageBackend,
  repoRoot,
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "invoice-assets",
};
