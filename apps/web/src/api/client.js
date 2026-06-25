const jsonHeaders = {
    "Content-Type": "application/json",
};
const getToken = () => localStorage.getItem("invoice-token");
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const request = async (path, options = {}) => {
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
    return payload;
};
export const api = {
    register(email, password) {
        return request("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
    },
    login(email, password) {
        return request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
    },
    me() {
        return request("/api/auth/me");
    },
    getTemplates() {
        return request("/api/templates");
    },
    getProfile() {
        return request("/api/profile");
    },
    updateProfile(profile) {
        return request("/api/profile", {
            method: "PUT",
            body: JSON.stringify(profile),
        });
    },
    uploadProfileAsset(kind, file) {
        const formData = new FormData();
        formData.append("file", file);
        return request(`/api/profile/${kind}`, {
            method: "POST",
            body: formData,
        });
    },
    listInvoices() {
        return request("/api/invoices");
    },
    listClients() {
        return request("/api/clients");
    },
    createClient(payload) {
        return request("/api/clients", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    },
    updateClient(clientId, payload) {
        return request(`/api/clients/${clientId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        });
    },
    deleteClient(clientId) {
        return request(`/api/clients/${clientId}`, {
            method: "DELETE",
        });
    },
    createInvoice(payload) {
        return request("/api/invoices", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    },
    updateInvoice(invoiceId, payload) {
        return request(`/api/invoices/${invoiceId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
        });
    },
};
