import { useEffect, useMemo, useState } from "react";
import {
  calculateInvoiceSummary,
  createEmptyInvoiceDraft,
  createEmptyProfile,
  decodeInvoicePayload,
  encodeInvoicePayload,
  exportCompactInvoice,
  parseInvoiceFile,
  type InvoiceDraft,
  type InvoiceStatus,
  type ProfileData,
  type SavedClient,
  type StoredInvoice,
} from "@invoice/shared";
import { api } from "./api/client";
import { InvoicePreview } from "./components/InvoicePreview";
import { exportElementToPdf } from "./utils/pdf";

type View = "dashboard" | "invoice" | "profile";

const emptyClientForm = {
  id: "",
  nickname: "",
  name: "",
  businessName: "",
  email: "",
  addressLines: "",
  notes: "",
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
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Set up your account and save reusable invoice settings.");
  const [error, setError] = useState("");
  const [clientForm, setClientForm] = useState(emptyClientForm);

  const resolvedProfile = useMemo(() => withAssetOrigins(profile), [profile]);
  const summary = useMemo(() => calculateInvoiceSummary(draft), [draft]);

  const loadWorkspaceData = async () => {
    const [clientResponse, profileResponse, invoiceResponse, templateResponse] = await Promise.all([
      api.listClients(),
      api.getProfile(),
      api.listInvoices(),
      api.getTemplates(),
    ]);

    setClients(clientResponse.clients);
    setProfile(withAssetOrigins(profileResponse.profile));
    setInvoices(invoiceResponse.invoices);
    setTemplates(templateResponse.templates);
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
        [field]:
          field === "addressLines"
            ? value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
            : value,
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

  const saveCurrentClientToLibrary = () => {
    setClientForm({
      id: "",
      nickname: draft.client.name || draft.client.businessName || "",
      name: draft.client.name,
      businessName: draft.client.businessName ?? "",
      email: draft.client.email ?? "",
      addressLines: draft.client.addressLines.join("\n"),
      notes: "",
    });
    setView("profile");
    setMessage("We copied the current invoice client into the saved-client form.");
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
    setSelectedClientId("");
    resetClientForm();
    resetDraft();
    setView("dashboard");
    setMessage("Signed out.");
  };

  if (!currentUser) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">Freelance Invoice Generator</p>
          <h1>Minimal invoicing, reusable account settings, and draft saving.</h1>
          <p className="support-copy">Create one account, reuse your logo and payment info, and import work from CSV, JSON, or compact `.invoice` files.</p>

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
          <button className={view === "invoice" ? "active" : ""} onClick={() => setView("invoice")}>
            Invoice Builder
          </button>
          <button className={view === "profile" ? "active" : ""} onClick={() => setView("profile")}>
            Profile
          </button>
        </nav>

        <div className="sidebar-actions">
          <button onClick={resetDraft}>New invoice</button>
          <button onClick={logout}>Logout</button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div>
            <h1>{view === "dashboard" ? "Dashboard" : view === "profile" ? "Profile" : "Invoice Builder"}</h1>
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
                  <strong>{summary.total.toFixed(2)}</strong>
                  <span>Current draft total</span>
                </div>
                <div>
                  <strong>{templates.length}</strong>
                  <span>Template ready</span>
                </div>
                <div>
                  <strong>{clients.length}</strong>
                  <span>Saved clients</span>
                </div>
              </div>
            </article>

            <article className="panel">
              <span className="section-kicker">Import</span>
              <h3>Bring in work from Clock Keeper</h3>
              <p>Clock Keeper can export `.invoice`, CSV, or JSON. Upload here, review, then save or export.</p>
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
                    <button className="secondary-button" onClick={saveCurrentClientToLibrary}>
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
