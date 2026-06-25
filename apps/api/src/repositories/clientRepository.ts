import type { SavedClient } from "@invoice/shared";
import { pool } from "../db/pool.js";

type SavedClientRow = {
  id: string;
  user_id: string;
  nickname: string | null;
  name: string;
  business_name: string | null;
  email: string | null;
  address_lines: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const mapSavedClient = (row: SavedClientRow): SavedClient => ({
  id: row.id,
  userId: row.user_id,
  nickname: row.nickname ?? undefined,
  name: row.name,
  businessName: row.business_name ?? undefined,
  email: row.email ?? undefined,
  addressLines: row.address_lines,
  notes: row.notes ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const clientRepository = {
  async listByUserId(userId: string) {
    const result = await pool.query<SavedClientRow>(
      `SELECT id, user_id, nickname, name, business_name, email, address_lines, notes, created_at, updated_at
       FROM saved_clients
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    );

    return result.rows.map(mapSavedClient);
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
    const result = await pool.query<SavedClientRow>(
      `INSERT INTO saved_clients (user_id, nickname, name, business_name, email, address_lines, notes)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id, user_id, nickname, name, business_name, email, address_lines, notes, created_at, updated_at`,
      [
        userId,
        input.nickname ?? null,
        input.name,
        input.businessName ?? null,
        input.email ?? null,
        JSON.stringify(input.addressLines),
        input.notes ?? null,
      ],
    );

    return mapSavedClient(result.rows[0]);
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
    const result = await pool.query<SavedClientRow>(
      `UPDATE saved_clients
       SET nickname = $3,
           name = $4,
           business_name = $5,
           email = $6,
           address_lines = $7::jsonb,
           notes = $8,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, nickname, name, business_name, email, address_lines, notes, created_at, updated_at`,
      [
        clientId,
        userId,
        input.nickname ?? null,
        input.name,
        input.businessName ?? null,
        input.email ?? null,
        JSON.stringify(input.addressLines),
        input.notes ?? null,
      ],
    );

    return result.rows[0] ? mapSavedClient(result.rows[0]) : null;
  },

  async remove(clientId: string, userId: string) {
    const result = await pool.query<{ id: string }>(
      `DELETE FROM saved_clients
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [clientId, userId],
    );

    return Boolean(result.rows[0]);
  },
};
