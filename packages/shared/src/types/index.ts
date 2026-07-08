export type AddressLines = string[];

export type PaymentMethod = {
  label: string;
  details: string[];
};

export type ProfileData = {
  displayName: string;
  businessName: string;
  email: string;
  addressLines: AddressLines;
  logoUrl?: string;
  signatureUrl?: string;
  paymentPrimary: PaymentMethod;
  paymentSecondary: PaymentMethod;
};

export type InvoiceClient = {
  name: string;
  businessName?: string;
  email?: string;
  addressLines: AddressLines;
};

export type SavedClient = {
  id: string;
  userId: string;
  nickname?: string;
  name: string;
  businessName?: string;
  email?: string;
  addressLines: AddressLines;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceItem = {
  id: string;
  task: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  unitLabel?: string;
  date?: string;
  notes?: string;
};

export type InvoiceDraft = {
  id?: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  projectName?: string;
  client: InvoiceClient;
  items: InvoiceItem[];
  notes?: string;
  taxRate?: number;
  taxAmount?: number;
  discountAmount?: number;
  templateId: string;
};

export type InvoiceStatus = "draft" | "finalized";

export type InvoiceSummary = {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
};

export type StoredInvoice = {
  id: string;
  userId: string;
  status: InvoiceStatus;
  sourceFormat: string;
  templateId: string;
  data: InvoiceDraft;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceTemplateDefinition = {
  id: string;
  name: string;
  description: string;
};

export type ShiftExportFormat = "csv" | "invoice";

export type ShiftExportType = "initial-export" | "re-export";

export type ShiftStatus = "clocked-in" | "on-break" | "completed";

export type ShiftBreak = {
  id: string;
  type: string;
  startAt: string;
  endAt?: string | null;
};

export type ShiftExportRecord = {
  id: string;
  batchId: string;
  exportedAt: string;
  type: ShiftExportType;
  format: ShiftExportFormat;
};

export type ShiftRecord = {
  id: string;
  userId: string;
  clockInAt: string;
  clockOutAt?: string | null;
  notes: string;
  createdAt: string;
  breaks: ShiftBreak[];
  exports: ShiftExportRecord[];
};

export type ShiftInvoiceOptions = {
  invoiceNumber?: string;
  issuedOn?: string;
  dueOn?: string;
  dueInDays?: number;
  currency?: string;
  projectName?: string;
  clientName?: string;
  clientBusiness?: string;
  clientEmail?: string;
  clientAddress?: string;
  notes?: string;
  hourlyRate?: number;
  unitLabel?: string;
};
