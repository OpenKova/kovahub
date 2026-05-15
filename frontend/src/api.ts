import type {
  AuthUser,
  ApiTokenSummary,
  PackageComment,
  PackageDetail,
  PackageFamily,
  PackageListItem,
  PackageReport,
  PackageReportStatus,
  PackageSettingsPayload,
  PackageSort,
  PackageStarState,
  PackageStarToggleResult,
  ProfileUpdatePayload,
  PublishArchiveMetadata,
  PublishPayload,
  UserProfile,
} from "./types";

const apiBase = (import.meta.env.VITE_KOVAHUB_API_URL || "http://localhost:8787").replace(/\/+$/, "");
const tokenKey = "kovahub.authToken";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isAuthError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

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
    throw new ApiError(body.error ?? fallback, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type FetchPackagesParams = {
  q?: string;
  family?: PackageFamily;
  owner?: string;
  tag?: string;
  sort?: PackageSort;
  cursor?: string | null;
  limit?: number;
};

export async function fetchPackages(params: FetchPackagesParams = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.family) query.set("family", params.family);
  if (params.owner) query.set("owner", params.owner);
  if (params.tag) query.set("tag", params.tag);
  if (params.sort) query.set("sort", params.sort);
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 100));
  return request<{ items: PackageListItem[]; nextCursor: string | null }>(
    `/api/v1/packages?${query.toString()}`,
  );
}

export async function fetchPackageDetail(name: string) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}`);
}

export async function fetchStarredPackages(params: { cursor?: string | null; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 100));
  return request<{ items: PackageListItem[]; nextCursor: string | null }>(`/api/v1/stars?${query.toString()}`);
}

export async function fetchOwnerPackages(params: { cursor?: string | null; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 100));
  return request<{ items: PackageListItem[]; nextCursor: string | null }>(`/api/v1/me/packages?${query.toString()}`);
}

export async function fetchPackageStar(name: string) {
  return request<PackageStarState>(`/api/v1/packages/${encodeURIComponent(name)}/star`);
}

export async function togglePackageStar(name: string) {
  return request<PackageStarToggleResult>(`/api/v1/packages/${encodeURIComponent(name)}/star/toggle`, {
    method: "POST",
  });
}

export async function fetchPackageComments(name: string) {
  return request<{ items: PackageComment[]; nextCursor: string | null }>(
    `/api/v1/packages/${encodeURIComponent(name)}/comments?limit=100`,
  );
}

export async function postPackageComment(name: string, body: string) {
  return request<{ comment: PackageComment | null }>(`/api/v1/packages/${encodeURIComponent(name)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function reportPackage(name: string, reason: string) {
  return request<{ report: PackageReport | null }>(
    `/api/v1/packages/${encodeURIComponent(name)}/report`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

export async function fetchReviewerReports(params: { status?: PackageReportStatus; cursor?: string | null; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 100));
  return request<{ items: PackageReport[]; nextCursor: string | null }>(
    `/api/v1/reviewer/reports?${query.toString()}`,
  );
}

export async function updateReviewerReport(
  id: string,
  payload: { status: PackageReportStatus; resolution?: string | null; moderationStatus?: "pending" | "approved" | "rejected" },
) {
  return request<{ report: PackageReport | null }>(`/api/v1/reviewer/reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function updatePackageModeration(
  name: string,
  payload: {
    moderationStatus?: "pending" | "approved" | "rejected";
    scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
    riskLevel?: "unknown" | "low" | "medium" | "high";
    summary?: string | null;
  },
) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}/moderation`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
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

export async function updatePackageSettings(name: string, payload: PackageSettingsPayload) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}/settings`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function renamePackage(name: string, nextName: string) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}/rename`, {
    method: "POST",
    body: JSON.stringify({ name: nextName }),
  });
}

export async function transferPackage(name: string, targetHandle: string) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}/transfer`, {
    method: "POST",
    body: JSON.stringify({ targetHandle }),
  });
}

export async function deletePackage(name: string) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function restorePackage(name: string) {
  return request<PackageDetail>(`/api/v1/packages/${encodeURIComponent(name)}/restore`, {
    method: "POST",
  });
}

export async function yankPackageVersion(name: string, version: string, message?: string | null) {
  return request<PackageDetail>(
    `/api/v1/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/yank`,
    {
      method: "POST",
      body: JSON.stringify({ message }),
    },
  );
}

export async function fetchMe() {
  return request<{ user: AuthUser }>("/api/v1/auth/me");
}

export async function fetchProfile(handle: string) {
  return request<{ profile: UserProfile }>(`/api/v1/profiles/${encodeURIComponent(handle)}`);
}

export async function updateProfile(payload: ProfileUpdatePayload) {
  return request<{ user: AuthUser }>("/api/v1/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
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
