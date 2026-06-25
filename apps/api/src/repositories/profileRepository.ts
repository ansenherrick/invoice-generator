import type { ProfileData } from "@invoice/shared";
import { pool } from "../db/pool.js";

type ProfileRow = {
  user_id: string;
  data: ProfileData;
  created_at: string;
  updated_at: string;
};

export const profileRepository = {
  async upsert(userId: string, data: ProfileData) {
    const result = await pool.query<ProfileRow>(
      `INSERT INTO profiles (user_id, data)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING user_id, data, created_at, updated_at`,
      [userId, JSON.stringify(data)],
    );

    return result.rows[0];
  },

  async findByUserId(userId: string) {
    const result = await pool.query<ProfileRow>(
      `SELECT user_id, data, created_at, updated_at
       FROM profiles
       WHERE user_id = $1`,
      [userId],
    );

    return result.rows[0] ?? null;
  },
};
