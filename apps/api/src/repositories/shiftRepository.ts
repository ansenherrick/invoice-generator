import type { ShiftBreak, ShiftExportFormat, ShiftExportRecord, ShiftExportType, ShiftRecord } from "@invoice/shared";
import { pool } from "../db/pool.js";

type ShiftRow = {
  id: string;
  user_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  notes: string;
  created_at: string;
};

type ShiftBreakRow = {
  id: string;
  shift_id: string;
  type: string;
  start_at: string;
  end_at: string | null;
};

type ShiftExportRow = {
  id: string;
  shift_id: string;
  batch_id: string;
  exported_at: string;
  type: ShiftExportType;
  format: ShiftExportFormat;
};

const mapShiftBreak = (row: ShiftBreakRow): ShiftBreak => ({
  id: row.id,
  type: row.type,
  startAt: row.start_at,
  endAt: row.end_at,
});

const mapShiftExport = (row: ShiftExportRow): ShiftExportRecord => ({
  id: row.id,
  batchId: row.batch_id,
  exportedAt: row.exported_at,
  type: row.type,
  format: row.format,
});

const hydrateShifts = async (shiftRows: ShiftRow[]): Promise<ShiftRecord[]> => {
  if (!shiftRows.length) {
    return [];
  }

  const shiftIds = shiftRows.map((row) => row.id);
  const [breakResult, exportResult] = await Promise.all([
    pool.query<ShiftBreakRow>(
      `SELECT id, shift_id, type, start_at, end_at
       FROM shift_breaks
       WHERE shift_id = ANY($1::uuid[])
       ORDER BY start_at ASC`,
      [shiftIds],
    ),
    pool.query<ShiftExportRow>(
      `SELECT id, shift_id, batch_id, exported_at, type, format
       FROM shift_exports
       WHERE shift_id = ANY($1::uuid[])
       ORDER BY exported_at ASC, id ASC`,
      [shiftIds],
    ),
  ]);

  const breaksByShift = new Map<string, ShiftBreak[]>();
  for (const entry of breakResult.rows) {
    if (!breaksByShift.has(entry.shift_id)) {
      breaksByShift.set(entry.shift_id, []);
    }

    breaksByShift.get(entry.shift_id)?.push(mapShiftBreak(entry));
  }

  const exportsByShift = new Map<string, ShiftExportRecord[]>();
  for (const entry of exportResult.rows) {
    if (!exportsByShift.has(entry.shift_id)) {
      exportsByShift.set(entry.shift_id, []);
    }

    exportsByShift.get(entry.shift_id)?.push(mapShiftExport(entry));
  }

  return shiftRows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    notes: row.notes,
    createdAt: row.created_at,
    breaks: breaksByShift.get(row.id) || [],
    exports: exportsByShift.get(row.id) || [],
  }));
};

const findShiftRows = async (sql: string, values: unknown[]) => {
  const result = await pool.query<ShiftRow>(sql, values);
  return hydrateShifts(result.rows);
};

export const shiftRepository = {
  async listByUserId(userId: string) {
    return findShiftRows(
      `SELECT id, user_id, clock_in_at, clock_out_at, notes, created_at
       FROM shifts
       WHERE user_id = $1
       ORDER BY clock_in_at DESC`,
      [userId],
    );
  },

  async findById(userId: string, shiftId: string) {
    const shifts = await findShiftRows(
      `SELECT id, user_id, clock_in_at, clock_out_at, notes, created_at
       FROM shifts
       WHERE user_id = $1 AND id = $2`,
      [userId, shiftId],
    );
    return shifts[0] ?? null;
  },

  async findActiveByUserId(userId: string) {
    const shifts = await findShiftRows(
      `SELECT id, user_id, clock_in_at, clock_out_at, notes, created_at
       FROM shifts
       WHERE user_id = $1 AND clock_out_at IS NULL
       ORDER BY clock_in_at DESC
       LIMIT 1`,
      [userId],
    );
    return shifts[0] ?? null;
  },

  async createClockInShift(userId: string) {
    const result = await pool.query<ShiftRow>(
      `INSERT INTO shifts (user_id, clock_in_at, notes)
       VALUES ($1, NOW(), '')
       RETURNING id, user_id, clock_in_at, clock_out_at, notes, created_at`,
      [userId],
    );

    const shifts = await hydrateShifts(result.rows);
    return shifts[0];
  },

  async createManualShift(userId: string, input: { startAt: string; endAt: string; breakMinutes: number; notes: string }) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const shiftResult = await client.query<ShiftRow>(
        `INSERT INTO shifts (user_id, clock_in_at, clock_out_at, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, clock_in_at, clock_out_at, notes, created_at`,
        [userId, input.startAt, input.endAt, input.notes],
      );

      const shift = shiftResult.rows[0];
      if (input.breakMinutes > 0) {
        const breakEnd = new Date(input.endAt);
        const breakStart = new Date(breakEnd.getTime() - input.breakMinutes * 60000);

        await client.query(
          `INSERT INTO shift_breaks (shift_id, type, start_at, end_at)
           VALUES ($1, $2, $3, $4)`,
          [shift.id, "Manual Break", breakStart.toISOString(), breakEnd.toISOString()],
        );
      }

      await client.query("COMMIT");
      const hydrated = await hydrateShifts([shift]);
      return hydrated[0];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async clockOutShift(userId: string, shiftId: string, notes: string) {
    await pool.query(
      `UPDATE shift_breaks
       SET end_at = NOW()
       WHERE shift_id = $1
         AND end_at IS NULL`,
      [shiftId],
    );

    const result = await pool.query<ShiftRow>(
      `UPDATE shifts
       SET clock_out_at = NOW(),
           notes = $3
       WHERE id = $1 AND user_id = $2 AND clock_out_at IS NULL
       RETURNING id, user_id, clock_in_at, clock_out_at, notes, created_at`,
      [shiftId, userId, notes],
    );

    const hydrated = await hydrateShifts(result.rows);
    return hydrated[0] ?? null;
  },

  async startBreak(shiftId: string, type: string) {
    const result = await pool.query<ShiftBreakRow>(
      `INSERT INTO shift_breaks (shift_id, type, start_at)
       VALUES ($1, $2, NOW())
       RETURNING id, shift_id, type, start_at, end_at`,
      [shiftId, type],
    );

    return mapShiftBreak(result.rows[0]);
  },

  async findOpenBreak(shiftId: string) {
    const result = await pool.query<ShiftBreakRow>(
      `SELECT id, shift_id, type, start_at, end_at
       FROM shift_breaks
       WHERE shift_id = $1 AND end_at IS NULL
       ORDER BY start_at DESC
       LIMIT 1`,
      [shiftId],
    );

    return result.rows[0] ? mapShiftBreak(result.rows[0]) : null;
  },

  async endBreak(shiftId: string, breakId: string) {
    const result = await pool.query<ShiftBreakRow>(
      `UPDATE shift_breaks
       SET end_at = NOW()
       WHERE id = $1 AND shift_id = $2 AND end_at IS NULL
       RETURNING id, shift_id, type, start_at, end_at`,
      [breakId, shiftId],
    );

    return result.rows[0] ? mapShiftBreak(result.rows[0]) : null;
  },

  async updateNotes(userId: string, shiftId: string, notes: string) {
    const result = await pool.query<ShiftRow>(
      `UPDATE shifts
       SET notes = $3
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, clock_in_at, clock_out_at, notes, created_at`,
      [shiftId, userId, notes],
    );

    const hydrated = await hydrateShifts(result.rows);
    return hydrated[0] ?? null;
  },

  async findCompletedByIds(userId: string, shiftIds: string[]) {
    return findShiftRows(
      `SELECT id, user_id, clock_in_at, clock_out_at, notes, created_at
       FROM shifts
       WHERE user_id = $1
         AND clock_out_at IS NOT NULL
         AND id = ANY($2::uuid[])
       ORDER BY clock_in_at DESC`,
      [userId, shiftIds],
    );
  },

  async recordExports(
    shiftIds: string[],
    metadata: { batchId: string; exportedAt: string; type: ShiftExportType; format: ShiftExportFormat },
  ) {
    if (!shiftIds.length) {
      return;
    }

    const values = shiftIds.map(
      (_shiftId, index) => `($${index * 5 + 1}, $${index * 5 + 2}, $${index * 5 + 3}, $${index * 5 + 4}, $${index * 5 + 5})`,
    );
    const params = shiftIds.flatMap((shiftId) => [shiftId, metadata.batchId, metadata.exportedAt, metadata.type, metadata.format]);

    await pool.query(
      `INSERT INTO shift_exports (shift_id, batch_id, exported_at, type, format)
       VALUES ${values.join(", ")}`,
      params,
    );
  },
};
