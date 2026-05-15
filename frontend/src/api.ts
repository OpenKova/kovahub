import type { AuthUser, PackageDetail, PackageFamily, PackageListItem, PublishPayload } from "./types";

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
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
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

export async function register(input: { handle: string; email: string; password: string }) {
  return request<{ token: string; user: AuthUser }>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function login(input: { email: string; password: string }) {
  return request<{ token: string; user: AuthUser }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function fetchMe() {
  return request<{ user: AuthUser }>("/api/v1/auth/me");
}

export function packageDownloadUrl(name: string, version?: string | null) {
  const query = new URLSearchParams();
  if (version) query.set("version", version);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return `${apiBase}/api/v1/packages/${encodeURIComponent(name)}/download${suffix}`;
}
