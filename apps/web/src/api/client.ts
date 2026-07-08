import type {
  InvoiceDraft,
  InvoiceStatus,
  ProfileData,
  SavedClient,
  ShiftExportFormat,
  ShiftExportType,
  ShiftRecord,
  StoredInvoice,
} from "@invoice/shared";

const jsonHeaders = {
  "Content-Type": "application/json",
};

const getToken = () => localStorage.getItem("invoice-token");
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

const request = async <T>(path: string, options: RequestInit = {}) => {
  const token = getToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : jsonHeaders),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload as T;
};

export const api = {
  register(email: string, password: string) {
    return request<{ token: string; user: { id: string; email: string } }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  login(email: string, password: string) {
    return request<{ token: string; user: { id: string; email: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  me() {
    return request<{ user: { id: string; email: string } }>("/api/auth/me");
  },

  getTemplates() {
    return request<{ templates: { id: string; name: string; description: string }[] }>("/api/templates");
  },

  getProfile() {
    return request<{ profile: ProfileData }>("/api/profile");
  },

  updateProfile(profile: ProfileData) {
    return request<{ profile: ProfileData }>("/api/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    });
  },

  uploadProfileAsset(kind: "logo" | "signature", file: File) {
    const formData = new FormData();
    formData.append("file", file);

    return request<{ profile: ProfileData }>(`/api/profile/${kind}`, {
      method: "POST",
      body: formData,
    });
  },

  listInvoices() {
    return request<{ invoices: StoredInvoice[] }>("/api/invoices");
  },

  listShifts() {
    return request<{ shifts: ShiftRecord[] }>("/api/shifts");
  },

  listClients() {
    return request<{ clients: SavedClient[] }>("/api/clients");
  },

  createClient(payload: Omit<SavedClient, "id" | "userId" | "createdAt" | "updatedAt">) {
    return request<{ client: SavedClient }>("/api/clients", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateClient(clientId: string, payload: Omit<SavedClient, "id" | "userId" | "createdAt" | "updatedAt">) {
    return request<{ client: SavedClient }>(`/api/clients/${clientId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deleteClient(clientId: string) {
    return request<Record<string, never>>(`/api/clients/${clientId}`, {
      method: "DELETE",
    });
  },

  createInvoice(payload: { status: InvoiceStatus; sourceFormat: string; data: InvoiceDraft }) {
    return request<{ invoice: StoredInvoice }>("/api/invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateInvoice(invoiceId: string, payload: { status: InvoiceStatus; sourceFormat: string; data: InvoiceDraft }) {
    return request<{ invoice: StoredInvoice }>(`/api/invoices/${invoiceId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  createManualShift(payload: { startAt: string; endAt: string; breakMinutes: number; notes: string }) {
    return request<{ shifts: ShiftRecord[] }>("/api/shifts/manual", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  clockIn() {
    return request<{ shifts: ShiftRecord[] }>("/api/shifts/clock-in", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  clockOut(shiftId: string, notes = "") {
    return request<{ shifts: ShiftRecord[] }>(`/api/shifts/${shiftId}/clock-out`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
  },

  startBreak(shiftId: string, type: string) {
    return request<{ shifts: ShiftRecord[] }>(`/api/shifts/${shiftId}/breaks`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
  },

  endBreak(shiftId: string, breakId: string) {
    return request<{ shifts: ShiftRecord[] }>(`/api/shifts/${shiftId}/breaks/${breakId}/end`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  exportShifts(payload: {
    shiftIds: string[];
    type: ShiftExportType;
    format: ShiftExportFormat;
    invoice?: Record<string, unknown>;
  }) {
    return request<{
      content: string;
      filename: string;
      mimeType: string;
      format: ShiftExportFormat;
      exportedCount: number;
      shifts: ShiftRecord[];
    }>("/api/shifts/exports", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
