import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

type UploadKind = "logo" | "signature";

const cleanFileName = (fileName: string) =>
  fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");

const supabaseAdmin =
  env.supabaseUrl && env.supabaseServiceRoleKey
    ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

const writeLocalFile = async (kind: UploadKind, userId: string, file: Express.Multer.File) => {
  const folder = kind === "logo" ? "logos" : "signatures";
  const destination = path.resolve(env.uploadDir, folder, userId);
  await fs.mkdir(destination, { recursive: true });
  const fileName = `${Date.now()}-${cleanFileName(file.originalname)}`;
  await fs.writeFile(path.join(destination, fileName), file.buffer);
  return `/uploads/${folder}/${userId}/${fileName}`;
};

const uploadToSupabase = async (kind: UploadKind, userId: string, file: Express.Multer.File) => {
  if (!supabaseAdmin) {
    throw new Error("Supabase storage is not configured.");
  }

  const folder = kind === "logo" ? "logos" : "signatures";
  const fileName = `${Date.now()}-${cleanFileName(file.originalname)}`;
  const storagePath = `${folder}/${userId}/${fileName}`;
  const { error } = await supabaseAdmin.storage.from(env.supabaseStorageBucket).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabaseAdmin.storage.from(env.supabaseStorageBucket).getPublicUrl(storagePath);
  return data.publicUrl;
};

export const storageService = {
  async uploadProfileImage(kind: UploadKind, userId: string, file: Express.Multer.File) {
    if (env.supabaseUrl && env.supabaseServiceRoleKey) {
      return uploadToSupabase(kind, userId, file);
    }

    return writeLocalFile(kind, userId, file);
  },
};
