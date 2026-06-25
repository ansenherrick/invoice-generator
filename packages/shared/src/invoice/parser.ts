import { createEmptyInvoiceDraft } from "./factory.js";
import type { InvoiceDraft, InvoiceItem } from "../types/index.js";

const splitCsvLine = (line: string) => {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
};

const normalizeRowItem = (row: Record<string, string>, index: number): InvoiceItem => ({
  id: crypto.randomUUID(),
  task: row.task || row.description || `Item ${index + 1}`,
  description: row.description || "",
  quantity: Number(row.quantity || row.qty || 1),
  unitPrice: Number(row.unitPrice || row.payRate || row.rate || 0),
  unitLabel: row.unitLabel || row.unit || "qty",
  date: row.date || "",
  notes: row.notes || "",
});

const parseCsvInvoice = (input: string): InvoiceDraft => {
  const rows = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length < 2) {
    throw new Error("CSV imports need a header row and at least one item row.");
  }

  const headers = splitCsvLine(rows[0]).map((header) => header.trim());
  const draft = createEmptyInvoiceDraft();
  const parsedRows = rows.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = values[index] ?? "";
      return record;
    }, {});
  });

  const firstRow = parsedRows[0];
  draft.invoiceNumber = firstRow.invoiceNumber || draft.invoiceNumber;
  draft.issueDate = firstRow.issueDate || draft.issueDate;
  draft.dueDate = firstRow.dueDate || draft.dueDate;
  draft.currency = firstRow.currency || draft.currency;
  draft.projectName = firstRow.projectName || "";
  draft.client = {
    name: firstRow.clientName || "",
    businessName: firstRow.clientBusinessName || "",
    email: firstRow.clientEmail || "",
    addressLines: firstRow.clientAddress ? firstRow.clientAddress.split(";").map((line) => line.trim()) : [],
  };
  draft.notes = firstRow.invoiceNotes || "";
  draft.taxRate = Number(firstRow.taxRate || 0);
  draft.taxAmount = firstRow.taxAmount ? Number(firstRow.taxAmount) : undefined;
  draft.discountAmount = Number(firstRow.discountAmount || 0);
  draft.items = parsedRows.map(normalizeRowItem);

  return draft;
};

const parseJsonInvoice = (input: string): InvoiceDraft => {
  const parsed = JSON.parse(input) as Partial<InvoiceDraft>;
  const draft = createEmptyInvoiceDraft();

  return {
    ...draft,
    ...parsed,
    client: {
      ...draft.client,
      ...(parsed.client ?? {}),
      addressLines: parsed.client?.addressLines ?? draft.client.addressLines,
    },
    items:
      parsed.items?.map((item, index) => ({
        id: item.id ?? crypto.randomUUID(),
        task: item.task ?? `Item ${index + 1}`,
        description: item.description ?? "",
        quantity: Number(item.quantity ?? 1),
        unitPrice: Number(item.unitPrice ?? 0),
        unitLabel: item.unitLabel ?? "qty",
        date: item.date ?? "",
        notes: item.notes ?? "",
      })) ?? draft.items,
  };
};

const invoiceKeyMap: Record<string, keyof InvoiceDraft | "clientName" | "clientBusinessName" | "clientEmail" | "clientAddress" | "item"> = {
  inv: "invoiceNumber",
  iss: "issueDate",
  due: "dueDate",
  cur: "currency",
  prj: "projectName",
  nts: "notes",
  txr: "taxRate",
  txa: "taxAmount",
  dsc: "discountAmount",
  cn: "clientName",
  cb: "clientBusinessName",
  ce: "clientEmail",
  ca: "clientAddress",
  it: "item",
};

const parseCompactInvoice = (input: string): InvoiceDraft => {
  const draft = createEmptyInvoiceDraft();
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines[0] !== "INVC1") {
    throw new Error("Unsupported .invoice version. Expected INVC1.");
  }

  draft.items = [];

  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const rawKey = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const mappedKey = invoiceKeyMap[rawKey];

    if (!mappedKey) {
      continue;
    }

    if (mappedKey === "clientName") {
      draft.client.name = rawValue;
      continue;
    }

    if (mappedKey === "clientBusinessName") {
      draft.client.businessName = rawValue;
      continue;
    }

    if (mappedKey === "clientEmail") {
      draft.client.email = rawValue;
      continue;
    }

    if (mappedKey === "clientAddress") {
      draft.client.addressLines = rawValue ? rawValue.split(";").map((entry) => entry.trim()) : [];
      continue;
    }

    if (mappedKey === "item") {
      const [task, quantity, unitPrice, unitLabel, date, notes] = rawValue.split("|");
      draft.items.push({
        id: crypto.randomUUID(),
        task: task || "Task",
        quantity: Number(quantity || 1),
        unitPrice: Number(unitPrice || 0),
        unitLabel: unitLabel || "qty",
        date: date || "",
        notes: notes || "",
      });
      continue;
    }

    if (mappedKey === "taxRate" || mappedKey === "taxAmount" || mappedKey === "discountAmount") {
      (draft[mappedKey] as number | undefined) = rawValue ? Number(rawValue) : undefined;
      continue;
    }

    (draft[mappedKey] as string | undefined) = rawValue;
  }

  if (draft.items.length === 0) {
    draft.items = createEmptyInvoiceDraft().items;
  }

  return draft;
};

export const parseInvoiceFile = (fileName: string, input: string): InvoiceDraft => {
  const normalizedName = fileName.toLowerCase();

  if (normalizedName.endsWith(".json")) {
    return parseJsonInvoice(input);
  }

  if (normalizedName.endsWith(".csv")) {
    return parseCsvInvoice(input);
  }

  if (normalizedName.endsWith(".invoice")) {
    return parseCompactInvoice(input);
  }

  throw new Error("Unsupported file type. Use CSV, JSON, or .invoice.");
};

export const exportCompactInvoice = (draft: InvoiceDraft) => {
  const lines = [
    "INVC1",
    `inv=${draft.invoiceNumber}`,
    `iss=${draft.issueDate}`,
    `due=${draft.dueDate}`,
    `cur=${draft.currency}`,
    `prj=${draft.projectName ?? ""}`,
    `cn=${draft.client.name}`,
    `cb=${draft.client.businessName ?? ""}`,
    `ce=${draft.client.email ?? ""}`,
    `ca=${draft.client.addressLines.join(";")}`,
    `txr=${draft.taxRate ?? 0}`,
    `txa=${draft.taxAmount ?? ""}`,
    `dsc=${draft.discountAmount ?? 0}`,
    `nts=${draft.notes ?? ""}`,
    ...draft.items.map(
      (item) =>
        `it=${[item.task, item.quantity, item.unitPrice, item.unitLabel ?? "", item.date ?? "", item.notes ?? ""].join("|")}`,
    ),
  ];

  return `${lines.join("\n")}\n`;
};

const encodeBase64Url = (value: string) => {
  if (typeof window !== "undefined") {
    return btoa(unescape(encodeURIComponent(value)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  const nodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: {
      from: (input: string, encoding: string) => { toString: (encoding: string) => string };
    };
  }).Buffer;

  if (!nodeBuffer) {
    throw new Error("Base64 encoding is unavailable in this runtime.");
  }

  return nodeBuffer.from(value, "utf8").toString("base64url");
};

const decodeBase64Url = (value: string) => {
  if (typeof window !== "undefined") {
    const normalizedPayload = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalizedPayload.length % 4 === 0 ? "" : "=".repeat(4 - (normalizedPayload.length % 4));
    return decodeURIComponent(escape(atob(`${normalizedPayload}${padding}`)));
  }

  const nodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: {
      from: (input: string, encoding: string) => { toString: (encoding: string) => string };
    };
  }).Buffer;

  if (!nodeBuffer) {
    throw new Error("Base64 decoding is unavailable in this runtime.");
  }

  return nodeBuffer.from(value, "base64url").toString("utf8");
};

export const encodeInvoicePayload = (draft: InvoiceDraft) => encodeBase64Url(exportCompactInvoice(draft));

export const decodeInvoicePayload = (payload: string) => parseInvoiceFile("clock-keeper.invoice", decodeBase64Url(payload));
