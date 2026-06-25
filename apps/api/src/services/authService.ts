import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createEmptyProfile } from "@invoice/shared";
import { env } from "../config/env.js";
import { profileRepository } from "../repositories/profileRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { devDataStore } from "./devDataStore.js";

const signToken = (userId: string) =>
  jwt.sign(
    {
      sub: userId,
    },
    env.jwtSecret,
    {
      expiresIn: "7d",
    },
  );

export const authService = {
  async register(email: string, password: string) {
    const existing = env.useDevData ? await devDataStore.findUserByEmail(email) : await userRepository.findByEmail(email);
    if (existing) {
      throw new Error("An account with that email already exists.");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = env.useDevData
      ? await devDataStore.createUser(email, passwordHash)
      : await userRepository.create(email, passwordHash);

    if (env.useDevData) {
      await devDataStore.saveProfile(user.id, createEmptyProfile(email));
    } else {
      await profileRepository.upsert(user.id, createEmptyProfile(email));
    }

    return {
      token: signToken(user.id),
      user: {
        id: user.id,
        email: user.email,
      },
    };
  },

  async login(email: string, password: string) {
    const user = env.useDevData ? await devDataStore.findUserByEmail(email) : await userRepository.findByEmail(email);
    if (!user) {
      throw new Error("Invalid email or password.");
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new Error("Invalid email or password.");
    }

    return {
      token: signToken(user.id),
      user: {
        id: user.id,
        email: user.email,
      },
    };
  },

  verifyToken(token: string) {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    return payload.sub;
  },

  async getUserById(userId: string) {
    return env.useDevData ? devDataStore.findUserById(userId) : userRepository.findById(userId);
  },
};
