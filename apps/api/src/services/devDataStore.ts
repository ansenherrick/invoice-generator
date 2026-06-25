import fs from "node:fs/promises";
import path from "node:path";
import { createEmptyProfile, type InvoiceDraft, type InvoiceStatus, type ProfileData, type SavedClient, type StoredInvoice } from "@invoice/shared";
import { env } from "../config/env.js";

type DevUser = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

type DevState = {
  users: DevUser[];
  profiles: Record<string, ProfileData>;
  invoices: StoredInvoice[];
  clients: SavedClient[];
};

const devDataPath = path.resolve(env.repoRoot, "apps/api/dev-data.json");

const createEmptyState = (): DevState => ({
  users: [],
  profiles: {},
  invoices: [],
  clients: [],
});

const ensureStateFile = async () => {
  try {
    await fs.access(devDataPath);
  } catch {
    await fs.writeFile(devDataPath, JSON.stringify(createEmptyState(), null, 2));
  }
};

const readState = async () => {
  await ensureStateFile();
  const content = await fs.readFile(devDataPath, "utf8");
  return JSON.parse(content) as DevState;
};

const writeState = async (state: DevState) => {
  await fs.writeFile(devDataPath, JSON.stringify(state, null, 2));
};

const sortNewest = <T extends { updatedAt: string }>(entries: T[]) =>
  [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const devDataStore = {
  path: devDataPath,

  async createUser(email: string, passwordHash: string) {
    const state = await readState();
    const createdAt = new Date().toISOString();
    const user: DevUser = {
      id: crypto.randomUUID(),
      email,
      passwordHash,
      createdAt,
    };

    state.users.push(user);
    state.profiles[user.id] = createEmptyProfile(email);
    await writeState(state);
    return user;
  },

  async findUserByEmail(email: string) {
    const state = await readState();
    return state.users.find((user) => user.email === email) ?? null;
  },

  async findUserById(userId: string) {
    const state = await readState();
    return state.users.find((user) => user.id === userId) ?? null;
  },

  async getProfile(userId: string, email?: string) {
    const state = await readState();
    const existing = state.profiles[userId];
    if (existing) {
      return existing;
    }

    const profile = createEmptyProfile(email ?? "");
    state.profiles[userId] = profile;
    await writeState(state);
    return profile;
  },

  async saveProfile(userId: string, profile: ProfileData) {
    const state = await readState();
    state.profiles[userId] = profile;
    await writeState(state);
    return profile;
  },

  async listInvoices(userId: string) {
    const state = await readState();
    return sortNewest(state.invoices.filter((invoice) => invoice.userId === userId));
  },

  async getInvoice(invoiceId: string, userId: string) {
    const state = await readState();
    return state.invoices.find((invoice) => invoice.id === invoiceId && invoice.userId === userId) ?? null;
  },

  async createInvoice(userId: string, status: InvoiceStatus, sourceFormat: string, data: InvoiceDraft) {
    const state = await readState();
    const timestamp = new Date().toISOString();
    const invoice: StoredInvoice = {
      id: crypto.randomUUID(),
      userId,
      status,
      sourceFormat,
      templateId: data.templateId,
      data,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    state.invoices.unshift(invoice);
    await writeState(state);
    return invoice;
  },

  async updateInvoice(invoiceId: string, userId: string, status: InvoiceStatus, sourceFormat: string, data: InvoiceDraft) {
    const state = await readState();
    const invoiceIndex = state.invoices.findIndex((invoice) => invoice.id === invoiceId && invoice.userId === userId);
    if (invoiceIndex === -1) {
      return null;
    }

    const current = state.invoices[invoiceIndex];
    const updated: StoredInvoice = {
      ...current,
      status,
      sourceFormat,
      templateId: data.templateId,
      data,
      updatedAt: new Date().toISOString(),
    };

    state.invoices[invoiceIndex] = updated;
    await writeState(state);
    return updated;
  },

  async listClients(userId: string) {
    const state = await readState();
    return sortNewest(state.clients.filter((client) => client.userId === userId));
  },

  async createClient(
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
    const state = await readState();
    const timestamp = new Date().toISOString();
    const client: SavedClient = {
      id: crypto.randomUUID(),
      userId,
      nickname: input.nickname,
      name: input.name,
      businessName: input.businessName,
      email: input.email,
      addressLines: input.addressLines,
      notes: input.notes,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    state.clients.unshift(client);
    await writeState(state);
    return client;
  },

  async updateClient(
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
    const state = await readState();
    const clientIndex = state.clients.findIndex((client) => client.id === clientId && client.userId === userId);
    if (clientIndex === -1) {
      return null;
    }

    const current = state.clients[clientIndex];
    const updated: SavedClient = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    state.clients[clientIndex] = updated;
    await writeState(state);
    return updated;
  },

  async deleteClient(clientId: string, userId: string) {
    const state = await readState();
    const nextClients = state.clients.filter((client) => !(client.id === clientId && client.userId === userId));
    const removed = nextClients.length !== state.clients.length;
    if (!removed) {
      return false;
    }

    state.clients = nextClients;
    await writeState(state);
    return true;
  },
};
