import { pool } from "../db/pool.js";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

const mapUserRecord = (row: {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

export const userRepository = {
  async create(email: string, passwordHash: string) {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, password_hash, created_at`,
      [email, passwordHash],
    );

    return mapUserRecord(result.rows[0]);
  },

  async findByEmail(email: string) {
    const result = await pool.query(
      `SELECT id, email, password_hash, created_at
       FROM users
       WHERE email = $1`,
      [email],
    );

    return result.rows[0] ? mapUserRecord(result.rows[0]) : null;
  },

  async findById(id: string) {
    const result = await pool.query(
      `SELECT id, email, password_hash, created_at
       FROM users
       WHERE id = $1`,
      [id],
    );

    return result.rows[0] ? mapUserRecord(result.rows[0]) : null;
  },
};
