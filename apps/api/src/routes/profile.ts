import { Router } from "express";
import type { ProfileData } from "@invoice/shared";
import { getUserId, requireAuth } from "../middleware/auth.js";
import { profileService } from "../services/profileService.js";
import { storageService } from "../services/storageService.js";
import { logoUpload, signatureUpload } from "../utils/uploads.js";

export const profileRouter = Router();

profileRouter.use(requireAuth);

profileRouter.get("/", async (request, response) => {
  const profile = await profileService.get(getUserId(request));
  response.json({
    profile,
  });
});

profileRouter.put("/", async (request, response) => {
  const profile = await profileService.update(getUserId(request), request.body as ProfileData);
  response.json({
    profile,
  });
});

profileRouter.post("/logo", logoUpload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({
      error: "No logo file received.",
    });
    return;
  }

  const userId = getUserId(request);
  const existing = await profileService.get(userId);
  const logoUrl = await storageService.uploadProfileImage("logo", userId, request.file);
  const profile = await profileService.update(userId, {
    ...existing,
    logoUrl,
  });

  response.json({
    profile,
  });
});

profileRouter.post("/signature", signatureUpload.single("file"), async (request, response) => {
  if (!request.file) {
    response.status(400).json({
      error: "No signature file received.",
    });
    return;
  }

  const userId = getUserId(request);
  const existing = await profileService.get(userId);
  const signatureUrl = await storageService.uploadProfileImage("signature", userId, request.file);
  const profile = await profileService.update(userId, {
    ...existing,
    signatureUrl,
  });

  response.json({
    profile,
  });
});
