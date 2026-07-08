import type {
  InvoiceDraft,
  ShiftExportFormat,
  ShiftExportType,
  ShiftInvoiceOptions,
  ShiftRecord,
  ShiftStatus,
} from "./types/index.js";
import { createEmptyInvoiceDraft } from "./invoice/factory.js";

export const calculateBreakMinutes = (shift: ShiftRecord) =>
  shift.breaks.reduce((total, entry) => {
    const start = new Date(entry.startAt);
    const end = new Date(entry.endAt || Date.now());
    return total + Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }, 0);

export const calculateShiftWorkedMinutes = (shift: ShiftRecord) => {
  const start = new Date(shift.clockInAt);
  const end = new Date(shift.clockOutAt || Date.now());
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return Math.max(0, totalMinutes - calculateBreakMinutes(shift));
};

export const getShiftStatus = (shift: ShiftRecord): ShiftStatus => {
  if (shift.clockOutAt) {
    return "completed";
  }

  return shift.breaks.some((entry) => !entry.endAt) ? "on-break" : "clocked-in";
};

export const buildInvoiceDraftFromShifts = (shifts: ShiftRecord[], invoiceOptions: ShiftInvoiceOptions = {}): InvoiceDraft => {
  const exportedAt = new Date().toISOString();
  const issueDate = invoiceOptions.issuedOn || formatDateOnly(exportedAt);
  const draft = createEmptyInvoiceDraft();

  draft.invoiceNumber = invoiceOptions.invoiceNumber || buildInvoiceNumber(issueDate);
  draft.issueDate = issueDate;
  draft.dueDate = invoiceOptions.dueOn || addDays(issueDate, Number(invoiceOptions.dueInDays || 7));
  draft.currency = invoiceOptions.currency || "USD";
  draft.projectName = invoiceOptions.projectName || "";
  draft.client = {
    name: invoiceOptions.clientName || "",
    businessName: invoiceOptions.clientBusiness || "",
    email: invoiceOptions.clientEmail || "",
    addressLines: invoiceOptions.clientAddress
      ? invoiceOptions.clientAddress.split(";").map((line) => line.trim()).filter(Boolean)
      : [],
  };
  draft.notes = invoiceOptions.notes || "Generated from tracked shifts";
  draft.items = shifts.map((shift, index) => ({
    id: crypto.randomUUID(),
    task: shift.notes || invoiceOptions.projectName || `Shift on ${formatDateOnly(shift.clockInAt)}`,
    description: shift.notes || "",
    quantity: Number((calculateShiftWorkedMinutes(shift) / 60).toFixed(2)),
    unitPrice: normalizeMoney(invoiceOptions.hourlyRate),
    unitLabel: invoiceOptions.unitLabel || "hours",
    date: formatDateOnly(shift.clockInAt),
    notes: shift.notes || `Tracked shift ${index + 1}`,
  }));

  if (draft.items.length === 0) {
    draft.items = createEmptyInvoiceDraft().items;
  }

  return draft;
};

export const buildShiftInvoiceText = (
  shifts: ShiftRecord[],
  accountLabel: string,
  exportedAt: string,
  invoiceOptions: ShiftInvoiceOptions = {},
) => {
  const draft = buildInvoiceDraftFromShifts(shifts, {
    ...invoiceOptions,
    clientName: invoiceOptions.clientName || accountLabel,
    issuedOn: invoiceOptions.issuedOn || formatDateOnly(exportedAt),
  });

  const lines = [
    "INVC1",
    `inv=${escapeInvoiceValue(draft.invoiceNumber)}`,
    `iss=${escapeInvoiceValue(draft.issueDate)}`,
    `due=${escapeInvoiceValue(draft.dueDate)}`,
    `cur=${escapeInvoiceValue(draft.currency)}`,
    `prj=${escapeInvoiceValue(draft.projectName ?? "")}`,
    `cn=${escapeInvoiceValue(draft.client.name)}`,
    `cb=${escapeInvoiceValue(draft.client.businessName ?? "")}`,
    `ce=${escapeInvoiceValue(draft.client.email ?? "")}`,
    `ca=${escapeInvoiceValue(draft.client.addressLines.join(";"))}`,
    `txr=${draft.taxRate ?? 0}`,
    `txa=${draft.taxAmount ?? ""}`,
    `dsc=${draft.discountAmount ?? 0}`,
    `nts=${escapeInvoiceValue(draft.notes ?? "")}`,
    ...draft.items.map(
      (item) =>
        `it=${[
          escapeInvoiceValue(item.task),
          item.quantity,
          item.unitPrice,
          escapeInvoiceValue(item.unitLabel ?? ""),
          item.date ?? "",
          escapeInvoiceValue(item.notes ?? ""),
        ].join("|")}`,
    ),
  ];

  return lines.join("\n");
};

export const buildShiftCsv = (
  shifts: ShiftRecord[],
  accountLabel: string,
  accountEmail: string,
  exportedAt: string,
  exportType: ShiftExportType,
) => {
  const headers = [
    "shift_id",
    "employee_name",
    "account_email",
    "shift_date",
    "clock_in_date",
    "clock_in_time",
    "clock_out_date",
    "clock_out_time",
    "break_count",
    "break_details",
    "total_break_minutes",
    "worked_minutes",
    "worked_hours_decimal",
    "shift_status",
    "notes",
    "exported_at",
    "export_type",
  ];

  const rows = shifts.map((shift) => {
    const workedMinutes = calculateShiftWorkedMinutes(shift);
    const breakMinutes = calculateBreakMinutes(shift);
    const breakDetails = shift.breaks
      .map((entry) => `${entry.type} (${formatDateTime(entry.startAt)} to ${entry.endAt ? formatDateTime(entry.endAt) : "Open"})`)
      .join(" | ");

    return [
      shift.id,
      accountLabel,
      accountEmail,
      formatCalendarDate(shift.clockInAt),
      formatDateOnly(shift.clockInAt),
      formatTime(shift.clockInAt),
      shift.clockOutAt ? formatDateOnly(shift.clockOutAt) : "",
      shift.clockOutAt ? formatTime(shift.clockOutAt) : "",
      String(shift.breaks.length),
      breakDetails,
      String(breakMinutes),
      String(workedMinutes),
      (workedMinutes / 60).toFixed(2),
      getShiftStatus(shift),
      shift.notes || "",
      formatDateTime(exportedAt),
      exportType,
    ];
  });

  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
};

export const buildShiftExportFileName = (
  accountLabel: string,
  exportType: ShiftExportType,
  exportedAt: string,
  format: ShiftExportFormat,
) => {
  const safeName = accountLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "freelancer";
  const stamp = exportedAt.replace(/[:.]/g, "-");
  const suffix = exportType === "re-export" ? "reexport" : "export";
  return `${safeName}-${suffix}-${stamp}.${format === "invoice" ? "invoice" : "csv"}`;
};

const csvEscape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const buildInvoiceNumber = (issuedOn: string) => `INV-${issuedOn}`;

const normalizeMoney = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
};

const escapeInvoiceValue = (value: string) =>
  String(value ?? "")
    .replaceAll("\n", "; ")
    .replaceAll("\r", "")
    .replaceAll("|", "/");

const formatDateTime = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const formatCalendarDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

const formatDateOnly = (value: string) => {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const addDays = (isoDate: string, daysToAdd: number) => {
  const base = new Date(`${isoDate}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + (Number.isFinite(daysToAdd) ? daysToAdd : 7));
  return formatDateOnly(base.toISOString());
};
