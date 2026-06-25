import { createEmptyProfile, type ProfileData } from "@invoice/shared";
import { env } from "../config/env.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { devDataStore } from "./devDataStore.js";

export const profileService = {
  async get(userId: string) {
    if (env.useDevData) {
      const user = await devDataStore.findUserById(userId);
      return devDataStore.getProfile(userId, user?.email);
    }

    const [profile, user] = await Promise.all([
      profileRepository.findByUserId(userId),
      userRepository.findById(userId),
    ]);

    if (profile) {
      return profile.data;
    }

    const data = createEmptyProfile(user?.email ?? "");
    await profileRepository.upsert(userId, data);
    return data;
  },

  async update(userId: string, data: ProfileData) {
    if (env.useDevData) {
      return devDataStore.saveProfile(userId, data);
    }

    const updated = await profileRepository.upsert(userId, data);
    return updated.data;
  },
};
