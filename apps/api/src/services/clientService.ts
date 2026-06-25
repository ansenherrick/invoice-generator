import { env } from "../config/env.js";
import { clientRepository } from "../repositories/clientRepository.js";
import { devDataStore } from "./devDataStore.js";

const normalizeLines = (lines: string[]) =>
  lines
    .map((line) => line.trim())
    .filter(Boolean);

export const clientService = {
  async list(userId: string) {
    return env.useDevData ? devDataStore.listClients(userId) : clientRepository.listByUserId(userId);
  },

  async create(
    userId: string,
    input: {
      nickname?: string;
      name: string;
      businessName?: string;
      email?: string;
      addressLines: string[];
      notes?: string;
    },
  ) {
    if (!input.name.trim()) {
      throw new Error("Client name is required.");
    }

    const payload = {
      ...input,
      name: input.name.trim(),
      nickname: input.nickname?.trim() || undefined,
      businessName: input.businessName?.trim() || undefined,
      email: input.email?.trim() || undefined,
      addressLines: normalizeLines(input.addressLines),
      notes: input.notes?.trim() || undefined,
    };

    return env.useDevData ? devDataStore.createClient(userId, payload) : clientRepository.create(userId, payload);
  },

  async update(
    clientId: string,
    userId: string,
    input: {
      nickname?: string;
      name: string;
      businessName?: string;
      email?: string;
      addressLines: string[];
      notes?: string;
    },
  ) {
    if (!input.name.trim()) {
      throw new Error("Client name is required.");
    }

    const payload = {
      ...input,
      name: input.name.trim(),
      nickname: input.nickname?.trim() || undefined,
      businessName: input.businessName?.trim() || undefined,
      email: input.email?.trim() || undefined,
      addressLines: normalizeLines(input.addressLines),
      notes: input.notes?.trim() || undefined,
    };

    return env.useDevData ? devDataStore.updateClient(clientId, userId, payload) : clientRepository.update(clientId, userId, payload);
  },

  async remove(clientId: string, userId: string) {
    return env.useDevData ? devDataStore.deleteClient(clientId, userId) : clientRepository.remove(clientId, userId);
  },
};
