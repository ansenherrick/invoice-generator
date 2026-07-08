import { useEffect, useMemo, useState } from "react";
import {
  calculateInvoiceSummary,
  calculateShiftWorkedMinutes,
  createEmptyInvoiceDraft,
  createEmptyProfile,
  decodeInvoicePayload,
  encodeInvoicePayload,
  exportCompactInvoice,
  getShiftStatus,
  parseInvoiceFile,
  type InvoiceDraft,
  type InvoiceStatus,
  type ProfileData,
  type SavedClient,
  type ShiftBreak,
  type ShiftExportFormat,
  type ShiftExportType,
  type ShiftRecord,
  type ShiftInvoiceOptions,
  type StoredInvoice,
} from "@invoice/shared";
import { api } from "./api/client";
import { InvoicePreview } from "./components/InvoicePreview";
import { exportElementToPdf } from "./utils/pdf";

type View = "dashboard" | "invoice" | "profile" | "time";

const emptyClientForm = {
  id: "",
  nickname: "",
  name: "",
  businessName: "",
  email: "",
  addressLines: "",
  notes: "",
};

const createInitialManualShiftForm = () => {
  const now = new Date();
  const earlier = new Date(now.getTime() - 60 * 60000);
  return {
    startAt: toDateTimeInputValue(earlier),
    endAt: toDateTimeInputValue(now),
    breakMinutes: "0",
    notes: "",
  };
};

const saveToken = (token: string) => localStorage.setItem("invoice-token", token);
const clearToken = () => localStorage.removeItem("invoice-token");
const pendingImportKey = "invoice-pending-import";

const absoluteAssetUrl = (path?: string) => {
  if (!path) {
    return undefined;
  }

  if (path.startsWith("http")) {
    return path;
  }

  return `${window.location.origin}${path}`;
};

const withAssetOrigins = (profile: ProfileData | null) =>
  profile
    ? {
        ...profile,
        logoUrl: absoluteAssetUrl(profile.logoUrl),
        signatureUrl: absoluteAssetUrl(profile.signatureUrl),
      }
    : null;

const toDateTimeInputValue = (value: Date) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const formatShiftDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatShiftHours = (shift: ShiftRecord) => (calculateShiftWorkedMinutes(shift) / 60).toFixed(2);

const downloadTextFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const App = () => {
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft>(createEmptyInvoiceDraft());
  const [sourceFormat, setSourceFormat] = useState("manual");
  const [status, setStatus] = useState<InvoiceStatus>("draft");
  const [invoices, setInvoices] = useState<StoredInvoice[]>([]);
  const [clients, setClients] = useState<SavedClient[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
  const [view, setView] = useState<View>("dashboard");
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Set up your freelance workspace, track time, and turn shifts into invoices.");
  const [error, setError] = useState("");
  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [manualShiftForm, setManualShiftForm] = useState(createInitialManualShiftForm);
  const [activeShiftNotes, setActiveShiftNotes] = useState("");

  const resolvedProfile = useMemo(() => withAssetOrigins(profile), [profile]);
  const summary = useMemo(() => calculateInvoiceSummary(draft), [draft]);
  const activeShift = useMemo(() => shifts.find((shift) => !shift.clockOutAt) ?? null, [shifts]);
  const activeBreak = useMemo(() => activeShift?.breaks.find((entry) => !entry.endAt) ?? null, [activeShift]);
  const completedShifts = useMemo(() => shifts.filter((shift) => shift.clockOutAt), [shifts]);
  const trackedHours = useMemo(
    () => shifts.reduce((total, shift) => total + calculateShiftWorkedMinutes(shift) / 60, 0),
    [shifts],
  );

  const loadWorkspaceData = async () => {
    const [clientResponse, profileResponse, invoiceResponse, templateResponse, shiftResponse] = await Promise.all([
      api.listClients(),
      api.getProfile(),
      api.listInvoices(),
      api.getTemplates(),
      api.listShifts(),
    ]);

    setClients(clientResponse.clients);
    setProfile(withAssetOrigins(profileResponse.profile));
    setInvoices(invoiceResponse.invoices);
    setTemplates(templateResponse.templates);
    setShifts(shiftResponse.shifts);
  };

  useEffect(() => {
    const bootstrap = async () => {
      const params = new URLSearchParams(window.location.search);
      const payload = params.get("import");
      if (payload) {
        localStorage.setItem(pendingImportKey, payload);
        window.history.replaceState({}, "", window.location.pathname);
      }

      const token = localStorage.getItem("invoice-token");
      if (!token) {
        setProfile(createEmptyProfile());
        return;
      }

      try {
        const response = await api.me();
        setCurrentUser(response.user);
        await loadWorkspaceData();
        const pendingImport = localStorage.getItem(pendingImportKey);
        if (pendingImport) {
          const importedDraft = decodeInvoicePayload(pendingImport);
          setDraft(importedDraft);
          setSourceFormat("clock-keeper");
          setStatus("draft");
          setSelectedInvoiceId(null);
          setView("invoice");
          setMessage("Imported draft from Clock Keeper. Review it and save when ready.");
          localStorage.removeItem(pendingImportKey);
        } else {
          setMessage("Welcome back. Drafts and reusable payment settings are ready.");
        }
      } catch {
        clearToken();
      }
    };

    void bootstrap();
  }, []);

  const handleAuth = async () => {
    setBusy(true);
    setError("");

    try {
      const response =
        authMode === "register" ? await api.register(email.trim(), password) : await api.login(email.trim(), password);
      saveToken(response.token);
      setCurrentUser(response.user);
      await loadWorkspaceData();
      const pendingImport = localStorage.getItem(pendingImportKey);
      if (pendingImport) {
        const importedDraft = decodeInvoicePayload(pendingImport);
        setDraft(importedDraft);
        setSourceFormat("clock-keeper");
        setStatus("draft");
        setSelectedInvoiceId(null);
        setView("invoice");
        setMessage("Imported draft from Clock Keeper. Review it and save when ready.");
        localStorage.removeItem(pendingImportKey);
      } else {
        setView("dashboard");
        setMessage(authMode === "register" ? "Account created. Let’s save your business profile next." : "Logged in.");
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleProfileField = (field: "displayName" | "businessName" | "email", value: string) => {
    setProfile((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : createEmptyProfile(),
    );
  };

  const updatePaymentDetails = (kind: "paymentPrimary" | "paymentSecondary", value: string) => {
    setProfile((current) =>
      current
        ? {
            ...current,
            [kind]: {
              ...current[kind],
              details: value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            },
          }
        : current,
    );
  };

  const updateProfileAddress = (value: string) => {
    setProfile((current) =>
      current
        ? {
            ...current,
            addressLines: value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          }
        : current,
    );
  };

  const saveProfile = async () => {
    if (!profile) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await api.updateProfile(profile);
      setProfile(withAssetOrigins(response.profile));
      setMessage("Profile saved. Future invoices will reuse these settings.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save profile.");
    } finally {
      setBusy(false);
    }
  };

  const uploadAsset = async (kind: "logo" | "signature", file: File | undefined) => {
    if (!file) {
      return;
    }

    setBusy(true);

    try {
      const response = await api.uploadProfileAsset(kind, file);
      setProfile(withAssetOrigins(response.profile));
      setMessage(`${kind === "logo" ? "Logo" : "Signature"} uploaded.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDraftField = <K extends keyof InvoiceDraft>(field: K, value: InvoiceDraft[K]) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleClientField = (field: keyof InvoiceDraft["client"], value: string) => {
    setDraft((current) => ({
      ...current,
      client: {
        ...current.client,
        [field]: field === "addressLines" ? value.split("\n") : value,
      },
    }));
  };

  const populateClientForm = (client: SavedClient) => {
    setSelectedClientId(client.id);
    setClientForm({
      id: client.id,
      nickname: client.nickname ?? "",
      name: client.name,
      businessName: client.businessName ?? "",
      email: client.email ?? "",
      addressLines: client.addressLines.join("\n"),
      notes: client.notes ?? "",
    });
  };

  const resetClientForm = () => {
    setClientForm(emptyClientForm);
  };

  const saveCurrentClientToLibrary = async () => {
    setBusy(true);
    setError("");

    try {
      const payload = {
        nickname: draft.client.name || draft.client.businessName || "",
        name: draft.client.name,
        businessName: draft.client.businessName ?? "",
        email: draft.client.email ?? "",
        addressLines: draft.client.addressLines,
        notes: "",
      };

      const existingClient = selectedClientId ? clients.find((client) => client.id === selectedClientId) : undefined;
      const response = existingClient
        ? await api.updateClient(existingClient.id, payload)
        : await api.createClient(payload);

      const refreshedClients = await api.listClients();
      setClients(refreshedClients.clients);
      setSelectedClientId(response.client.id);
      populateClientForm(response.client);
      setView("profile");
      setMessage(existingClient ? "Saved client updated from the invoice." : "Current invoice client saved to your reusable library.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save current client.");
    } finally {
      setBusy(false);
    }
  };

  const saveClient = async () => {
    setBusy(true);
    setError("");

    try {
      const payload = {
        nickname: clientForm.nickname,
        name: clientForm.name,
        businessName: clientForm.businessName,
        email: clientForm.email,
        addressLines: clientForm.addressLines.split("\n"),
        notes: clientForm.notes,
      };

      const response = clientForm.id
        ? await api.updateClient(clientForm.id, payload)
        : await api.createClient(payload);

      const refreshedClients = await api.listClients();
      setClients(refreshedClients.clients);
      setSelectedClientId(response.client.id);
      populateClientForm(response.client);
      setMessage(clientForm.id ? "Saved client updated." : "Client saved to your reusable library.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save client.");
    } finally {
      setBusy(false);
    }
  };

  const deleteClient = async (clientId: string) => {
    setBusy(true);
    setError("");

    try {
      await api.deleteClient(clientId);
      const refreshedClients = await api.listClients();
      setClients(refreshedClients.clients);
      if (selectedClientId === clientId) {
        setSelectedClientId("");
      }
      if (clientForm.id === clientId) {
        resetClientForm();
      }
      setMessage("Saved client removed.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to delete client.");
    } finally {
      setBusy(false);
    }
  };

  const applyClientToDraft = (clientId: string) => {
    const client = clients.find((entry) => entry.id === clientId);
    if (!client) {
      return;
    }

    setDraft((current) => ({
      ...current,
      client: {
        name: client.name,
        businessName: client.businessName ?? "",
        email: client.email ?? "",
        addressLines: client.addressLines,
      },
    }));
    setSelectedClientId(clientId);
    setMessage(`Loaded ${client.nickname || client.name} into the invoice.`);
  };

  const updateItem = (itemId: string, field: string, value: string) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              [field]: field === "quantity" || field === "unitPrice" ? Number(value) : value,
            }
          : item,
      ),
    }));
  };

  const addItem = () => {
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          id: crypto.randomUUID(),
          task: "",
          description: "",
          quantity: 1,
          unitPrice: 0,
          unitLabel: "qty",
          date: "",
          notes: "",
        },
      ],
    }));
  };

  const removeItem = (itemId: string) => {
    setDraft((current) => ({
      ...current,
      items: current.items.length === 1 ? current.items : current.items.filter((item) => item.id !== itemId),
    }));
  };

  const resetDraft = () => {
    setDraft(createEmptyInvoiceDraft());
    setStatus("draft");
    setSourceFormat("manual");
    setSelectedInvoiceId(null);
    setView("invoice");
    setMessage("Fresh invoice draft ready.");
  };

  const selectInvoice = (invoice: StoredInvoice) => {
    setSelectedInvoiceId(invoice.id);
    setDraft(invoice.data);
    setStatus(invoice.status);
    setSourceFormat(invoice.sourceFormat);
    setView("invoice");
    setMessage(`Loaded ${invoice.data.invoiceNumber}.`);
  };

  const saveInvoice = async (nextStatus: InvoiceStatus) => {
    setBusy(true);
    setError("");

    try {
      const payload = {
        status: nextStatus,
        sourceFormat,
        data: draft,
      };

      const response = selectedInvoiceId
        ? await api.updateInvoice(selectedInvoiceId, payload)
        : await api.createInvoice(payload);

      setSelectedInvoiceId(response.invoice.id);
      setStatus(response.invoice.status);
      setDraft(response.invoice.data);
      const updatedInvoices = await api.listInvoices();
      setInvoices(updatedInvoices.invoices);
      setMessage(nextStatus === "draft" ? "Draft saved." : "Invoice finalized and saved.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save invoice.");
    } finally {
      setBusy(false);
    }
  };

  const downloadInvoiceFormat = () => {
    const blob = new Blob([exportCompactInvoice(draft)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${draft.invoiceNumber || "invoice"}.invoice`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Compact .invoice file downloaded for Clock Keeper imports.");
  };

  const importInvoiceFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const importedDraft = parseInvoiceFile(file.name, text);
      setDraft(importedDraft);
      setSourceFormat(file.name.split(".").pop() ?? "import");
      setStatus("draft");
      setSelectedInvoiceId(null);
      setView("invoice");
      setMessage(`Imported data from ${file.name}. Review, then save as a draft or finalize.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to import file.");
    }
  };

  const exportPdf = () => {
    const element = document.getElementById("invoice-sheet");
    if (!element) {
      setError("Invoice preview is not ready for PDF export.");
      return;
    }

    void exportElementToPdf(element, `${draft.invoiceNumber || "invoice"}.pdf`)
      .then(() => setMessage("PDF exported successfully."))
      .catch((caughtError) => {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to export PDF.");
      });
  };

  const copyClockKeeperLink = async () => {
    const payload = encodeInvoicePayload(draft);
    const url = `${window.location.origin}/?import=${payload}`;
    await navigator.clipboard.writeText(url);
    setMessage("Clock Keeper import link copied.");
  };

  const logout = () => {
    clearToken();
    setCurrentUser(null);
    setProfile(createEmptyProfile());
    setInvoices([]);
    setClients([]);
    setShifts([]);
    setSelectedShiftIds([]);
    setActiveShiftNotes("");
    setManualShiftForm(createInitialManualShiftForm());
    setSelectedClientId("");
    resetClientForm();
    resetDraft();
    setView("dashboard");
    setMessage("Signed out.");
  };

  const toggleShiftSelection = (shiftId: string) => {
    setSelectedShiftIds((current) =>
      current.includes(shiftId) ? current.filter((id) => id !== shiftId) : [...current, shiftId],
    );
  };

  const handleClockIn = async () => {
    setBusy(true);
    setError("");

    try {
      const response = await api.clockIn();
      setShifts(response.shifts);
      setMessage("Shift started.");
      setView("time");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to clock in.");
    } finally {
      setBusy(false);
    }
  };

  const handleClockOut = async () => {
    if (!activeShift) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await api.clockOut(activeShift.id, activeShiftNotes);
      setShifts(response.shifts);
      setActiveShiftNotes("");
      setMessage("Shift completed and saved.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to clock out.");
    } finally {
      setBusy(false);
    }
  };

  const handleStartBreak = async (type: string) => {
    if (!activeShift) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await api.startBreak(activeShift.id, type);
      setShifts(response.shifts);
      setMessage(`${type} started.`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to start break.");
    } finally {
      setBusy(false);
    }
  };

  const handleEndBreak = async () => {
    if (!activeShift || !activeBreak) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await api.endBreak(activeShift.id, activeBreak.id);
      setShifts(response.shifts);
      setMessage("Break ended.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to end break.");
    } finally {
      setBusy(false);
    }
  };

  const handleManualShiftSave = async () => {
    setBusy(true);
    setError("");

    try {
      const response = await api.createManualShift({
        startAt: manualShiftForm.startAt,
        endAt: manualShiftForm.endAt,
        breakMinutes: Number(manualShiftForm.breakMinutes || 0),
        notes: manualShiftForm.notes,
      });
      setShifts(response.shifts);
      setManualShiftForm(createInitialManualShiftForm());
      setMessage("Manual shift saved.");
      setView("time");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save manual shift.");
    } finally {
      setBusy(false);
    }
  };

  const getShiftExportType = (): ShiftExportType => {
    const selectedShifts = completedShifts.filter((shift) => selectedShiftIds.includes(shift.id));
    return selectedShifts.some((shift) => shift.exports.length > 0) ? "re-export" : "initial-export";
  };

  const getShiftInvoiceOptions = (): ShiftInvoiceOptions => {
    const firstPricedItem = draft.items.find((item) => item.unitPrice > 0);
    return {
      invoiceNumber: draft.invoiceNumber || undefined,
      issuedOn: draft.issueDate || undefined,
      dueOn: draft.dueDate || undefined,
      currency: draft.currency || undefined,
      projectName: draft.projectName || undefined,
      clientName: draft.client.name || undefined,
      clientBusiness: draft.client.businessName || undefined,
      clientEmail: draft.client.email || undefined,
      clientAddress: draft.client.addressLines.join(";") || undefined,
      notes: draft.notes || undefined,
      hourlyRate: firstPricedItem?.unitPrice,
      unitLabel: firstPricedItem?.unitLabel || undefined,
    };
  };

  const createInvoiceFromSelectedShifts = async () => {
    if (!selectedShiftIds.length) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await api.exportShifts({
        shiftIds: selectedShiftIds,
        type: getShiftExportType(),
        format: "invoice",
        invoice: getShiftInvoiceOptions(),
      });
      const importedDraft = parseInvoiceFile("tracked-shifts.invoice", response.content);
      setDraft(importedDraft);
      setShifts(response.shifts);
      setSelectedInvoiceId(null);
      setSourceFormat("time-tracker");
      setStatus("draft");
      setView("invoice");
      setMessage("Selected shifts were handed off through the import format and loaded into the invoice builder.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to hand off shifts to the invoice builder.");
    } finally {
      setBusy(false);
    }
  };

  const exportSelectedShifts = async (format: ShiftExportFormat) => {
    if (!selectedShiftIds.length) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await api.exportShifts({
        shiftIds: selectedShiftIds,
        type: getShiftExportType(),
        format,
        invoice: getShiftInvoiceOptions(),
      });
      setShifts(response.shifts);
      downloadTextFile(response.content, response.filename, response.mimeType);
      setMessage(
        format === "invoice"
          ? `Exported ${response.exportedCount} shift${response.exportedCount === 1 ? "" : "s"} as a compact .invoice file.`
          : `Exported ${response.exportedCount} shift${response.exportedCount === 1 ? "" : "s"} as CSV.`,
      );
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to export shifts.");
    } finally {
      setBusy(false);
    }
  };

  if (!currentUser) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">Freelance Invoice Generator</p>
          <h1>Minimal invoicing, reusable account settings, and draft saving.</h1>
          <p className="support-copy">Create one account, track shifts, reuse payment settings, and turn recorded work into invoices.</p>

          <div className="auth-toggle">
            <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>
              Register
            </button>
            <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>
              Login
            </button>
          </div>

          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>

          {error ? <div className="status-banner status-banner--error">{error}</div> : null}

          <button className="primary-button" disabled={busy} onClick={handleAuth}>
            {busy ? "Working..." : authMode === "register" ? "Create account" : "Log in"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Invoice Studio</p>
          <h2>{currentUser.email}</h2>
        </div>

        <nav className="sidebar-nav">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            Dashboard
          </button>
          <button className={view === "time" ? "active" : ""} onClick={() => setView("time")}>
            Time Tracker
          </button>
          <button className={view === "invoice" ? "active" : ""} onClick={() => setView("invoice")}>
            Invoice Builder
          </button>
          <button className={view === "profile" ? "active" : ""} onClick={() => setView("profile")}>
            Profile
          </button>
        </nav>

        <div className="sidebar-actions">
          <button className="sidebar-action sidebar-action--new" onClick={resetDraft}>
            New invoice
          </button>
          <button className="sidebar-action" disabled={busy} onClick={() => void handleClockIn()}>
            Clock in
          </button>
          <button className="sidebar-action sidebar-action--logout" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div>
            <h1>{view === "dashboard" ? "Dashboard" : view === "profile" ? "Profile" : view === "time" ? "Time Tracker" : "Invoice Builder"}</h1>
            <p>{message}</p>
          </div>
          {error ? <div className="status-banner status-banner--error">{error}</div> : null}
        </header>

        {view === "dashboard" ? (
          <section className="dashboard-grid">
            <article className="panel">
              <span className="section-kicker">Workspace</span>
              <h3>{invoices.length} saved invoice{invoices.length === 1 ? "" : "s"}</h3>
              <p>Drafts stay editable, finalized invoices stay reusable, and your payment settings stay attached to your account.</p>
              <div className="stat-row">
                <div>
                  <strong>${summary.total.toFixed(2)}</strong>
                  <span>Current draft total</span>
                </div>
                <div>
                  <strong>{trackedHours.toFixed(2)}</strong>
                  <span>Tracked hours</span>
                </div>
                <div>
                  <strong>{clients.length}</strong>
                  <span>Saved clients</span>
                </div>
              </div>
            </article>

            <article className="panel">
              <span className="section-kicker">Import</span>
              <h3>Bring in outside invoice data</h3>
              <p>Import `.invoice`, CSV, or JSON files, or build new invoice drafts directly from tracked shifts in the Time Tracker.</p>
              <label className="file-input">
                Import file
                <input type="file" accept=".invoice,.csv,.json" onChange={(event) => void importInvoiceFile(event.target.files?.[0])} />
              </label>
              <button className="secondary-button" onClick={downloadInvoiceFormat}>
                Download current `.invoice`
              </button>
              <button className="secondary-button" onClick={() => void copyClockKeeperLink()}>
                Copy import link
              </button>
            </article>

            <article className="panel">
              <span className="section-kicker">Time Tracker</span>
              <h3>{completedShifts.length} completed shift{completedShifts.length === 1 ? "" : "s"}</h3>
              <p>Clock live work, add manual entries, then send selected shifts straight into the invoice builder.</p>
              <div className="stat-row stat-row--compact">
                <div>
                  <strong>{activeShift ? "Live" : "Idle"}</strong>
                  <span>Current tracker status</span>
                </div>
                <div>
                  <strong>{shifts.length}</strong>
                  <span>Total shifts</span>
                </div>
              </div>
              <button className="secondary-button" onClick={() => setView("time")}>
                Open time tracker
              </button>
            </article>

            <article className="panel panel--full">
              <span className="section-kicker">Saved Invoices</span>
              <div className="invoice-list">
                {invoices.length ? (
                  invoices.map((invoice) => {
                    const invoiceSummary = calculateInvoiceSummary(invoice.data);
                    return (
                      <button className="invoice-list__card" key={invoice.id} onClick={() => selectInvoice(invoice)}>
                        <div>
                          <strong>{invoice.data.invoiceNumber}</strong>
                          <span>{invoice.data.client.name || "No client yet"}</span>
                        </div>
                        <div>
                          <span>{invoice.status}</span>
                          <strong>${invoiceSummary.total.toFixed(2)}</strong>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p>No invoices yet. Create one or import from Clock Keeper.</p>
                )}
              </div>
            </article>
          </section>
        ) : null}

        {view === "time" ? (
          <section className="workspace-grid">
            <article className="panel">
              <div className="section-row">
                <div>
                  <span className="section-kicker">Shift Controls</span>
                  <h3>{activeShift ? "Active shift running" : "No active shift"}</h3>
                </div>
                <span className={`shift-status-pill shift-status-pill--${activeShift ? getShiftStatus(activeShift) : "completed"}`}>
                  {activeShift ? getShiftStatus(activeShift).replace("-", " ") : "idle"}
                </span>
              </div>
              {activeShift ? (
                <>
                  <p>Started {formatShiftDateTime(activeShift.clockInAt)}.</p>
                  {activeBreak ? (
                    <div className="status-banner shift-inline-banner">
                      <strong>{activeBreak.type}</strong>
                      <span>Started {formatShiftDateTime(activeBreak.startAt)}</span>
                    </div>
                  ) : null}
                  <label>
                    Shift notes
                    <textarea
                      rows={3}
                      value={activeShiftNotes}
                      onChange={(event) => setActiveShiftNotes(event.target.value)}
                      placeholder="Optional notes for this completed shift"
                    />
                  </label>
                  <div className="action-row">
                    {activeBreak ? (
                      <button className="secondary-button" disabled={busy} onClick={() => void handleEndBreak()}>
                        End break
                      </button>
                    ) : (
                      <>
                        <button className="secondary-button" disabled={busy} onClick={() => void handleStartBreak("Short Break")}>
                          Short break
                        </button>
                        <button className="secondary-button" disabled={busy} onClick={() => void handleStartBreak("Lunch")}>
                          Lunch
                        </button>
                      </>
                    )}
                    <button className="primary-button" disabled={busy} onClick={() => void handleClockOut()}>
                      Clock out
                    </button>
                  </div>
                </>
              ) : (
                <div className="action-row">
                  <button className="primary-button" disabled={busy} onClick={() => void handleClockIn()}>
                    Clock in now
                  </button>
                </div>
              )}
            </article>

            <article className="panel">
              <span className="section-kicker">Manual Entry</span>
              <h3>Add past work</h3>
              <div className="form-grid">
                <label>
                  Start
                  <input
                    type="datetime-local"
                    value={manualShiftForm.startAt}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, startAt: event.target.value }))}
                  />
                </label>
                <label>
                  End
                  <input
                    type="datetime-local"
                    value={manualShiftForm.endAt}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, endAt: event.target.value }))}
                  />
                </label>
                <label>
                  Break Minutes
                  <input
                    type="number"
                    min="0"
                    value={manualShiftForm.breakMinutes}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, breakMinutes: event.target.value }))}
                  />
                </label>
                <label>
                  Notes
                  <input
                    value={manualShiftForm.notes}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Homepage revisions"
                  />
                </label>
              </div>
              <button className="secondary-button" disabled={busy} onClick={() => void handleManualShiftSave()}>
                Save manual shift
              </button>
            </article>

            <article className="panel panel--full">
              <div className="section-row">
                <div>
                  <span className="section-kicker">Tracked Shifts</span>
                  <h3>Select completed shifts to invoice</h3>
                </div>
                <div className="inline-actions">
                  <button
                    className="secondary-button"
                    disabled={busy || selectedShiftIds.length === 0}
                    onClick={() => void exportSelectedShifts("csv")}
                  >
                    Export CSV
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || selectedShiftIds.length === 0}
                    onClick={() => void exportSelectedShifts("invoice")}
                  >
                    Export `.invoice`
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || selectedShiftIds.length === 0}
                    onClick={() => void createInvoiceFromSelectedShifts()}
                  >
                    Create invoice draft
                  </button>
                </div>
              </div>
              <div className="shift-list">
                {shifts.length ? (
                  shifts.map((shift) => {
                    const isCompleted = Boolean(shift.clockOutAt);
                    const selected = selectedShiftIds.includes(shift.id);
                    return (
                      <label className={`shift-card ${selected ? "shift-card--selected" : ""}`} key={shift.id}>
                        <div className="shift-card__select">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!isCompleted}
                            onChange={() => toggleShiftSelection(shift.id)}
                          />
                        </div>
                        <div className="shift-card__body">
                          <div className="section-row">
                            <strong>{shift.notes || "Tracked shift"}</strong>
                            <span className={`shift-status-pill shift-status-pill--${getShiftStatus(shift)}`}>
                              {getShiftStatus(shift).replace("-", " ")}
                            </span>
                          </div>
                          <div className="shift-card__meta">
                            <span>{formatShiftDateTime(shift.clockInAt)}</span>
                            <span>{shift.clockOutAt ? formatShiftDateTime(shift.clockOutAt) : "Still running"}</span>
                            <span>{formatShiftHours(shift)} hours</span>
                          </div>
                          {shift.breaks.length ? (
                            <div className="shift-break-list">
                              {shift.breaks.map((entry: ShiftBreak) => (
                                <span key={entry.id}>
                                  {entry.type}: {formatShiftDateTime(entry.startAt)}
                                  {entry.endAt ? ` to ${formatShiftDateTime(entry.endAt)}` : " to active"}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    );
                  })
                ) : (
                  <p>No shifts yet. Clock in or add a manual entry to start building the merged workspace.</p>
                )}
              </div>
            </article>
          </section>
        ) : null}

        {view === "profile" && profile ? (
          <section className="workspace-grid">
            <article className="panel">
              <span className="section-kicker">Business Identity</span>
              <label>
                Display Name
                <input value={profile.displayName} onChange={(event) => handleProfileField("displayName", event.target.value)} />
              </label>
              <label>
                Business Name
                <input value={profile.businessName} onChange={(event) => handleProfileField("businessName", event.target.value)} />
              </label>
              <label>
                Business Email
                <input value={profile.email} onChange={(event) => handleProfileField("email", event.target.value)} />
              </label>
              <label>
                Address
                <textarea
                  rows={4}
                  value={profile.addressLines.join("\n")}
                  onChange={(event) => updateProfileAddress(event.target.value)}
                />
              </label>
              <div className="file-row">
                <label className="file-input">
                  Upload logo
                  <input type="file" accept="image/*" onChange={(event) => void uploadAsset("logo", event.target.files?.[0])} />
                </label>
                <label className="file-input">
                  Upload signature
                  <input type="file" accept="image/*" onChange={(event) => void uploadAsset("signature", event.target.files?.[0])} />
                </label>
              </div>
            </article>

            <article className="panel">
              <span className="section-kicker">Payment Details</span>
              <label>
                Primary Payment Label
                <input
                  value={profile.paymentPrimary.label}
                  onChange={(event) =>
                    setProfile((current) =>
                      current
                        ? {
                            ...current,
                            paymentPrimary: {
                              ...current.paymentPrimary,
                              label: event.target.value,
                            },
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Primary Payment Details
                <textarea
                  rows={6}
                  value={profile.paymentPrimary.details.join("\n")}
                  onChange={(event) => updatePaymentDetails("paymentPrimary", event.target.value)}
                />
              </label>
              <label>
                Secondary Payment Label
                <input
                  value={profile.paymentSecondary.label}
                  onChange={(event) =>
                    setProfile((current) =>
                      current
                        ? {
                            ...current,
                            paymentSecondary: {
                              ...current.paymentSecondary,
                              label: event.target.value,
                            },
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Secondary Payment Details
                <textarea
                  rows={6}
                  value={profile.paymentSecondary.details.join("\n")}
                  onChange={(event) => updatePaymentDetails("paymentSecondary", event.target.value)}
                />
              </label>
              <button className="primary-button" disabled={busy} onClick={() => void saveProfile()}>
                Save profile
              </button>
            </article>

            <article className="panel panel--full">
              <div className="section-row">
                <div>
                  <span className="section-kicker">Saved Clients</span>
                  <h3>Reusable client records</h3>
                </div>
                <button className="secondary-button" onClick={resetClientForm}>
                  New client
                </button>
              </div>

              <div className="saved-clients-grid">
                <div className="saved-client-list">
                  {clients.length ? (
                    clients.map((client) => (
                      <div className="saved-client-card" key={client.id}>
                        <button className="saved-client-card__main" onClick={() => populateClientForm(client)}>
                          <strong>{client.nickname || client.name}</strong>
                          <span>{client.businessName || client.email || "Saved client"}</span>
                        </button>
                        <div className="saved-client-card__actions">
                          <button className="secondary-button" onClick={() => applyClientToDraft(client.id)}>
                            Use in invoice
                          </button>
                          <button className="text-button" onClick={() => void deleteClient(client.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>No saved clients yet. Save one from an invoice or create one here.</p>
                  )}
                </div>

                <div className="saved-client-form">
                  <div className="form-grid">
                    <label>
                      Nickname
                      <input
                        value={clientForm.nickname}
                        onChange={(event) => setClientForm((current) => ({ ...current, nickname: event.target.value }))}
                        placeholder="Acme retainer"
                      />
                    </label>
                    <label>
                      Client Name
                      <input
                        value={clientForm.name}
                        onChange={(event) => setClientForm((current) => ({ ...current, name: event.target.value }))}
                      />
                    </label>
                    <label>
                      Business Name
                      <input
                        value={clientForm.businessName}
                        onChange={(event) => setClientForm((current) => ({ ...current, businessName: event.target.value }))}
                      />
                    </label>
                    <label>
                      Client Email
                      <input
                        value={clientForm.email}
                        onChange={(event) => setClientForm((current) => ({ ...current, email: event.target.value }))}
                      />
                    </label>
                    <label className="full-width">
                      Address
                      <textarea
                        rows={4}
                        value={clientForm.addressLines}
                        onChange={(event) => setClientForm((current) => ({ ...current, addressLines: event.target.value }))}
                      />
                    </label>
                    <label className="full-width">
                      Notes
                      <textarea
                        rows={3}
                        value={clientForm.notes}
                        onChange={(event) => setClientForm((current) => ({ ...current, notes: event.target.value }))}
                      />
                    </label>
                  </div>

                  <div className="action-row">
                    <button className="primary-button" disabled={busy} onClick={() => void saveClient()}>
                      {clientForm.id ? "Update client" : "Save client"}
                    </button>
                    <button className="secondary-button" onClick={resetClientForm}>
                      Clear form
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </section>
        ) : null}

        {view === "invoice" ? (
          <section className="workspace-grid">
            <article className="panel panel--form">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Invoice Form</span>
                  <h3>Edit data, then preview beside it</h3>
                </div>
                <label className="file-input">
                  Import file
                  <input type="file" accept=".invoice,.csv,.json" onChange={(event) => void importInvoiceFile(event.target.files?.[0])} />
                </label>
              </div>

              <div className="form-grid">
                <label>
                  Invoice Number
                  <input value={draft.invoiceNumber} onChange={(event) => handleDraftField("invoiceNumber", event.target.value)} />
                </label>
                <label>
                  Template
                  <select value={draft.templateId} onChange={(event) => handleDraftField("templateId", event.target.value)}>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Issue Date
                  <input type="date" value={draft.issueDate} onChange={(event) => handleDraftField("issueDate", event.target.value)} />
                </label>
                <label>
                  Due Date
                  <input type="date" value={draft.dueDate} onChange={(event) => handleDraftField("dueDate", event.target.value)} />
                </label>
                <label>
                  Currency
                  <input value={draft.currency} onChange={(event) => handleDraftField("currency", event.target.value.toUpperCase())} />
                </label>
                <label>
                  Project
                  <input value={draft.projectName ?? ""} onChange={(event) => handleDraftField("projectName", event.target.value)} />
                </label>
              </div>

              <div className="section-block">
                <div className="section-row">
                  <span className="section-kicker">Client</span>
                  <div className="inline-actions">
                    <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
                      <option value="">Select saved client</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.nickname || client.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="secondary-button"
                      disabled={!selectedClientId}
                      onClick={() => applyClientToDraft(selectedClientId)}
                    >
                      Load client
                    </button>
                    <button className="secondary-button" disabled={busy} onClick={() => void saveCurrentClientToLibrary()}>
                      Save current client
                    </button>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    Client Name
                    <input value={draft.client.name} onChange={(event) => handleClientField("name", event.target.value)} />
                  </label>
                  <label>
                    Business Name
                    <input value={draft.client.businessName ?? ""} onChange={(event) => handleClientField("businessName", event.target.value)} />
                  </label>
                  <label>
                    Client Email
                    <input value={draft.client.email ?? ""} onChange={(event) => handleClientField("email", event.target.value)} />
                  </label>
                  <label className="full-width">
                    Client Address
                    <textarea
                      rows={3}
                      value={draft.client.addressLines.join("\n")}
                      onChange={(event) => handleClientField("addressLines", event.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="section-block">
                <div className="section-row">
                  <span className="section-kicker">Items</span>
                  <button className="secondary-button" onClick={addItem}>
                    Add item
                  </button>
                </div>
                {draft.items.map((item) => (
                  <div className="item-card" key={item.id}>
                    <div className="form-grid">
                      <label>
                        Task
                        <input value={item.task} onChange={(event) => updateItem(item.id, "task", event.target.value)} />
                      </label>
                      <label>
                        Description
                        <input value={item.description ?? ""} onChange={(event) => updateItem(item.id, "description", event.target.value)} />
                      </label>
                      <label>
                        Quantity
                        <input type="number" min="0" step="0.01" value={item.quantity} onChange={(event) => updateItem(item.id, "quantity", event.target.value)} />
                      </label>
                      <label>
                        Unit Price
                        <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(item.id, "unitPrice", event.target.value)} />
                      </label>
                      <label>
                        Unit Label
                        <input value={item.unitLabel ?? ""} onChange={(event) => updateItem(item.id, "unitLabel", event.target.value)} />
                      </label>
                      <label>
                        Date
                        <input type="date" value={item.date ?? ""} onChange={(event) => updateItem(item.id, "date", event.target.value)} />
                      </label>
                      <label className="full-width">
                        Notes
                        <input value={item.notes ?? ""} onChange={(event) => updateItem(item.id, "notes", event.target.value)} />
                      </label>
                    </div>
                    <button className="text-button" onClick={() => removeItem(item.id)}>
                      Remove item
                    </button>
                  </div>
                ))}
              </div>

              <div className="section-block">
                <span className="section-kicker">Summary</span>
                <div className="form-grid">
                  <label>
                    Tax Rate %
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.taxRate ?? 0}
                      onChange={(event) => handleDraftField("taxRate", Number(event.target.value))}
                    />
                  </label>
                  <label>
                    Discount Amount
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.discountAmount ?? 0}
                      onChange={(event) => handleDraftField("discountAmount", Number(event.target.value))}
                    />
                  </label>
                  <label className="full-width">
                    Invoice Notes
                    <textarea rows={4} value={draft.notes ?? ""} onChange={(event) => handleDraftField("notes", event.target.value)} />
                  </label>
                </div>
                <div className="summary-strip">
                  <span>Subtotal: ${summary.subtotal.toFixed(2)}</span>
                  <span>Tax: ${summary.taxAmount.toFixed(2)}</span>
                  <span>Total: ${summary.total.toFixed(2)}</span>
                </div>
              </div>

              <div className="action-row">
                <button className="primary-button" disabled={busy} onClick={() => void saveInvoice("draft")}>
                  Save draft
                </button>
                <button className="secondary-button" disabled={busy} onClick={() => void saveInvoice("finalized")}>
                  Finalize invoice
                </button>
                <button className="secondary-button" onClick={exportPdf}>
                  Export PDF
                </button>
                <button className="secondary-button" onClick={downloadInvoiceFormat}>
                  Export `.invoice`
                </button>
                <button className="secondary-button" onClick={() => void copyClockKeeperLink()}>
                  Copy import link
                </button>
              </div>
            </article>

            <InvoicePreview draft={draft} profile={resolvedProfile} />
          </section>
        ) : null}
      </main>
    </div>
  );
};

export default App;
