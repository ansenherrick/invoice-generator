import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { calculateInvoiceSummary, calculateShiftWorkedMinutes, createEmptyInvoiceDraft, createEmptyProfile, decodeInvoicePayload, encodeInvoicePayload, exportCompactInvoice, getShiftStatus, parseInvoiceFile, } from "@invoice/shared";
import { api } from "./api/client";
import { InvoicePreview } from "./components/InvoicePreview";
import { exportElementToPdf } from "./utils/pdf";
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
    const [view, setView] = useState("dashboard");
    const [templates, setTemplates] = useState([]);
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
    const trackedHours = useMemo(() => shifts.reduce((total, shift) => total + calculateShiftWorkedMinutes(shift) / 60, 0), [shifts]);
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
                setView("invoice");
                setMessage("Imported draft from Clock Keeper. Review it and save when ready.");
                localStorage.removeItem(pendingImportKey);
            }
            else {
                setView("dashboard");
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
            setView("profile");
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
        setView("invoice");
        setMessage("Fresh invoice draft ready.");
    };
    const selectInvoice = (invoice) => {
        setSelectedInvoiceId(invoice.id);
        setDraft(invoice.data);
        setStatus(invoice.status);
        setSourceFormat(invoice.sourceFormat);
        setView("invoice");
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
            setView("invoice");
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
            setView("time");
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
            setView("time");
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
            setView("invoice");
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
    if (!currentUser) {
        return (_jsx("main", { className: "auth-shell", children: _jsxs("section", { className: "auth-card", children: [_jsx("p", { className: "eyebrow", children: "Freelance Invoice Generator" }), _jsx("h1", { children: "Minimal invoicing, reusable account settings, and draft saving." }), _jsx("p", { className: "support-copy", children: "Create one account, track shifts, reuse payment settings, and turn recorded work into invoices." }), _jsxs("div", { className: "auth-toggle", children: [_jsx("button", { className: authMode === "register" ? "active" : "", onClick: () => setAuthMode("register"), children: "Register" }), _jsx("button", { className: authMode === "login" ? "active" : "", onClick: () => setAuthMode("login"), children: "Login" })] }), _jsxs("label", { children: ["Email", _jsx("input", { value: email, onChange: (event) => setEmail(event.target.value), placeholder: "you@example.com" })] }), _jsxs("label", { children: ["Password", _jsx("input", { type: "password", value: password, onChange: (event) => setPassword(event.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" })] }), error ? _jsx("div", { className: "status-banner status-banner--error", children: error }) : null, _jsx("button", { className: "primary-button", disabled: busy, onClick: handleAuth, children: busy ? "Working..." : authMode === "register" ? "Create account" : "Log in" })] }) }));
    }
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Invoice Studio" }), _jsx("h2", { children: currentUser.email })] }), _jsxs("nav", { className: "sidebar-nav", children: [_jsx("button", { className: view === "dashboard" ? "active" : "", onClick: () => setView("dashboard"), children: "Dashboard" }), _jsx("button", { className: view === "time" ? "active" : "", onClick: () => setView("time"), children: "Time Tracker" }), _jsx("button", { className: view === "invoice" ? "active" : "", onClick: () => setView("invoice"), children: "Invoice Builder" }), _jsx("button", { className: view === "profile" ? "active" : "", onClick: () => setView("profile"), children: "Profile" })] }), _jsxs("div", { className: "sidebar-actions", children: [_jsx("button", { className: "sidebar-action sidebar-action--new", onClick: resetDraft, children: "New invoice" }), _jsx("button", { className: "sidebar-action", disabled: busy, onClick: () => void handleClockIn(), children: "Clock in" }), _jsx("button", { className: "sidebar-action sidebar-action--logout", onClick: logout, children: "Logout" })] })] }), _jsxs("main", { className: "main-shell", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("h1", { children: view === "dashboard" ? "Dashboard" : view === "profile" ? "Profile" : view === "time" ? "Time Tracker" : "Invoice Builder" }), _jsx("p", { children: message })] }), error ? _jsx("div", { className: "status-banner status-banner--error", children: error }) : null] }), view === "dashboard" ? (_jsxs("section", { className: "dashboard-grid", children: [_jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Workspace" }), _jsxs("h3", { children: [invoices.length, " saved invoice", invoices.length === 1 ? "" : "s"] }), _jsx("p", { children: "Drafts stay editable, finalized invoices stay reusable, and your payment settings stay attached to your account." }), _jsxs("div", { className: "stat-row", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["$", summary.total.toFixed(2)] }), _jsx("span", { children: "Current draft total" })] }), _jsxs("div", { children: [_jsx("strong", { children: trackedHours.toFixed(2) }), _jsx("span", { children: "Tracked hours" })] }), _jsxs("div", { children: [_jsx("strong", { children: clients.length }), _jsx("span", { children: "Saved clients" })] })] })] }), _jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Import" }), _jsx("h3", { children: "Bring in outside invoice data" }), _jsx("p", { children: "Import `.invoice`, CSV, or JSON files, or build new invoice drafts directly from tracked shifts in the Time Tracker." }), _jsxs("label", { className: "file-input", children: ["Import file", _jsx("input", { type: "file", accept: ".invoice,.csv,.json", onChange: (event) => void importInvoiceFile(event.target.files?.[0]) })] }), _jsx("button", { className: "secondary-button", onClick: downloadInvoiceFormat, children: "Download current `.invoice`" }), _jsx("button", { className: "secondary-button", onClick: () => void copyClockKeeperLink(), children: "Copy import link" })] }), _jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Time Tracker" }), _jsxs("h3", { children: [completedShifts.length, " completed shift", completedShifts.length === 1 ? "" : "s"] }), _jsx("p", { children: "Clock live work, add manual entries, then send selected shifts straight into the invoice builder." }), _jsxs("div", { className: "stat-row stat-row--compact", children: [_jsxs("div", { children: [_jsx("strong", { children: activeShift ? "Live" : "Idle" }), _jsx("span", { children: "Current tracker status" })] }), _jsxs("div", { children: [_jsx("strong", { children: shifts.length }), _jsx("span", { children: "Total shifts" })] })] }), _jsx("button", { className: "secondary-button", onClick: () => setView("time"), children: "Open time tracker" })] }), _jsxs("article", { className: "panel panel--full", children: [_jsx("span", { className: "section-kicker", children: "Saved Invoices" }), _jsx("div", { className: "invoice-list", children: invoices.length ? (invoices.map((invoice) => {
                                            const invoiceSummary = calculateInvoiceSummary(invoice.data);
                                            return (_jsxs("button", { className: "invoice-list__card", onClick: () => selectInvoice(invoice), children: [_jsxs("div", { children: [_jsx("strong", { children: invoice.data.invoiceNumber }), _jsx("span", { children: invoice.data.client.name || "No client yet" })] }), _jsxs("div", { children: [_jsx("span", { children: invoice.status }), _jsxs("strong", { children: ["$", invoiceSummary.total.toFixed(2)] })] })] }, invoice.id));
                                        })) : (_jsx("p", { children: "No invoices yet. Create one or import from Clock Keeper." })) })] })] })) : null, view === "time" ? (_jsxs("section", { className: "workspace-grid", children: [_jsxs("article", { className: "panel", children: [_jsxs("div", { className: "section-row", children: [_jsxs("div", { children: [_jsx("span", { className: "section-kicker", children: "Shift Controls" }), _jsx("h3", { children: activeShift ? "Active shift running" : "No active shift" })] }), _jsx("span", { className: `shift-status-pill shift-status-pill--${activeShift ? getShiftStatus(activeShift) : "completed"}`, children: activeShift ? getShiftStatus(activeShift).replace("-", " ") : "idle" })] }), activeShift ? (_jsxs(_Fragment, { children: [_jsxs("p", { children: ["Started ", formatShiftDateTime(activeShift.clockInAt), "."] }), activeBreak ? (_jsxs("div", { className: "status-banner shift-inline-banner", children: [_jsx("strong", { children: activeBreak.type }), _jsxs("span", { children: ["Started ", formatShiftDateTime(activeBreak.startAt)] })] })) : null, _jsxs("label", { children: ["Shift notes", _jsx("textarea", { rows: 3, value: activeShiftNotes, onChange: (event) => setActiveShiftNotes(event.target.value), placeholder: "Optional notes for this completed shift" })] }), _jsxs("div", { className: "action-row", children: [activeBreak ? (_jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void handleEndBreak(), children: "End break" })) : (_jsxs(_Fragment, { children: [_jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void handleStartBreak("Short Break"), children: "Short break" }), _jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void handleStartBreak("Lunch"), children: "Lunch" })] })), _jsx("button", { className: "primary-button", disabled: busy, onClick: () => void handleClockOut(), children: "Clock out" })] })] })) : (_jsx("div", { className: "action-row", children: _jsx("button", { className: "primary-button", disabled: busy, onClick: () => void handleClockIn(), children: "Clock in now" }) }))] }), _jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Manual Entry" }), _jsx("h3", { children: "Add past work" }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Start", _jsx("input", { type: "datetime-local", value: manualShiftForm.startAt, onChange: (event) => setManualShiftForm((current) => ({ ...current, startAt: event.target.value })) })] }), _jsxs("label", { children: ["End", _jsx("input", { type: "datetime-local", value: manualShiftForm.endAt, onChange: (event) => setManualShiftForm((current) => ({ ...current, endAt: event.target.value })) })] }), _jsxs("label", { children: ["Break Minutes", _jsx("input", { type: "number", min: "0", value: manualShiftForm.breakMinutes, onChange: (event) => setManualShiftForm((current) => ({ ...current, breakMinutes: event.target.value })) })] }), _jsxs("label", { children: ["Notes", _jsx("input", { value: manualShiftForm.notes, onChange: (event) => setManualShiftForm((current) => ({ ...current, notes: event.target.value })), placeholder: "Homepage revisions" })] })] }), _jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void handleManualShiftSave(), children: "Save manual shift" })] }), _jsxs("article", { className: "panel panel--full", children: [_jsxs("div", { className: "section-row", children: [_jsxs("div", { children: [_jsx("span", { className: "section-kicker", children: "Tracked Shifts" }), _jsx("h3", { children: "Select completed shifts to invoice" })] }), _jsxs("div", { className: "inline-actions", children: [_jsx("button", { className: "secondary-button", disabled: busy || selectedShiftIds.length === 0, onClick: () => void exportSelectedShifts("csv"), children: "Export CSV" }), _jsx("button", { className: "secondary-button", disabled: busy || selectedShiftIds.length === 0, onClick: () => void exportSelectedShifts("invoice"), children: "Export `.invoice`" }), _jsx("button", { className: "primary-button", disabled: busy || selectedShiftIds.length === 0, onClick: () => void createInvoiceFromSelectedShifts(), children: "Create invoice draft" })] })] }), _jsx("div", { className: "shift-list", children: shifts.length ? (shifts.map((shift) => {
                                            const isCompleted = Boolean(shift.clockOutAt);
                                            const selected = selectedShiftIds.includes(shift.id);
                                            return (_jsxs("label", { className: `shift-card ${selected ? "shift-card--selected" : ""}`, children: [_jsx("div", { className: "shift-card__select", children: _jsx("input", { type: "checkbox", checked: selected, disabled: !isCompleted, onChange: () => toggleShiftSelection(shift.id) }) }), _jsxs("div", { className: "shift-card__body", children: [_jsxs("div", { className: "section-row", children: [_jsx("strong", { children: shift.notes || "Tracked shift" }), _jsx("span", { className: `shift-status-pill shift-status-pill--${getShiftStatus(shift)}`, children: getShiftStatus(shift).replace("-", " ") })] }), _jsxs("div", { className: "shift-card__meta", children: [_jsx("span", { children: formatShiftDateTime(shift.clockInAt) }), _jsx("span", { children: shift.clockOutAt ? formatShiftDateTime(shift.clockOutAt) : "Still running" }), _jsxs("span", { children: [formatShiftHours(shift), " hours"] })] }), shift.breaks.length ? (_jsx("div", { className: "shift-break-list", children: shift.breaks.map((entry) => (_jsxs("span", { children: [entry.type, ": ", formatShiftDateTime(entry.startAt), entry.endAt ? ` to ${formatShiftDateTime(entry.endAt)}` : " to active"] }, entry.id))) })) : null] })] }, shift.id));
                                        })) : (_jsx("p", { children: "No shifts yet. Clock in or add a manual entry to start building the merged workspace." })) })] })] })) : null, view === "profile" && profile ? (_jsxs("section", { className: "workspace-grid", children: [_jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Business Identity" }), _jsxs("label", { children: ["Display Name", _jsx("input", { value: profile.displayName, onChange: (event) => handleProfileField("displayName", event.target.value) })] }), _jsxs("label", { children: ["Business Name", _jsx("input", { value: profile.businessName, onChange: (event) => handleProfileField("businessName", event.target.value) })] }), _jsxs("label", { children: ["Business Email", _jsx("input", { value: profile.email, onChange: (event) => handleProfileField("email", event.target.value) })] }), _jsxs("label", { children: ["Address", _jsx("textarea", { rows: 4, value: profile.addressLines.join("\n"), onChange: (event) => updateProfileAddress(event.target.value) })] }), _jsxs("div", { className: "file-row", children: [_jsxs("label", { className: "file-input", children: ["Upload logo", _jsx("input", { type: "file", accept: "image/*", onChange: (event) => void uploadAsset("logo", event.target.files?.[0]) })] }), _jsxs("label", { className: "file-input", children: ["Upload signature", _jsx("input", { type: "file", accept: "image/*", onChange: (event) => void uploadAsset("signature", event.target.files?.[0]) })] })] })] }), _jsxs("article", { className: "panel", children: [_jsx("span", { className: "section-kicker", children: "Payment Details" }), _jsxs("label", { children: ["Primary Payment Label", _jsx("input", { value: profile.paymentPrimary.label, onChange: (event) => setProfile((current) => current
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
                                                    : current) })] }), _jsxs("label", { children: ["Secondary Payment Details", _jsx("textarea", { rows: 6, value: profile.paymentSecondary.details.join("\n"), onChange: (event) => updatePaymentDetails("paymentSecondary", event.target.value) })] }), _jsx("button", { className: "primary-button", disabled: busy, onClick: () => void saveProfile(), children: "Save profile" })] }), _jsxs("article", { className: "panel panel--full", children: [_jsxs("div", { className: "section-row", children: [_jsxs("div", { children: [_jsx("span", { className: "section-kicker", children: "Saved Clients" }), _jsx("h3", { children: "Reusable client records" })] }), _jsx("button", { className: "secondary-button", onClick: resetClientForm, children: "New client" })] }), _jsxs("div", { className: "saved-clients-grid", children: [_jsx("div", { className: "saved-client-list", children: clients.length ? (clients.map((client) => (_jsxs("div", { className: "saved-client-card", children: [_jsxs("button", { className: "saved-client-card__main", onClick: () => populateClientForm(client), children: [_jsx("strong", { children: client.nickname || client.name }), _jsx("span", { children: client.businessName || client.email || "Saved client" })] }), _jsxs("div", { className: "saved-client-card__actions", children: [_jsx("button", { className: "secondary-button", onClick: () => applyClientToDraft(client.id), children: "Use in invoice" }), _jsx("button", { className: "text-button", onClick: () => void deleteClient(client.id), children: "Delete" })] })] }, client.id)))) : (_jsx("p", { children: "No saved clients yet. Save one from an invoice or create one here." })) }), _jsxs("div", { className: "saved-client-form", children: [_jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Nickname", _jsx("input", { value: clientForm.nickname, onChange: (event) => setClientForm((current) => ({ ...current, nickname: event.target.value })), placeholder: "Acme retainer" })] }), _jsxs("label", { children: ["Client Name", _jsx("input", { value: clientForm.name, onChange: (event) => setClientForm((current) => ({ ...current, name: event.target.value })) })] }), _jsxs("label", { children: ["Business Name", _jsx("input", { value: clientForm.businessName, onChange: (event) => setClientForm((current) => ({ ...current, businessName: event.target.value })) })] }), _jsxs("label", { children: ["Client Email", _jsx("input", { value: clientForm.email, onChange: (event) => setClientForm((current) => ({ ...current, email: event.target.value })) })] }), _jsxs("label", { className: "full-width", children: ["Address", _jsx("textarea", { rows: 4, value: clientForm.addressLines, onChange: (event) => setClientForm((current) => ({ ...current, addressLines: event.target.value })) })] }), _jsxs("label", { className: "full-width", children: ["Notes", _jsx("textarea", { rows: 3, value: clientForm.notes, onChange: (event) => setClientForm((current) => ({ ...current, notes: event.target.value })) })] })] }), _jsxs("div", { className: "action-row", children: [_jsx("button", { className: "primary-button", disabled: busy, onClick: () => void saveClient(), children: clientForm.id ? "Update client" : "Save client" }), _jsx("button", { className: "secondary-button", onClick: resetClientForm, children: "Clear form" })] })] })] })] })] })) : null, view === "invoice" ? (_jsxs("section", { className: "workspace-grid", children: [_jsxs("article", { className: "panel panel--form", children: [_jsxs("div", { className: "panel-heading", children: [_jsxs("div", { children: [_jsx("span", { className: "section-kicker", children: "Invoice Form" }), _jsx("h3", { children: "Edit data, then preview beside it" })] }), _jsxs("label", { className: "file-input", children: ["Import file", _jsx("input", { type: "file", accept: ".invoice,.csv,.json", onChange: (event) => void importInvoiceFile(event.target.files?.[0]) })] })] }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Invoice Number", _jsx("input", { value: draft.invoiceNumber, onChange: (event) => handleDraftField("invoiceNumber", event.target.value) })] }), _jsxs("label", { children: ["Template", _jsx("select", { value: draft.templateId, onChange: (event) => handleDraftField("templateId", event.target.value), children: templates.map((template) => (_jsx("option", { value: template.id, children: template.name }, template.id))) })] }), _jsxs("label", { children: ["Issue Date", _jsx("input", { type: "date", value: draft.issueDate, onChange: (event) => handleDraftField("issueDate", event.target.value) })] }), _jsxs("label", { children: ["Due Date", _jsx("input", { type: "date", value: draft.dueDate, onChange: (event) => handleDraftField("dueDate", event.target.value) })] }), _jsxs("label", { children: ["Currency", _jsx("input", { value: draft.currency, onChange: (event) => handleDraftField("currency", event.target.value.toUpperCase()) })] }), _jsxs("label", { children: ["Project", _jsx("input", { value: draft.projectName ?? "", onChange: (event) => handleDraftField("projectName", event.target.value) })] })] }), _jsxs("div", { className: "section-block", children: [_jsxs("div", { className: "section-row", children: [_jsx("span", { className: "section-kicker", children: "Client" }), _jsxs("div", { className: "inline-actions", children: [_jsxs("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), children: [_jsx("option", { value: "", children: "Select saved client" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.nickname || client.name }, client.id)))] }), _jsx("button", { className: "secondary-button", disabled: !selectedClientId, onClick: () => applyClientToDraft(selectedClientId), children: "Load client" }), _jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void saveCurrentClientToLibrary(), children: "Save current client" })] })] }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Client Name", _jsx("input", { value: draft.client.name, onChange: (event) => handleClientField("name", event.target.value) })] }), _jsxs("label", { children: ["Business Name", _jsx("input", { value: draft.client.businessName ?? "", onChange: (event) => handleClientField("businessName", event.target.value) })] }), _jsxs("label", { children: ["Client Email", _jsx("input", { value: draft.client.email ?? "", onChange: (event) => handleClientField("email", event.target.value) })] }), _jsxs("label", { className: "full-width", children: ["Client Address", _jsx("textarea", { rows: 3, value: draft.client.addressLines.join("\n"), onChange: (event) => handleClientField("addressLines", event.target.value) })] })] })] }), _jsxs("div", { className: "section-block", children: [_jsxs("div", { className: "section-row", children: [_jsx("span", { className: "section-kicker", children: "Items" }), _jsx("button", { className: "secondary-button", onClick: addItem, children: "Add item" })] }), draft.items.map((item) => (_jsxs("div", { className: "item-card", children: [_jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Task", _jsx("input", { value: item.task, onChange: (event) => updateItem(item.id, "task", event.target.value) })] }), _jsxs("label", { children: ["Description", _jsx("input", { value: item.description ?? "", onChange: (event) => updateItem(item.id, "description", event.target.value) })] }), _jsxs("label", { children: ["Quantity", _jsx("input", { type: "number", min: "0", step: "0.01", value: item.quantity, onChange: (event) => updateItem(item.id, "quantity", event.target.value) })] }), _jsxs("label", { children: ["Unit Price", _jsx("input", { type: "number", min: "0", step: "0.01", value: item.unitPrice, onChange: (event) => updateItem(item.id, "unitPrice", event.target.value) })] }), _jsxs("label", { children: ["Unit Label", _jsx("input", { value: item.unitLabel ?? "", onChange: (event) => updateItem(item.id, "unitLabel", event.target.value) })] }), _jsxs("label", { children: ["Date", _jsx("input", { type: "date", value: item.date ?? "", onChange: (event) => updateItem(item.id, "date", event.target.value) })] }), _jsxs("label", { className: "full-width", children: ["Notes", _jsx("input", { value: item.notes ?? "", onChange: (event) => updateItem(item.id, "notes", event.target.value) })] })] }), _jsx("button", { className: "text-button", onClick: () => removeItem(item.id), children: "Remove item" })] }, item.id)))] }), _jsxs("div", { className: "section-block", children: [_jsx("span", { className: "section-kicker", children: "Summary" }), _jsxs("div", { className: "form-grid", children: [_jsxs("label", { children: ["Tax Rate %", _jsx("input", { type: "number", min: "0", step: "0.01", value: draft.taxRate ?? 0, onChange: (event) => handleDraftField("taxRate", Number(event.target.value)) })] }), _jsxs("label", { children: ["Discount Amount", _jsx("input", { type: "number", min: "0", step: "0.01", value: draft.discountAmount ?? 0, onChange: (event) => handleDraftField("discountAmount", Number(event.target.value)) })] }), _jsxs("label", { className: "full-width", children: ["Invoice Notes", _jsx("textarea", { rows: 4, value: draft.notes ?? "", onChange: (event) => handleDraftField("notes", event.target.value) })] })] }), _jsxs("div", { className: "summary-strip", children: [_jsxs("span", { children: ["Subtotal: $", summary.subtotal.toFixed(2)] }), _jsxs("span", { children: ["Tax: $", summary.taxAmount.toFixed(2)] }), _jsxs("span", { children: ["Total: $", summary.total.toFixed(2)] })] })] }), _jsxs("div", { className: "action-row", children: [_jsx("button", { className: "primary-button", disabled: busy, onClick: () => void saveInvoice("draft"), children: "Save draft" }), _jsx("button", { className: "secondary-button", disabled: busy, onClick: () => void saveInvoice("finalized"), children: "Finalize invoice" }), _jsx("button", { className: "secondary-button", onClick: exportPdf, children: "Export PDF" }), _jsx("button", { className: "secondary-button", onClick: downloadInvoiceFormat, children: "Export `.invoice`" }), _jsx("button", { className: "secondary-button", onClick: () => void copyClockKeeperLink(), children: "Copy import link" })] })] }), _jsx(InvoicePreview, { draft: draft, profile: resolvedProfile })] })) : null] })] }));
};
export default App;
