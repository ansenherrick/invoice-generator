import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { calculateInvoiceSummary, calculateShiftWorkedMinutes, createEmptyInvoiceDraft, createEmptyProfile, decodeInvoicePayload, encodeInvoicePayload, exportCompactInvoice, getShiftStatus, parseInvoiceFile, } from "@invoice/shared";
import { api } from "./api/client";
import { InvoicePreview } from "./components/InvoicePreview";
import { exportElementToPdf } from "./utils/pdf";
const routeToView = {
    "/": "dashboard",
    "/invoice": "invoice",
    "/clock": "time",
    "/profile": "profile",
};
const getRouteFromPathname = (pathname) => {
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
const saveToken = (token) => localStorage.setItem("invoice-token", token);
const clearToken = () => localStorage.removeItem("invoice-token");
const pendingImportKey = "invoice-pending-import";
const absoluteAssetUrl = (path) => {
    if (!path) {
        return undefined;
    }
    if (path.startsWith("http")) {
        return path;
    }
    return `${window.location.origin}${path}`;
};
const withAssetOrigins = (profile) => profile
    ? {
        ...profile,
        logoUrl: absoluteAssetUrl(profile.logoUrl),
        signatureUrl: absoluteAssetUrl(profile.signatureUrl),
    }
    : null;
const toDateTimeInputValue = (value) => {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
};
const formatDuration = (minutes) => {
    const safeMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const remainingMinutes = safeMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
};
const formatClockReadout = (value) => new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
}).format(new Date(value));
const formatShiftDateTime = (value) => new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
}).format(new Date(value));
const formatShiftHours = (shift) => (calculateShiftWorkedMinutes(shift) / 60).toFixed(2);
const downloadTextFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};
const App = () => {
    const [authMode, setAuthMode] = useState("register");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [currentUser, setCurrentUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [draft, setDraft] = useState(createEmptyInvoiceDraft());
    const [sourceFormat, setSourceFormat] = useState("manual");
    const [status, setStatus] = useState("draft");
    const [invoices, setInvoices] = useState([]);
    const [clients, setClients] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
    const [selectedClientId, setSelectedClientId] = useState("");
    const [selectedShiftIds, setSelectedShiftIds] = useState([]);
    const [currentRoute, setCurrentRoute] = useState(() => getRouteFromPathname(window.location.pathname));
    const [templates, setTemplates] = useState([]);
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
    const trackedHours = useMemo(() => shifts.reduce((total, shift) => total + calculateShiftWorkedMinutes(shift) / 60, 0), [shifts]);
    const activeShiftMinutes = activeShift ? calculateShiftWorkedMinutes(activeShift) : 0;
    const activeBreakMinutes = activeBreak
        ? Math.max(0, Math.round((clockNow - new Date(activeBreak.startAt).getTime()) / 60000))
        : 0;
    const clockStatus = activeShift ? getShiftStatus(activeShift) : "completed";
    const clockDate = new Date(clockNow);
    const clockHourRotation = (clockDate.getHours() % 12) * 30 + clockDate.getMinutes() * 0.5;
    const clockMinuteRotation = clockDate.getMinutes() * 6 + clockDate.getSeconds() * 0.1;
    const clockSecondRotation = clockDate.getSeconds() * 6;
    const navigateTo = (route, options) => {
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
                }
                else {
                    setMessage("Welcome back. Drafts and reusable payment settings are ready.");
                }
            }
            catch {
                clearToken();
            }
        };
        void bootstrap();
    }, []);
    const handleAuth = async () => {
        setBusy(true);
        setError("");
        try {
            const response = authMode === "register" ? await api.register(email.trim(), password) : await api.login(email.trim(), password);
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
            }
            else {
                navigateTo("/");
                setMessage(authMode === "register" ? "Account created. Let’s save your business profile next." : "Logged in.");
            }
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Authentication failed.");
        }
        finally {
            setBusy(false);
        }
    };
    const handleProfileField = (field, value) => {
        setProfile((current) => current
            ? {
                ...current,
                [field]: value,
            }
            : createEmptyProfile());
    };
    const updatePaymentDetails = (kind, value) => {
        setProfile((current) => current
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
            : current);
    };
    const updateProfileAddress = (value) => {
        setProfile((current) => current
            ? {
                ...current,
                addressLines: value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
            }
            : current);
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to save profile.");
        }
        finally {
            setBusy(false);
        }
    };
    const uploadAsset = async (kind, file) => {
        if (!file) {
            return;
        }
        setBusy(true);
        try {
            const response = await api.uploadProfileAsset(kind, file);
            setProfile(withAssetOrigins(response.profile));
            setMessage(`${kind === "logo" ? "Logo" : "Signature"} uploaded.`);
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Upload failed.");
        }
        finally {
            setBusy(false);
        }
    };
    const handleDraftField = (field, value) => {
        setDraft((current) => ({
            ...current,
            [field]: value,
        }));
    };
    const handleClientField = (field, value) => {
        setDraft((current) => ({
            ...current,
            client: {
                ...current.client,
                [field]: field === "addressLines" ? value.split("\n") : value,
            },
        }));
    };
    const populateClientForm = (client) => {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to save current client.");
        }
        finally {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to save client.");
        }
        finally {
            setBusy(false);
        }
    };
    const deleteClient = async (clientId) => {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to delete client.");
        }
        finally {
            setBusy(false);
        }
    };
    const applyClientToDraft = (clientId) => {
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
    const updateItem = (itemId, field, value) => {
        setDraft((current) => ({
            ...current,
            items: current.items.map((item) => item.id === itemId
                ? {
                    ...item,
                    [field]: field === "quantity" || field === "unitPrice" ? Number(value) : value,
                }
                : item),
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
    const removeItem = (itemId) => {
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
    const selectInvoice = (invoice) => {
        setSelectedInvoiceId(invoice.id);
        setDraft(invoice.data);
        setStatus(invoice.status);
        setSourceFormat(invoice.sourceFormat);
        navigateTo("/invoice");
        setMessage(`Loaded ${invoice.data.invoiceNumber}.`);
    };
    const saveInvoice = async (nextStatus) => {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to save invoice.");
        }
        finally {
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
    const importInvoiceFile = async (file) => {
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
        }
        catch (caughtError) {
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
    const toggleShiftSelection = (shiftId) => {
        setSelectedShiftIds((current) => current.includes(shiftId) ? current.filter((id) => id !== shiftId) : [...current, shiftId]);
    };
    const handleClockIn = async () => {
        setBusy(true);
        setError("");
        try {
            const response = await api.clockIn();
            setShifts(response.shifts);
            setMessage("Shift started.");
            navigateTo("/clock");
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to clock in.");
        }
        finally {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to clock out.");
        }
        finally {
            setBusy(false);
        }
    };
    const handleStartBreak = async (type) => {
        if (!activeShift) {
            return;
        }
        setBusy(true);
        setError("");
        try {
            const response = await api.startBreak(activeShift.id, type);
            setShifts(response.shifts);
            setMessage(`${type} started.`);
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to start break.");
        }
        finally {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to end break.");
        }
        finally {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to save manual shift.");
        }
        finally {
            setBusy(false);
        }
    };
    const getShiftExportType = () => {
        const selectedShifts = completedShifts.filter((shift) => selectedShiftIds.includes(shift.id));
        return selectedShifts.some((shift) => shift.exports.length > 0) ? "re-export" : "initial-export";
    };
    const getShiftInvoiceOptions = () => {
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
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to hand off shifts to the invoice builder.");
        }
        finally {
            setBusy(false);
        }
    };
    const exportSelectedShifts = async (format) => {
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
            setMessage(format === "invoice"
                ? `Exported ${response.exportedCount} shift${response.exportedCount === 1 ? "" : "s"} as a compact .invoice file.`
                : `Exported ${response.exportedCount} shift${response.exportedCount === 1 ? "" : "s"} as CSV.`);
        }
        catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "Unable to export shifts.");
        }
        finally {
            setBusy(false);
        }
    };
    const pageTitle = currentRoute === "/"
        ? "Freelance Dashboard"
        : currentRoute === "/clock"
            ? "Timekeeper"
            : currentRoute === "/invoice"
                ? "Invoice Generator"
                : "Profile";
    const pageSubtitle = currentRoute === "/"
        ? "Choose a tool, keep your data together, and add more modules later."
        : currentRoute === "/clock"
            ? "Track work with the simple Clock Keeper flow, now inside the dashboard."
            : currentRoute === "/invoice"
                ? "Build, import, save, and export invoices from the same workspace."
                : "Manage your identity, payment details, and reusable clients.";
    if (!currentUser) {
        return (_jsx("main", { className: "auth-shell", children: _jsxs("section", { className: "auth-card", children: [_jsx("p", { className: "eyebrow", children: "Freelance Dashboard" }), _jsx("h1", { children: "One home for your invoices, time tracking, and whatever app comes next." }), _jsx("p", { className: "support-copy", children: "Create one account, then open Invoice Generator or Timekeeper from the dashboard." }), _jsxs("div", { className: "auth-toggle", children: [_jsx("button", { className: authMode === "register" ? "active" : "", onClick: () => setAuthMode("register"), children: "Register" }), _jsx("button", { className: authMode === "login" ? "active" : "", onClick: () => setAuthMode("login"), children: "Login" })] }), _jsxs("label", { children: ["Email", _jsx("input", { value: email, onChange: (event) => setEmail(event.target.value), placeholder: "you@example.com" })] }), _jsxs("label", { children: ["Password", _jsx("input", { type: "password", value: password, onChange: (event) => setPassword(event.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" })] }), error ? _jsx("div", { className: "status-banner status-banner--error", children: error }) : null, _jsx("button", { className: "primary-button", disabled: busy, onClick: handleAuth, children: busy ? "Working..." : authMode === "register" ? "Create account" : "Log in" })] }) }));
    }
    return (_jsxs("div", { className: `workspace-shell ${currentRoute === "/clock" ? `workspace-shell--clock workspace-shell--${clockStatus}` : ""}`, children: [_jsxs("header", { className: "workspace-header", children: [_jsxs("div", { className: "workspace-brand", children: [_jsx("p", { className: "eyebrow", children: "Freelance Dashboard" }), _jsx("h1", { children: pageTitle }), _jsx("p", { children: pageSubtitle })] }), _jsxs("div", { className: "workspace-header__stack", children: [_jsxs("nav", { className: "workspace-nav", children: [_jsx("button", { className: currentRoute === "/" ? "active" : "", onClick: () => navigateTo("/"), children: "Dashboard" }), _jsx("button", { className: currentRoute === "/invoice" ? "active" : "", onClick: () => navigateTo("/invoice"), children: "Invoice Generator" }), _jsx("button", { className: currentRoute === "/clock" ? "active" : "", onClick: () => navigateTo("/clock"), children: "Timekeeper" }), _jsx("button", { className: currentRoute === "/profile" ? "active" : "", onClick: () => navigateTo("/profile"), children: "Profile" })] }), _jsxs("div", { className: "workspace-actions", children: [_jsx("span", { className: "workspace-user", children: currentUser.email }), _jsx("button", { className: "secondary-button", onClick: resetDraft, children: "New invoice" }), _jsx("button", { className: "secondary-button", disabled: busy || Boolean(activeShift), onClick: () => void handleClockIn(), children: "Clock in" }), _jsx("button", { className: "text-button", onClick: logout, children: "Logout" })] })] })] }), error ? _jsx("div", { className: "status-banner status-banner--error", children: error }) : null, view === "dashboard" ? (_jsxs("section", { className: "dashboard-home", children: [_jsxs("article", { className: "panel dashboard-hero-panel", children: [_jsx("span", { className: "section-kicker", children: "Workspace Home" }), _jsx("h2", { children: "Freelance Dashboard" }), _jsx("p", { children: "Use one home for time tracking, invoices, reusable client settings, and whatever app you add next." }), _jsxs("div", { className: "stat-row", children: [_jsxs("div", { children: [_jsx("strong", { children: invoices.length }), _jsx("span", { children: "Saved invoices" })] }), _jsxs("div", { children: [_jsx("strong", { children: trackedHours.toFixed(2) }), _jsx("span", { children: "Tracked hours" })] }), _jsxs("div", { children: [_jsx("strong", { children: clients.length }), _jsx("span", { children: "Saved clients" })] })] })] }), _jsxs("div", { className: "dashboard-app-grid", children: [_jsxs("button", { className: "dashboard-app-card dashboard-app-card--invoice", onClick: () => navigateTo("/invoice"), children: [_jsx("span", { className: "section-kicker", children: "App 01" }), _jsx("h3", { children: "Invoice Generator" }), _jsx("p", { children: "Create, import, save, and export invoice drafts from a dedicated page." }), _jsx("strong", { children: selectedInvoiceId ? "Resume current draft" : "Open app" })] }), _jsxs("button", { className: "dashboard-app-card dashboard-app-card--clock", onClick: () => navigateTo("/clock"), children: [_jsx("span", { className: "section-kicker", children: "App 02" }), _jsx("h3", { children: "Timekeeper" }), _jsx("p", { children: "Keep the simple Clock Keeper flow, with its own page and cleaner separation from invoicing." }), _jsx("strong", { children: activeShift ? "Active shift running" : "Open app" })] }), _jsxs("button", { className: "dashboard-app-card dashboard-app-card--profile", onClick: () => navigateTo("/profile"), children: [_jsx("span", { className: "section-kicker", children: "Settings" }), _jsx("h3", { children: "Business Profile" }), _jsx("p", { children: "Store logos, payment details, and reusable client records that both apps can share." }), _jsx("strong", { children: "Manage profile" })] })] }), _jsxs("section", { className: "dashboard-grid", children: [_jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Imports" }), _jsx("h3", { children: "Bring in invoice data" }), _jsx("p", { children: "Import `.invoice`, CSV, or JSON files, or hand off selected shifts from Timekeeper into the invoice page." }), _jsxs("label", { className: "file-input", children: ["Import file", _jsx("input", { type: "file", accept: ".invoice,.csv,.json", onChange: (event) => void importInvoiceFile(event.target.files?.[0]) })] }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { className: "secondary-button", onClick: downloadInvoiceFormat, children: "Download current `.invoice`" }), _jsx("button", { className: "secondary-button", onClick: () => void copyClockKeeperLink(), children: "Copy import link" })] })] }), _jsxs("article", { className: "panel panel--full", children: [_jsxs("div", { className: "section-row", children: [_jsxs("div", { children: [_jsx("span", { className: "section-kicker", children: "Recent Invoices" }), _jsx("h3", { children: "Pick up where you left off" })] }), _jsx("button", { className: "secondary-button", onClick: () => navigateTo("/invoice"), children: "Open invoice app" })] }), _jsx("div", { className: "invoice-list", children: invoices.length ? (invoices.map((invoice) => {
                                            const invoiceSummary = calculateInvoiceSummary(invoice.data);
                                            return (_jsxs("button", { className: "invoice-list__card", onClick: () => selectInvoice(invoice), children: [_jsxs("div", { children: [_jsx("strong", { children: invoice.data.invoiceNumber }), _jsx("span", { children: invoice.data.client.name || "No client yet" })] }), _jsxs("div", { children: [_jsx("span", { children: invoice.status }), _jsxs("strong", { children: ["$", invoiceSummary.total.toFixed(2)] })] })] }, invoice.id));
                                        })) : (_jsx("p", { children: "No invoices yet. Open Invoice Generator to start your first draft." })) })] })] })] })) : null, view === "time" ? (_jsxs("section", { className: `timekeeper-page timekeeper-page--${clockStatus === "completed" ? "off" : clockStatus === "on-break" ? "break" : "on"}`, children: [_jsxs("article", { className: "time-card", children: [_jsxs("header", { className: "card-top", children: [_jsxs("div", { children: [_jsx("p", { className: "micro-label", children: "Timekeeper" }), _jsx("h2", { children: activeShift ? "Shift in progress" : "Ready when you are" })] }), _jsx("button", { className: "icon-btn", type: "button", "aria-label": "Open timekeeper settings", onClick: () => setTimeSettingsOpen(true), children: _jsx("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: _jsx("path", { d: "M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.4 7.4 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.22 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" }) }) })] }), _jsx("p", { className: "status-pill", children: clockStatus === "completed" ? "Off the clock" : clockStatus === "on-break" ? "On break" : "On the clock" }), _jsxs("div", { className: "clock-hero main-clock", children: [_jsxs("div", { className: "clock-illustration", children: [Array.from({ length: 12 }, (_, index) => (_jsx("span", { className: "tick", style: { "--rotation": `${index * 30}deg` } }, index))), _jsx("span", { className: "clock-hand hour-hand", style: { transform: `rotate(${clockHourRotation}deg)` } }), _jsx("span", { className: "clock-hand minute-hand", style: { transform: `rotate(${clockMinuteRotation}deg)` } }), _jsx("span", { className: "clock-hand second-hand", style: { transform: `rotate(${clockSecondRotation}deg)` } })] }), _jsx("div", { className: "clock-readout", children: formatClockReadout(clockNow) }), _jsx("h3", { className: "timekeeper-headline", children: activeShift ? (activeBreak ? activeBreak.type : "Shift running") : "Clock in fast. Export everything later." }), _jsx("p", { className: "status-subtext", children: activeShift
                                            ? activeBreak
                                                ? `Break started ${formatShiftDateTime(activeBreak.startAt)}.`
                                                : `Started ${formatShiftDateTime(activeShift.clockInAt)}.`
                                            : "Start a shift, then open settings to add missed work or export entries." })] }), _jsxs("div", { className: "metric-row", children: [_jsxs("div", { className: "metric-chip", children: [_jsx("span", { children: "Shift" }), _jsx("strong", { children: formatDuration(activeShiftMinutes) })] }), _jsxs("div", { className: "metric-chip", children: [_jsx("span", { children: "Break" }), _jsx("strong", { children: formatDuration(activeBreakMinutes) })] })] }), _jsxs("div", { className: "action-stack", children: [_jsxs("div", { className: "primary-actions", children: [_jsx("button", { className: "primary-btn", disabled: busy || Boolean(activeShift), onClick: () => void handleClockIn(), children: "Clock In" }), _jsx("button", { className: "primary-btn", disabled: busy || !activeShift, onClick: () => void handleClockOut(), children: "Clock Out" })] }), _jsxs("div", { className: "secondary-actions", children: [_jsx("button", { className: "secondary-btn", disabled: busy || !activeShift || Boolean(activeBreak), onClick: () => void handleStartBreak("Lunch"), children: "Lunch" }), _jsx("button", { className: "secondary-btn", disabled: busy || !activeShift || Boolean(activeBreak), onClick: () => void handleStartBreak("Short Break"), children: "Short Break" }), _jsx("button", { className: "secondary-btn", disabled: busy || !activeBreak, onClick: () => void handleEndBreak(), children: "End Break" })] })] }), _jsx("p", { className: "feedback center-feedback", children: message }), activeShift ? (_jsx("section", { className: "detail-panel", children: _jsxs("label", { className: "panel-label", children: ["Shift Notes", _jsx("textarea", { rows: 5, value: activeShiftNotes, onChange: (event) => setActiveShiftNotes(event.target.value), placeholder: "Add notes for this shift, job site, or client" })] }) })) : null, _jsxs("section", { className: "detail-panel", children: [_jsxs("div", { className: "panel-heading-row", children: [_jsxs("div", { children: [_jsx("p", { className: "micro-label", children: "Previous Shifts" }), _jsx("h3", { className: "panel-title", children: "Recent completed entries" })] }), _jsx("button", { className: "text-btn", type: "button", onClick: () => setTimeSettingsOpen(true), children: "Open Settings" })] }), _jsx("div", { className: "recent-list", children: recentCompletedShifts.length ? (recentCompletedShifts.map((shift) => (_jsxs("div", { className: "timeline-card", children: [_jsxs("div", { className: "entry-topline", children: [_jsx("strong", { children: shift.notes || "Tracked shift" }), _jsxs("span", { children: [formatShiftHours(shift), " hrs"] })] }), _jsxs("div", { className: "entry-meta", children: [formatShiftDateTime(shift.clockInAt), shift.clockOutAt ? ` to ${formatShiftDateTime(shift.clockOutAt)}` : ""] })] }, shift.id)))) : (_jsx("div", { className: "empty-state", children: "No completed shifts yet." })) })] })] }), _jsx("div", { className: `settings-scrim ${timeSettingsOpen ? "" : "hidden"}`, onClick: () => setTimeSettingsOpen(false) }), _jsxs("aside", { className: `settings-drawer ${timeSettingsOpen ? "" : "hidden"}`, "aria-hidden": !timeSettingsOpen, children: [_jsxs("div", { className: "settings-header", children: [_jsxs("div", { children: [_jsx("p", { className: "micro-label", children: "Account" }), _jsx("h3", { children: "Settings and exports" })] }), _jsx("button", { className: "text-btn", type: "button", onClick: () => setTimeSettingsOpen(false), children: "Close" })] }), _jsxs("section", { className: "settings-section", children: [_jsx("h4", { children: "Workspace" }), _jsx("p", { className: "muted-text", children: "Timekeeper now lives as its own page inside Freelance Dashboard, while still sharing your account and invoice data." }), _jsxs("div", { className: "stacked-actions", children: [_jsx("button", { className: "secondary-btn full-width", type: "button", onClick: () => navigateTo("/invoice"), children: "Open Invoice Generator" }), _jsx("button", { className: "ghost-btn full-width", type: "button", onClick: () => navigateTo("/profile"), children: "Open Profile" })] })] }), _jsxs("section", { className: "settings-section", children: [_jsx("div", { className: "panel-heading-row", children: _jsxs("div", { children: [_jsx("h4", { children: "Add Missed Shift" }), _jsx("p", { className: "muted-text", children: "Create a completed past shift before exporting payroll or invoice data." })] }) }), _jsxs("div", { className: "stacked-actions", children: [_jsxs("label", { children: ["Start time", _jsx("input", { type: "datetime-local", value: manualShiftForm.startAt, onChange: (event) => setManualShiftForm((current) => ({ ...current, startAt: event.target.value })) })] }), _jsxs("label", { children: ["End time", _jsx("input", { type: "datetime-local", value: manualShiftForm.endAt, onChange: (event) => setManualShiftForm((current) => ({ ...current, endAt: event.target.value })) })] }), _jsxs("label", { children: ["Break minutes", _jsx("input", { type: "number", min: "0", value: manualShiftForm.breakMinutes, onChange: (event) => setManualShiftForm((current) => ({ ...current, breakMinutes: event.target.value })) })] }), _jsxs("label", { children: ["Shift notes", _jsx("textarea", { rows: 3, value: manualShiftForm.notes, onChange: (event) => setManualShiftForm((current) => ({ ...current, notes: event.target.value })), placeholder: "Optional task or work description" })] }), _jsx("button", { className: "primary-btn full-width", type: "button", disabled: busy, onClick: () => void handleManualShiftSave(), children: "Save Missed Shift" })] })] }), _jsxs("section", { className: "settings-section", children: [_jsx("div", { className: "panel-heading-row", children: _jsxs("div", { children: [_jsx("h4", { children: "Export Completed Shifts" }), _jsx("p", { className: "muted-text", children: "Select completed entries to export as CSV or `.invoice`, or send them straight into Invoice Generator." })] }) }), _jsxs("div", { className: "stacked-actions", children: [_jsxs("div", { className: "button-pair", children: [_jsx("button", { className: "secondary-btn", type: "button", disabled: busy || selectedShiftIds.length === 0, onClick: () => void exportSelectedShifts("csv"), children: "Export CSV" }), _jsx("button", { className: "secondary-btn", type: "button", disabled: busy || selectedShiftIds.length === 0, onClick: () => void exportSelectedShifts("invoice"), children: "Export `.invoice`" })] }), _jsx("button", { className: "primary-btn full-width", type: "button", disabled: busy || selectedShiftIds.length === 0, onClick: () => void createInvoiceFromSelectedShifts(), children: "Create invoice draft" })] }), _jsx("div", { className: "selection-list", children: completedShifts.length ? (completedShifts.map((shift) => {
                                            const selected = selectedShiftIds.includes(shift.id);
                                            return (_jsxs("label", { className: "selection-card", children: [_jsxs("div", { className: "checkbox-row", children: [_jsx("input", { type: "checkbox", checked: selected, onChange: () => toggleShiftSelection(shift.id) }), _jsx("strong", { children: shift.notes || "Tracked shift" }), _jsxs("span", { children: [formatShiftHours(shift), " hrs"] })] }), _jsx("div", { className: "entry-meta", children: formatShiftDateTime(shift.clockInAt) })] }, shift.id));
                                        })) : (_jsx("div", { className: "empty-state", children: "No completed shifts available to export yet." })) })] })] })] })) : null, view === "profile" && profile ? (_jsxs("section", { className: "workspace-grid", children: [_jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Business Identity" }), _jsxs("label", { children: ["Display Name", _jsx("input", { value: profile.displayName, onChange: (event) => handleProfileField("displayName", event.target.value) })] }), _jsxs("label", { children: ["Business Name", _jsx("input", { value: profile.businessName, onChange: (event) => handleProfileField("businessName", event.target.value) })] }), _jsxs("label", { children: ["Business Email", _jsx("input", { value: profile.email, onChange: (event) => handleProfileField("email", event.target.value) })] }), _jsxs("label", { children: ["Address", _jsx("textarea", { rows: 4, value: profile.addressLines.join("\n"), onChange: (event) => updateProfileAddress(event.target.value) })] }), _jsxs("div", { className: "file-row", children: [_jsxs("label", { className: "file-input", children: ["Upload logo", _jsx("input", { type: "file", accept: "image/*", onChange: (event) => void uploadAsset("logo", event.target.files?.[0]) })] }), _jsxs("label", { className: "file-input", children: ["Upload signature", _jsx("input", { type: "file", accept: "image/*", onChange: (event) => void uploadAsset("signature", event.target.files?.[0]) })] })] })] }), _jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Payment Details" }), _jsxs("label", { children: ["Primary Payment Label", _jsx("input", { value: profile.paymentPrimary.label, onChange: (event) => setProfile((current) => current
                                            ? {
                                                ...current,
                                                paymentPrimary: {
                                                    ...current.paymentPrimary,
                                                    label: event.target.value,
                                                },
                                            }
                                            : current) })] }), _jsxs("label", { children: ["Primary Payment Details", _jsx("textarea", { rows: 6, value: profile.paymentPrimary.details.join("\n"), onChange: (event) => updatePaymentDetails("paymentPrimary", event.target.value) })] }), _jsxs("label", { children: ["Secondary Payment Label", _jsx("input", { value: profile.paymentSecondary.label, onChange: (event) => setProfile((current) => current
                                            ? {
                                                ...current,
                                                paymentSecondary: {
                                                    ...current.paymentSecondary,
                                                    label: event.target.value,
                                                },
                                            }
                                            : current) })] }), _jsxs("label", { children: ["Secondary Payment Details", _jsx("textarea", { rows: 6, value: profile.paymentSecondary.details.join("\n"), onChange: (event) => updatePaymentDetails("paymentSecondary", event.target.value) })] }), _jsx("button", { className: "primary-button", disabled: busy, onClick: () => void saveProfile(), children: "Save profile" })] }), _jsxs("article", { className: "panel panel--full", children: [_jsxs("div", { className: "section-row", children: [_jsxs("div", { children: [_jsx("span", { className: "section-kicker", children: "Saved Clients" }), _jsx("h3", { children: "Reusable client records" })] }), _jsx("button", { className: "secondary-button", onClick: resetClientForm, children: "New client" })] }), _jsxs("div", { className: "saved-clients-grid", children: [_jsx("div", { className: "saved-client-list", children: clients.length ? (clients.map((client) => (_jsxs("div", { className: "saved-client-card", children: [_jsxs("button", { className: "saved-client-card__main", onClick: () => populateClientForm(client), children: [_jsx("strong", { children: client.nickname || client.name }), _jsx("span", { children: client.businessName || client.email || "Saved client" })] }), _jsxs("div", { className: "saved-client-card__actions", children: [_jsx("button", { className: "secondary-button", onClick: () => applyClientToDraft(client.id), children: "Use in invoice" }), _jsx("button", { className: "text-button", onClick: () => void deleteClient(client.id), children: "Delete" })] })] }, client.id)))) : (_jsx("p", { children: "No saved clients yet. Save one from an invoice or create one here." })) }), _jsxs("div", { className: "saved-client-form", children: [_jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Nickname", _jsx("input", { value: clientForm.nickname, onChange: (event) => setClientForm((current) => ({ ...current, nickname: event.target.value })), placeholder: "Acme retainer" })] }), _jsxs("label", { children: ["Client Name", _jsx("input", { value: clientForm.name, onChange: (event) => setClientForm((current) => ({ ...current, name: event.target.value })) })] }), _jsxs("label", { children: ["Business Name", _jsx("input", { value: clientForm.businessName, onChange: (event) => setClientForm((current) => ({ ...current, businessName: event.target.value })) })] }), _jsxs("label", { children: ["Client Email", _jsx("input", { value: clientForm.email, onChange: (event) => setClientForm((current) => ({ ...current, email: event.target.value })) })] }), _jsxs("label", { className: "full-width", children: ["Address", _jsx("textarea", { rows: 4, value: clientForm.addressLines, onChange: (event) => setClientForm((current) => ({ ...current, addressLines: event.target.value })) })] }), _jsxs("label", { className: "full-width", children: ["Notes", _jsx("textarea", { rows: 3, value: clientForm.notes, onChange: (event) => setClientForm((current) => ({ ...current, notes: event.target.value })) })] })] }), _jsxs("div", { className: "action-row", children: [_jsx("button", { className: "primary-button", disabled: busy, onClick: () => void saveClient(), children: clientForm.id ? "Update client" : "Save client" }), _jsx("button", { className: "secondary-button", onClick: resetClientForm, children: "Clear form" })] })] })] })] })] })) : null, view === "invoice" ? (_jsxs("section", { className: "workspace-grid", children: [_jsxs("article", { className: "panel panel--form", children: [_jsxs("div", { className: "panel-heading", children: [_jsxs("div", { children: [_jsx("span", { className: "section-kicker", children: "Invoice Form" }), _jsx("h3", { children: "Edit data, then preview beside it" })] }), _jsxs("label", { className: "file-input", children: ["Import file", _jsx("input", { type: "file", accept: ".invoice,.csv,.json", onChange: (event) => void importInvoiceFile(event.target.files?.[0]) })] })] }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Invoice Number", _jsx("input", { value: draft.invoiceNumber, onChange: (event) => handleDraftField("invoiceNumber", event.target.value) })] }), _jsxs("label", { children: ["Template", _jsx("select", { value: draft.templateId, onChange: (event) => handleDraftField("templateId", event.target.value), children: templates.map((template) => (_jsx("option", { value: template.id, children: template.name }, template.id))) })] }), _jsxs("label", { children: ["Issue Date", _jsx("input", { type: "date", value: draft.issueDate, onChange: (event) => handleDraftField("issueDate", event.target.value) })] }), _jsxs("label", { children: ["Due Date", _jsx("input", { type: "date", value: draft.dueDate, onChange: (event) => handleDraftField("dueDate", event.target.value) })] }), _jsxs("label", { children: ["Currency", _jsx("input", { value: draft.currency, onChange: (event) => handleDraftField("currency", event.target.value.toUpperCase()) })] }), _jsxs("label", { children: ["Project", _jsx("input", { value: draft.projectName ?? "", onChange: (event) => handleDraftField("projectName", event.target.value) })] })] }), _jsxs("div", { className: "section-block", children: [_jsxs("div", { className: "section-row", children: [_jsx("span", { className: "section-kicker", children: "Client" }), _jsxs("div", { className: "inline-actions", children: [_jsxs("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), children: [_jsx("option", { value: "", children: "Select saved client" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.nickname || client.name }, client.id)))] }), _jsx("button", { className: "secondary-button", disabled: !selectedClientId, onClick: () => applyClientToDraft(selectedClientId), children: "Load client" }), _jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void saveCurrentClientToLibrary(), children: "Save current client" })] })] }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Client Name", _jsx("input", { value: draft.client.name, onChange: (event) => handleClientField("name", event.target.value) })] }), _jsxs("label", { children: ["Business Name", _jsx("input", { value: draft.client.businessName ?? "", onChange: (event) => handleClientField("businessName", event.target.value) })] }), _jsxs("label", { children: ["Client Email", _jsx("input", { value: draft.client.email ?? "", onChange: (event) => handleClientField("email", event.target.value) })] }), _jsxs("label", { className: "full-width", children: ["Client Address", _jsx("textarea", { rows: 3, value: draft.client.addressLines.join("\n"), onChange: (event) => handleClientField("addressLines", event.target.value) })] })] })] }), _jsxs("div", { className: "section-block", children: [_jsxs("div", { className: "section-row", children: [_jsx("span", { className: "section-kicker", children: "Items" }), _jsx("button", { className: "secondary-button", onClick: addItem, children: "Add item" })] }), draft.items.map((item) => (_jsxs("div", { className: "item-card", children: [_jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Task", _jsx("input", { value: item.task, onChange: (event) => updateItem(item.id, "task", event.target.value) })] }), _jsxs("label", { children: ["Description", _jsx("input", { value: item.description ?? "", onChange: (event) => updateItem(item.id, "description", event.target.value) })] }), _jsxs("label", { children: ["Quantity", _jsx("input", { type: "number", min: "0", step: "0.01", value: item.quantity, onChange: (event) => updateItem(item.id, "quantity", event.target.value) })] }), _jsxs("label", { children: ["Unit Price", _jsx("input", { type: "number", min: "0", step: "0.01", value: item.unitPrice, onChange: (event) => updateItem(item.id, "unitPrice", event.target.value) })] }), _jsxs("label", { children: ["Unit Label", _jsx("input", { value: item.unitLabel ?? "", onChange: (event) => updateItem(item.id, "unitLabel", event.target.value) })] }), _jsxs("label", { children: ["Date", _jsx("input", { type: "date", value: item.date ?? "", onChange: (event) => updateItem(item.id, "date", event.target.value) })] }), _jsxs("label", { className: "full-width", children: ["Notes", _jsx("input", { value: item.notes ?? "", onChange: (event) => updateItem(item.id, "notes", event.target.value) })] })] }), _jsx("button", { className: "text-button", onClick: () => removeItem(item.id), children: "Remove item" })] }, item.id)))] }), _jsxs("div", { className: "section-block", children: [_jsx("span", { className: "section-kicker", children: "Summary" }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Tax Rate %", _jsx("input", { type: "number", min: "0", step: "0.01", value: draft.taxRate ?? 0, onChange: (event) => handleDraftField("taxRate", Number(event.target.value)) })] }), _jsxs("label", { children: ["Discount Amount", _jsx("input", { type: "number", min: "0", step: "0.01", value: draft.discountAmount ?? 0, onChange: (event) => handleDraftField("discountAmount", Number(event.target.value)) })] }), _jsxs("label", { className: "full-width", children: ["Invoice Notes", _jsx("textarea", { rows: 4, value: draft.notes ?? "", onChange: (event) => handleDraftField("notes", event.target.value) })] })] }), _jsxs("div", { className: "summary-strip", children: [_jsxs("span", { children: ["Subtotal: $", summary.subtotal.toFixed(2)] }), _jsxs("span", { children: ["Tax: $", summary.taxAmount.toFixed(2)] }), _jsxs("span", { children: ["Total: $", summary.total.toFixed(2)] })] })] }), _jsxs("div", { className: "action-row", children: [_jsx("button", { className: "primary-button", disabled: busy, onClick: () => void saveInvoice("draft"), children: "Save draft" }), _jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void saveInvoice("finalized"), children: "Finalize invoice" }), _jsx("button", { className: "secondary-button", onClick: exportPdf, children: "Export PDF" }), _jsx("button", { className: "secondary-button", onClick: downloadInvoiceFormat, children: "Export `.invoice`" }), _jsx("button", { className: "secondary-button", onClick: () => void copyClockKeeperLink(), children: "Copy import link" })] })] }), _jsx(InvoicePreview, { draft: draft, profile: resolvedProfile })] })) : null] }));
};
export default App;
