import type { InvoiceDraft, InvoiceStatus, StoredInvoice } from "@invoice/shared";
import { pool } from "../db/pool.js";

type InvoiceRow = {
  id: string;
  user_id: string;
  status: InvoiceStatus;
  template_id: string;
  source_format: string;
  data: InvoiceDraft;
  created_at: string;
  updated_at: string;
};

const mapInvoice = (row: InvoiceRow): StoredInvoice => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  sourceFormat: row.source_format,
  templateId: row.template_id,
  data: row.data,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const invoiceRepository = {
  async create(
    userId: string,
    status: InvoiceStatus,
    templateId: string,
    sourceFormat: string,
    data: InvoiceDraft,
  ) {
    const result = await pool.query<InvoiceRow>(
      `INSERT INTO invoices (user_id, status, template_id, source_format, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, user_id, status, template_id, source_format, data, created_at, updated_at`,
      [userId, status, templateId, sourceFormat, JSON.stringify(data)],
    );

    return mapInvoice(result.rows[0]);
  },

  async update(
    invoiceId: string,
    userId: string,
    status: InvoiceStatus,
    templateId: string,
    sourceFormat: string,
    data: InvoiceDraft,
  ) {
    const result = await pool.query<InvoiceRow>(
      `UPDATE invoices
       SET status = $3,
           template_id = $4,
           source_format = $5,
           data = $6::jsonb,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, status, template_id, source_format, data, created_at, updated_at`,
      [invoiceId, userId, status, templateId, sourceFormat, JSON.stringify(data)],
    );

    return result.rows[0] ? mapInvoice(result.rows[0]) : null;
  },

  async findAllByUserId(userId: string) {
    const result = await pool.query<InvoiceRow>(
      `SELECT id, user_id, status, template_id, source_format, data, created_at, updated_at
       FROM invoices
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    );

    return result.rows.map(mapInvoice);
  },

  async findById(invoiceId: string, userId: string) {
    const result = await pool.query<InvoiceRow>(
      `SELECT id, user_id, status, template_id, source_format, data, created_at, updated_at
       FROM invoices
       WHERE id = $1 AND user_id = $2`,
      [invoiceId, userId],
    );

    return result.rows[0] ? mapInvoice(result.rows[0]) : null;
  },
};
