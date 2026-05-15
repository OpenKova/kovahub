import type {
  AuthUser,
  ApiTokenSummary,
  PackageDetail,
  PackageFamily,
  PackageListItem,
  PublishArchiveMetadata,
  PublishPayload,
} from "./types";

const apiBase = (import.meta.env.VITE_KOVAHUB_API_URL || "http://localhost:8787").replace(/\/+$/, "");
const tokenKey = "kovahub.authToken";

export function getApiBase() {
  return apiBase;
}

export function getStoredToken() {
  return window.localStorage.getItem(tokenKey);
}

export function storeToken(token: string) {
  window.localStorage.setItem(tokenKey, token);
}

export function clearToken() {
  window.localStorage.removeItem(tokenKey);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (!headers.has("content-type") && init.body && !isFormData) headers.set("content-type", "application/json");
  const token = getStoredToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const fallback = `Request failed with HTTP ${response.status}`;
    const body = (await response.json().catch(() => ({ error: fallback }))) as { error?: string };
    throw new Error(body.error ?? fallback);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function fetchPackages(params: { q?: string; family?: PackageFamily } = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.family) query.set("family", params.family);
  query.set("limit", "100");
  return request<{ items: PackageListItem[]; nextCursor: string | null }>(
    `/api/v1/packages?${query.toString()}`,
  );
}

export async function fetchPackageDetail(name: string) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}`);
}

export async function publishPackage(payload: PublishPayload) {
  return request<PackageDetail>("/api/v1/packages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function compactMetadata(metadata: PublishArchiveMetadata) {
  const entries = Object.entries(metadata).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.values(value).some(Boolean);
    return Boolean(value);
  });
  return Object.fromEntries(entries) as PublishArchiveMetadata;
}

export async function publishArchivePackage(file: File, metadata: PublishArchiveMetadata) {
  const form = new FormData();
  form.append("archive", file);
  const compacted = compactMetadata(metadata);
  if (Object.keys(compacted).length > 0) form.append("metadata", JSON.stringify(compacted));
  return request<PackageDetail>("/api/v1/packages", {
    method: "POST",
    body: form,
  });
}

export async function fetchMe() {
  return request<{ user: AuthUser }>("/api/v1/auth/me");
}

export async function listApiTokens() {
  return request<{ tokens: ApiTokenSummary[] }>("/api/v1/auth/tokens");
}

export async function createApiToken(name: string) {
  return request<{ token: string; apiToken: ApiTokenSummary }>("/api/v1/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function revokeApiToken(id: string) {
  return request<void>(`/api/v1/auth/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function githubLoginUrl(returnTo = "/publish") {
  const query = new URLSearchParams();
  query.set("returnTo", returnTo);
  return `${apiBase}/api/v1/auth/github/start?${query.toString()}`;
}

export function packageDownloadUrl(name: string, version?: string | null) {
  const query = new URLSearchParams();
  if (version) query.set("version", version);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return `${apiBase}/api/v1/packages/${encodeURIComponent(name)}/download${suffix}`;
}
