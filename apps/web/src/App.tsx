import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
type AppRoute = "/" | "/invoice" | "/clock" | "/profile";

const routeToView: Record<AppRoute, View> = {
  "/": "dashboard",
  "/invoice": "invoice",
  "/clock": "time",
  "/profile": "profile",
};

const getRouteFromPathname = (pathname: string): AppRoute => {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized === "/invoice") {
    return "/invoice";
  }

  if (normalized === "/clock" || normalized === "/time") {
    return "/clock";
  }

  if (normalized === "/profile") {
    return "/profile";
  }

  return "/";
};

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

const formatDuration = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
};

const formatClockReadout = (value: number) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

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
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(() => getRouteFromPathname(window.location.pathname));
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Set up your freelance workspace, track time, and turn shifts into invoices.");
  const [error, setError] = useState("");
  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [manualShiftForm, setManualShiftForm] = useState(createInitialManualShiftForm);
  const [activeShiftNotes, setActiveShiftNotes] = useState("");
  const [timeSettingsOpen, setTimeSettingsOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const view = routeToView[currentRoute];
  const resolvedProfile = useMemo(() => withAssetOrigins(profile), [profile]);
  const summary = useMemo(() => calculateInvoiceSummary(draft), [draft]);
  const activeShift = useMemo(() => shifts.find((shift) => !shift.clockOutAt) ?? null, [shifts]);
  const activeBreak = useMemo(() => activeShift?.breaks.find((entry) => !entry.endAt) ?? null, [activeShift]);
  const completedShifts = useMemo(() => shifts.filter((shift) => shift.clockOutAt), [shifts]);
  const recentCompletedShifts = useMemo(() => completedShifts.slice(0, 2), [completedShifts]);
  const trackedHours = useMemo(
    () => shifts.reduce((total, shift) => total + calculateShiftWorkedMinutes(shift) / 60, 0),
    [shifts],
  );
  const activeShiftMinutes = activeShift ? calculateShiftWorkedMinutes(activeShift) : 0;
  const activeBreakMinutes = activeBreak
    ? Math.max(0, Math.round((clockNow - new Date(activeBreak.startAt).getTime()) / 60000))
    : 0;
  const clockStatus = activeShift ? getShiftStatus(activeShift) : "completed";
  const clockDate = new Date(clockNow);
  const clockHourRotation = (clockDate.getHours() % 12) * 30 + clockDate.getMinutes() * 0.5;
  const clockMinuteRotation = clockDate.getMinutes() * 6 + clockDate.getSeconds() * 0.1;
  const clockSecondRotation = clockDate.getSeconds() * 6;

  const navigateTo = (route: AppRoute, options?: { replace?: boolean }) => {
    const nextRoute = route === currentRoute ? currentRoute : route;
    const historyMethod = options?.replace ? "replaceState" : "pushState";

    if (window.location.pathname !== nextRoute) {
      window.history[historyMethod]({}, "", nextRoute);
    }

    setCurrentRoute(nextRoute);
    setTimeSettingsOpen(false);
  };

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
    const nextRoute = getRouteFromPathname(window.location.pathname);
    if (window.location.pathname !== nextRoute) {
      window.history.replaceState({}, "", nextRoute);
    }
    setCurrentRoute(nextRoute);

    const handlePopState = () => {
      setCurrentRoute(getRouteFromPathname(window.location.pathname));
      setTimeSettingsOpen(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
          navigateTo("/invoice", { replace: true });
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
        navigateTo("/invoice");
        setMessage("Imported draft from Clock Keeper. Review it and save when ready.");
        localStorage.removeItem(pendingImportKey);
      } else {
        navigateTo("/");
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
      navigateTo("/profile");
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
    navigateTo("/invoice");
    setMessage("Fresh invoice draft ready.");
  };

  const selectInvoice = (invoice: StoredInvoice) => {
    setSelectedInvoiceId(invoice.id);
    setDraft(invoice.data);
    setStatus(invoice.status);
    setSourceFormat(invoice.sourceFormat);
    navigateTo("/invoice");
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
      navigateTo("/invoice");
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
    const url = `${window.location.origin}/invoice?import=${payload}`;
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
    navigateTo("/", { replace: true });
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
      navigateTo("/clock");
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
      navigateTo("/clock");
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
      navigateTo("/invoice");
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

  const pageTitle =
    currentRoute === "/"
      ? "Freelance Dashboard"
      : currentRoute === "/clock"
        ? "Timekeeper"
        : currentRoute === "/invoice"
          ? "Invoice Generator"
          : "Profile";

  const pageSubtitle =
    currentRoute === "/"
      ? "Choose a tool, keep your data together, and add more modules later."
      : currentRoute === "/clock"
        ? "Track work with the simple Clock Keeper flow, now inside the dashboard."
        : currentRoute === "/invoice"
          ? "Build, import, save, and export invoices from the same workspace."
          : "Manage your identity, payment details, and reusable clients.";

  if (!currentUser) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">Freelance Dashboard</p>
          <h1>One home for your invoices, time tracking, and whatever app comes next.</h1>
          <p className="support-copy">Create one account, then open Invoice Generator or Timekeeper from the dashboard.</p>

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
    <div className={`workspace-shell ${currentRoute === "/clock" ? `workspace-shell--clock workspace-shell--${clockStatus}` : ""}`}>
      <header className="workspace-header">
        <div className="workspace-brand">
          <p className="eyebrow">Freelance Dashboard</p>
          <h1>{pageTitle}</h1>
          <p>{pageSubtitle}</p>
        </div>

        <div className="workspace-header__stack">
          <nav className="workspace-nav">
            <button className={currentRoute === "/" ? "active" : ""} onClick={() => navigateTo("/")}>
              Dashboard
            </button>
            <button className={currentRoute === "/invoice" ? "active" : ""} onClick={() => navigateTo("/invoice")}>
              Invoice Generator
            </button>
            <button className={currentRoute === "/clock" ? "active" : ""} onClick={() => navigateTo("/clock")}>
              Timekeeper
            </button>
            <button className={currentRoute === "/profile" ? "active" : ""} onClick={() => navigateTo("/profile")}>
              Profile
            </button>
          </nav>

          <div className="workspace-actions">
            <span className="workspace-user">{currentUser.email}</span>
            <button className="secondary-button" onClick={resetDraft}>
              New invoice
            </button>
            <button className="secondary-button" disabled={busy || Boolean(activeShift)} onClick={() => void handleClockIn()}>
              Clock in
            </button>
            <button className="text-button" onClick={logout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      {error ? <div className="status-banner status-banner--error">{error}</div> : null}

      {view === "dashboard" ? (
        <section className="dashboard-home">
          <article className="panel dashboard-hero-panel">
            <span className="section-kicker">Workspace Home</span>
            <h2>Freelance Dashboard</h2>
            <p>Use one home for time tracking, invoices, reusable client settings, and whatever app you add next.</p>
            <div className="stat-row">
              <div>
                <strong>{invoices.length}</strong>
                <span>Saved invoices</span>
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

          <div className="dashboard-app-grid">
            <button className="dashboard-app-card dashboard-app-card--invoice" onClick={() => navigateTo("/invoice")}>
              <span className="section-kicker">App 01</span>
              <h3>Invoice Generator</h3>
              <p>Create, import, save, and export invoice drafts from a dedicated page.</p>
              <strong>{selectedInvoiceId ? "Resume current draft" : "Open app"}</strong>
            </button>

            <button className="dashboard-app-card dashboard-app-card--clock" onClick={() => navigateTo("/clock")}>
              <span className="section-kicker">App 02</span>
              <h3>Timekeeper</h3>
              <p>Keep the simple Clock Keeper flow, with its own page and cleaner separation from invoicing.</p>
              <strong>{activeShift ? "Active shift running" : "Open app"}</strong>
            </button>

            <button className="dashboard-app-card dashboard-app-card--profile" onClick={() => navigateTo("/profile")}>
              <span className="section-kicker">Settings</span>
              <h3>Business Profile</h3>
              <p>Store logos, payment details, and reusable client records that both apps can share.</p>
              <strong>Manage profile</strong>
            </button>
          </div>

          <section className="dashboard-grid">
            <article className="panel">
              <span className="section-kicker">Imports</span>
              <h3>Bring in invoice data</h3>
              <p>Import `.invoice`, CSV, or JSON files, or hand off selected shifts from Timekeeper into the invoice page.</p>
              <label className="file-input">
                Import file
                <input type="file" accept=".invoice,.csv,.json" onChange={(event) => void importInvoiceFile(event.target.files?.[0])} />
              </label>
              <div className="inline-actions">
                <button className="secondary-button" onClick={downloadInvoiceFormat}>
                  Download current `.invoice`
                </button>
                <button className="secondary-button" onClick={() => void copyClockKeeperLink()}>
                  Copy import link
                </button>
              </div>
            </article>

            <article className="panel panel--full">
              <div className="section-row">
                <div>
                  <span className="section-kicker">Recent Invoices</span>
                  <h3>Pick up where you left off</h3>
                </div>
                <button className="secondary-button" onClick={() => navigateTo("/invoice")}>
                  Open invoice app
                </button>
              </div>
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
                  <p>No invoices yet. Open Invoice Generator to start your first draft.</p>
                )}
              </div>
            </article>
          </section>
        </section>
      ) : null}

      {view === "time" ? (
        <section className={`timekeeper-page timekeeper-page--${clockStatus === "completed" ? "off" : clockStatus === "on-break" ? "break" : "on"}`}>
          <article className="time-card">
            <header className="card-top">
              <div>
                <p className="micro-label">Timekeeper</p>
                <h2>{activeShift ? "Shift in progress" : "Ready when you are"}</h2>
              </div>
              <button className="icon-btn" type="button" aria-label="Open timekeeper settings" onClick={() => setTimeSettingsOpen(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.4 7.4 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.22 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
                </svg>
              </button>
            </header>

            <p className="status-pill">
              {clockStatus === "completed" ? "Off the clock" : clockStatus === "on-break" ? "On break" : "On the clock"}
            </p>

            <div className="clock-hero main-clock">
              <div className="clock-illustration">
                {Array.from({ length: 12 }, (_, index) => (
                  <span className="tick" key={index} style={{ "--rotation": `${index * 30}deg` } as CSSProperties} />
                ))}
                <span className="clock-hand hour-hand" style={{ transform: `rotate(${clockHourRotation}deg)` }} />
                <span className="clock-hand minute-hand" style={{ transform: `rotate(${clockMinuteRotation}deg)` }} />
                <span className="clock-hand second-hand" style={{ transform: `rotate(${clockSecondRotation}deg)` }} />
              </div>
              <div className="clock-readout">{formatClockReadout(clockNow)}</div>
              <h3 className="timekeeper-headline">
                {activeShift ? (activeBreak ? activeBreak.type : "Shift running") : "Clock in fast. Export everything later."}
              </h3>
              <p className="status-subtext">
                {activeShift
                  ? activeBreak
                    ? `Break started ${formatShiftDateTime(activeBreak.startAt)}.`
                    : `Started ${formatShiftDateTime(activeShift.clockInAt)}.`
                  : "Start a shift, then open settings to add missed work or export entries."}
              </p>
            </div>

            <div className="metric-row">
              <div className="metric-chip">
                <span>Shift</span>
                <strong>{formatDuration(activeShiftMinutes)}</strong>
              </div>
              <div className="metric-chip">
                <span>Break</span>
                <strong>{formatDuration(activeBreakMinutes)}</strong>
              </div>
            </div>

            <div className="action-stack">
              <div className="primary-actions">
                <button className="primary-btn" disabled={busy || Boolean(activeShift)} onClick={() => void handleClockIn()}>
                  Clock In
                </button>
                <button className="primary-btn" disabled={busy || !activeShift} onClick={() => void handleClockOut()}>
                  Clock Out
                </button>
              </div>
              <div className="secondary-actions">
                <button
                  className="secondary-btn"
                  disabled={busy || !activeShift || Boolean(activeBreak)}
                  onClick={() => void handleStartBreak("Lunch")}
                >
                  Lunch
                </button>
                <button
                  className="secondary-btn"
                  disabled={busy || !activeShift || Boolean(activeBreak)}
                  onClick={() => void handleStartBreak("Short Break")}
                >
                  Short Break
                </button>
                <button className="secondary-btn" disabled={busy || !activeBreak} onClick={() => void handleEndBreak()}>
                  End Break
                </button>
              </div>
            </div>

            <p className="feedback center-feedback">{message}</p>

            {activeShift ? (
              <section className="detail-panel">
                <label className="panel-label">
                  Shift Notes
                  <textarea
                    rows={5}
                    value={activeShiftNotes}
                    onChange={(event) => setActiveShiftNotes(event.target.value)}
                    placeholder="Add notes for this shift, job site, or client"
                  />
                </label>
              </section>
            ) : null}

            <section className="detail-panel">
              <div className="panel-heading-row">
                <div>
                  <p className="micro-label">Previous Shifts</p>
                  <h3 className="panel-title">Recent completed entries</h3>
                </div>
                <button className="text-btn" type="button" onClick={() => setTimeSettingsOpen(true)}>
                  Open Settings
                </button>
              </div>
              <div className="recent-list">
                {recentCompletedShifts.length ? (
                  recentCompletedShifts.map((shift) => (
                    <div className="timeline-card" key={shift.id}>
                      <div className="entry-topline">
                        <strong>{shift.notes || "Tracked shift"}</strong>
                        <span>{formatShiftHours(shift)} hrs</span>
                      </div>
                      <div className="entry-meta">
                        {formatShiftDateTime(shift.clockInAt)}
                        {shift.clockOutAt ? ` to ${formatShiftDateTime(shift.clockOutAt)}` : ""}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">No completed shifts yet.</div>
                )}
              </div>
            </section>
          </article>

          <div className={`settings-scrim ${timeSettingsOpen ? "" : "hidden"}`} onClick={() => setTimeSettingsOpen(false)} />

          <aside className={`settings-drawer ${timeSettingsOpen ? "" : "hidden"}`} aria-hidden={!timeSettingsOpen}>
            <div className="settings-header">
              <div>
                <p className="micro-label">Account</p>
                <h3>Settings and exports</h3>
              </div>
              <button className="text-btn" type="button" onClick={() => setTimeSettingsOpen(false)}>
                Close
              </button>
            </div>

            <section className="settings-section">
              <h4>Workspace</h4>
              <p className="muted-text">Timekeeper now lives as its own page inside Freelance Dashboard, while still sharing your account and invoice data.</p>
              <div className="stacked-actions">
                <button className="secondary-btn full-width" type="button" onClick={() => navigateTo("/invoice")}>
                  Open Invoice Generator
                </button>
                <button className="ghost-btn full-width" type="button" onClick={() => navigateTo("/profile")}>
                  Open Profile
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="panel-heading-row">
                <div>
                  <h4>Add Missed Shift</h4>
                  <p className="muted-text">Create a completed past shift before exporting payroll or invoice data.</p>
                </div>
              </div>
              <div className="stacked-actions">
                <label>
                  Start time
                  <input
                    type="datetime-local"
                    value={manualShiftForm.startAt}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, startAt: event.target.value }))}
                  />
                </label>
                <label>
                  End time
                  <input
                    type="datetime-local"
                    value={manualShiftForm.endAt}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, endAt: event.target.value }))}
                  />
                </label>
                <label>
                  Break minutes
                  <input
                    type="number"
                    min="0"
                    value={manualShiftForm.breakMinutes}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, breakMinutes: event.target.value }))}
                  />
                </label>
                <label>
                  Shift notes
                  <textarea
                    rows={3}
                    value={manualShiftForm.notes}
                    onChange={(event) => setManualShiftForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Optional task or work description"
                  />
                </label>
                <button className="primary-btn full-width" type="button" disabled={busy} onClick={() => void handleManualShiftSave()}>
                  Save Missed Shift
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="panel-heading-row">
                <div>
                  <h4>Export Completed Shifts</h4>
                  <p className="muted-text">Select completed entries to export as CSV or `.invoice`, or send them straight into Invoice Generator.</p>
                </div>
              </div>
              <div className="stacked-actions">
                <div className="button-pair">
                  <button className="secondary-btn" type="button" disabled={busy || selectedShiftIds.length === 0} onClick={() => void exportSelectedShifts("csv")}>
                    Export CSV
                  </button>
                  <button className="secondary-btn" type="button" disabled={busy || selectedShiftIds.length === 0} onClick={() => void exportSelectedShifts("invoice")}>
                    Export `.invoice`
                  </button>
                </div>
                <button className="primary-btn full-width" type="button" disabled={busy || selectedShiftIds.length === 0} onClick={() => void createInvoiceFromSelectedShifts()}>
                  Create invoice draft
                </button>
              </div>
              <div className="selection-list">
                {completedShifts.length ? (
                  completedShifts.map((shift) => {
                    const selected = selectedShiftIds.includes(shift.id);
                    return (
                      <label className="selection-card" key={shift.id}>
                        <div className="checkbox-row">
                          <input type="checkbox" checked={selected} onChange={() => toggleShiftSelection(shift.id)} />
                          <strong>{shift.notes || "Tracked shift"}</strong>
                          <span>{formatShiftHours(shift)} hrs</span>
                        </div>
                        <div className="entry-meta">{formatShiftDateTime(shift.clockInAt)}</div>
                      </label>
                    );
                  })
                ) : (
                  <div className="empty-state">No completed shifts available to export yet.</div>
                )}
              </div>
            </section>
          </aside>
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
    </div>
  );
};

export default App;
