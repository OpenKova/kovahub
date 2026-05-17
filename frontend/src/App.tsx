import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  Flag,
  Github,
  History,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Monitor,
  Moon,
  Package,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Trash2,
  UploadCloud,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  approveDeviceLogin,
  clearToken,
  createOrganization,
  createApiToken,
  deletePackage,
  fetchMyOrganizations,
  fetchMe,
  fetchOwnerPackages,
  fetchPackageDetail,
  fetchPackageComments,
  fetchPackageStar,
  fetchPackages,
  fetchProfile,
  fetchReviewerReports,
  fetchStarredPackages,
  getApiBase,
  getStoredToken,
  githubLoginUrl,
  isAuthError,
  packageDownloadUrl,
  postPackageComment,
  publishArchivePackage,
  publishPackage,
  renamePackage,
  reportPackage,
  revokeApiToken,
  restorePackage,
  listApiTokens,
  storeToken,
  togglePackageStar,
  transferPackage,
  updateProfile,
  updatePackageModeration,
  updatePackageSettings,
  updateReviewerReport,
  yankPackageVersion,
} from "./api";
import { kovaRoboLogo } from "./brandAssets";
import type {
  AuthUser,
  ApiTokenSummary,
  Organization,
  PackageComment,
  PackageDetail,
  PackageFamily,
  PackageListItem,
  PackageReport,
  PackageSettingsPayload,
  PackageSort,
  ProfileUpdatePayload,
  PublishArchiveMetadata,
  PublishPayload,
  UserProfile,
} from "./types";

const familyLabels: Record<PackageFamily, string> = {
  skill: "Skill",
  "code-plugin": "Code plugin",
  "bundle-plugin": "Bundle plugin",
};

const sortLabels: Record<PackageSort, string> = {
  recent: "Recent",
  popular: "Popular",
  trending: "Trending",
};

const familyIcons: Record<PackageFamily, typeof Sparkles> = {
  skill: Sparkles,
  "code-plugin": Code2,
  "bundle-plugin": Boxes,
};

const skillSlugPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const themeStorageKey = "kovahub.theme";

type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
type ThemeSettings = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};
type HomeCardKind = "skill" | "plugin";
type SearchKind = "all" | "skills" | "plugins";
type DetailTab = "overview" | "versions" | "compatibility" | "files" | "discussion";
type HomeCardItem = {
  name: string;
  displayName: string;
  ownerHandle?: string | null;
  summary?: string | null;
  family: PackageFamily;
  href: string;
  version?: string | null;
  stars: string;
  downloads: string;
  kind: HomeCardKind;
};
type ProfileFormState = {
  displayName: string;
  bio: string;
  websiteUrl: string;
  company: string;
  location: string;
};

function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function prefersDarkScheme() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function useThemeSettings(): ThemeSettings {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredThemeMode());
  const [systemDark, setSystemDark] = useState(() => prefersDarkScheme());
  const resolved: ResolvedTheme = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemDark(media.matches);
    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, mode);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.kovahubTheme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  return { mode, resolved, setMode };
}

function useLandingUser() {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [hasSession, setHasSession] = useState(() => Boolean(getStoredToken()));

  const setUser = useCallback((nextUser: AuthUser | null) => {
    setUserState(nextUser);
    setHasSession(Boolean(nextUser) || Boolean(getStoredToken()));
  }, []);

  useEffect(() => {
    if (!getStoredToken()) {
      setHasSession(false);
      return;
    }
    let active = true;
    fetchMe()
      .then((result) => {
        if (!active) return;
        setUserState(result.user);
        setHasSession(true);
      })
      .catch((err) => {
        if (isAuthError(err)) {
          clearToken();
          if (!active) return;
          setUserState(null);
          setHasSession(false);
          return;
        }
        if (!active) return;
        setUserState(null);
        setHasSession(Boolean(getStoredToken()));
      });
    return () => {
      active = false;
    };
  }, []);

  return { user, setUser, hasSession };
}

function usePackageCatalog() {
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPackages({})
      .then((page) => {
        if (active) setPackages(page.items);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load packages.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { packages, loading, error };
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function formatCompactNumber(value: number | undefined, fallback: string) {
  if (typeof value !== "number") return fallback;
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function safeLocalPath(value: string | null) {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  return "/publish";
}

function packageRoute(name: string) {
  return `/packages/${encodeURIComponent(name)}`;
}

function marketplaceRoute(
  params: { q?: string; family?: PackageFamily; owner?: string; tag?: string; sort?: PackageSort } = {},
) {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.family) query.set("family", params.family);
  if (params.owner?.trim()) query.set("owner", params.owner.trim());
  if (params.tag?.trim()) query.set("tag", params.tag.trim());
  if (params.sort) query.set("sort", params.sort);
  const suffix = query.toString();
  return `/marketplace${suffix ? `?${suffix}` : ""}`;
}

function searchRoute(params: { q?: string; type?: SearchKind } = {}) {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.type && params.type !== "all") query.set("type", params.type);
  const suffix = query.toString();
  return `/search${suffix ? `?${suffix}` : ""}`;
}

function publisherRoute(handle: string) {
  return `/publishers/${encodeURIComponent(handle)}`;
}

function displayUserName(user: Pick<AuthUser, "handle" | "displayName">) {
  return user.displayName?.trim() || `@${user.handle}`;
}

function profileInitial(value: string) {
  return (value.trim()[0] ?? "K").toUpperCase();
}

function profileFormFromUser(user: AuthUser): ProfileFormState {
  return {
    displayName: user.displayName ?? "",
    bio: user.bio ?? "",
    websiteUrl: user.websiteUrl ?? "",
    company: user.company ?? "",
    location: user.location ?? "",
  };
}

function tagRoute(tag: string) {
  return `/tags/${encodeURIComponent(tag)}`;
}

function useRoutePackageName() {
  const params = useParams();
  const wildcard = params["*"];
  const slug = "slug" in params ? params.slug : null;
  return wildcard ? decodeURIComponent(wildcard) : slug ? decodeURIComponent(slug) : null;
}

function parseRouteFamily(value: string | null): PackageFamily | "all" {
  return value && value in familyLabels ? (value as PackageFamily) : "all";
}

function parseRouteSort(value: string | null): PackageSort {
  return value && value in sortLabels ? (value as PackageSort) : "recent";
}

function topicsFor(item: Pick<PackageListItem, "topics">) {
  return item.topics?.filter(Boolean) ?? [];
}

function formatStatus(value?: string | null) {
  return value ? value.replace(/-/g, " ") : "unknown";
}

type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; text: string };

function parseMarkdownBlocks(markdown: string) {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  }

  function flushList() {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const marker = heading[1] ?? "#";
      const text = heading[2] ?? "";
      blocks.push({ kind: "heading", level: marker.length as 1 | 2 | 3, text });
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1] ?? "");
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}

function MarkdownDocument({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);
  return (
    <div className="markdown-doc">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") {
          if (block.level === 1) return <h3 key={key}>{block.text}</h3>;
          if (block.level === 2) return <h4 key={key}>{block.text}</h4>;
          return <h5 key={key}>{block.text}</h5>;
        }
        if (block.kind === "list") {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "code") return <pre key={key}>{block.text}</pre>;
        return <p key={key}>{block.text}</p>;
      })}
    </div>
  );
}

function reviewLabel(item: Pick<PackageListItem, "moderationStatus">) {
  if (!item.moderationStatus || item.moderationStatus === "approved") return null;
  return item.moderationStatus === "pending" ? "Pending review" : "Review rejected";
}

function toHomeCard(item: PackageListItem, kind?: HomeCardKind): HomeCardItem {
  const resolvedKind = kind ?? (item.family === "skill" ? "skill" : "plugin");
  return {
    name: item.name,
    displayName: item.displayName,
    ownerHandle: item.ownerHandle,
    summary: item.summary,
    family: item.family,
    href: packageRoute(item.name),
    version: item.latestVersion,
    stars: formatCompactNumber(item.stats?.stars, "0"),
    downloads: formatCompactNumber(item.stats?.downloads, "0"),
    kind: resolvedKind,
  };
}

function packageActivityScore(item: PackageListItem) {
  return (item.stats?.downloads ?? 0) + (item.stats?.installs ?? 0) + (item.stats?.stars ?? 0);
}

function Header({ user, onSignOut }: { user: AuthUser | null; onSignOut: () => void }) {
  const returnTo = `${window.location.pathname}${window.location.search}`;

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <img className="brand-logo" src={kovaRoboLogo} alt="" aria-hidden="true" />
          </span>
          <span>KovaHub</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link to="/marketplace">Marketplace</Link>
          <Link to="/search">Search</Link>
          <Link to="/audits">Audits</Link>
          <a href={`${getApiBase()}/api/v1/meta`}>Registry API</a>
          <Link to="/publish">Publish</Link>
        </nav>
        {user ? (
          <div className="user-chip">
            <UserRound size={15} aria-hidden="true" />
            <span>{displayUserName(user)}</span>
            <Link className="link-button" to="/dashboard">
              Dashboard
            </Link>
            <Link className="link-button" to="/stars">
              Stars
            </Link>
            <Link className="link-button" to="/profile">
              Profile
            </Link>
            <button className="link-button" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        ) : (
          <a className="user-chip github-sign-in-chip" href={githubLoginUrl(returnTo)}>
            <Github size={15} aria-hidden="true" />
            <span>Sign in with GitHub</span>
          </a>
        )}
      </div>
    </header>
  );
}

function FamilyPill({ family }: { family: PackageFamily }) {
  const Icon = familyIcons[family];
  return (
    <span className={`pill family-${family}`}>
      <Icon size={13} aria-hidden="true" />
      {familyLabels[family]}
    </span>
  );
}

function PackageRow({ item, active }: { item: PackageListItem; active: boolean }) {
  const Icon = familyIcons[item.family];
  const review = reviewLabel(item);
  return (
    <Link className={`package-row${active ? " is-active" : ""}`} to={packageRoute(item.name)}>
      <span className="package-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="package-row-body">
        <span className="package-row-title">
          {item.ownerHandle ? <span className="owner">@{item.ownerHandle}</span> : null}
          <span>{item.displayName}</span>
          {item.isOfficial ? (
            <span className="verified">
              <CheckCircle2 size={13} aria-hidden="true" />
              Official
            </span>
          ) : null}
        </span>
        <span className="package-row-summary">
          {item.summary ?? "Kova-compatible package."}
        </span>
        <span className="package-row-meta">
          <span>{familyLabels[item.family]}</span>
          {item.latestVersion ? <span>v{item.latestVersion}</span> : null}
          {item.stats ? <span>{formatCompactNumber(item.stats.downloads, "0")} downloads</span> : null}
          {item.stats ? <span>{formatCompactNumber(item.stats.stars, "0")} stars</span> : null}
          {review ? <span>{review}</span> : null}
          <span>{formatDate(item.updatedAt)}</span>
        </span>
      </span>
    </Link>
  );
}

function DetailPanel({
  detail,
  user,
  onPackageUpdated,
}: {
  detail: PackageDetail | null;
  user: AuthUser | null;
  onPackageUpdated: (item: PackageListItem) => void;
}) {
  const pkg = detail?.package;
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [comments, setComments] = useState<PackageComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [starred, setStarred] = useState<boolean | null>(null);
  const [starBusy, setStarBusy] = useState(false);
  const [localStats, setLocalStats] = useState(pkg?.stats ?? null);
  const [detailNotice, setDetailNotice] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");

  useEffect(() => {
    setActiveTab("overview");
    setComments([]);
    setCommentBody("");
    setDetailNotice(null);
    setDetailError(null);
    setReportOpen(false);
    setReportReason("");
    setLocalStats(pkg?.stats ?? null);
    setStarred(null);
    if (!pkg) return;

    let active = true;
    setCommentsLoading(true);
    fetchPackageComments(pkg.name)
      .then((page) => {
        if (active) setComments(page.items);
      })
      .catch((error) => {
        if (active) setDetailError(error instanceof Error ? error.message : "Failed to load comments.");
      })
      .finally(() => {
        if (active) setCommentsLoading(false);
      });

    if (user) {
      fetchPackageStar(pkg.name)
        .then((state) => {
          if (active) setStarred(state.starred);
        })
        .catch(() => {
          if (active) setStarred(false);
        });
    }

    return () => {
      active = false;
    };
  }, [pkg?.name, user?.id]);

  if (!pkg) {
    return (
      <section className="detail-panel empty-detail">
        <Package size={34} aria-hidden="true" />
        <h2>Select a package</h2>
        <p>Search results and package cards open here with compatibility, versions, and download links.</p>
      </section>
    );
  }

  const compatibility = pkg.compatibility;
  const capabilities = pkg.capabilities;
  const verification = pkg.verification;
  const tags = Object.entries(pkg.tags ?? {});
  const topics = topicsFor(pkg);
  const versions = pkg.versions ?? [];
  const latestVersion = versions[0] ?? null;
  const documentation = latestVersion?.documentation ?? null;
  const documentationMarkdown = documentation?.readmeMarkdown ?? documentation?.skillMarkdown;
  const documentationPath = documentation?.readmeMarkdown ? documentation.readmePath : documentation?.skillPath;
  const stats = localStats ?? pkg.stats;
  const returnTo = typeof window === "undefined" ? packageRoute(pkg.name) : `${window.location.pathname}${window.location.search}`;

  async function handleStarPackage() {
    if (!pkg || starBusy) return;
    setStarBusy(true);
    setDetailNotice(null);
    setDetailError(null);
    try {
      const result = await togglePackageStar(pkg.name);
      setStarred(result.starred);
      setLocalStats(result.stats);
      if (result.package) onPackageUpdated(result.package);
      setDetailNotice(result.starred ? "Added to your highlights." : "Removed from your highlights.");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to update highlight.");
    } finally {
      setStarBusy(false);
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!pkg || !commentBody.trim()) return;
    setDetailNotice(null);
    setDetailError(null);
    try {
      const result = await postPackageComment(pkg.name, commentBody);
      if (result.comment) setComments((current) => [...current, result.comment as PackageComment]);
      setCommentBody("");
      setDetailNotice("Comment posted.");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to post comment.");
    }
  }

  async function submitReport(event: FormEvent) {
    event.preventDefault();
    if (!pkg || !reportReason.trim()) return;
    setDetailNotice(null);
    setDetailError(null);
    try {
      await reportPackage(pkg.name, reportReason);
      setReportReason("");
      setReportOpen(false);
      setDetailNotice("Report submitted for review.");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Failed to submit report.");
    }
  }

  return (
    <section className="detail-panel">
      <div className="detail-heading">
        <div>
          <div className="detail-title-row">
            <h1>{pkg.displayName}</h1>
            <FamilyPill family={pkg.family} />
          </div>
          <p className="detail-name">{pkg.name}</p>
        </div>
        <div className="detail-actions">
          {user ? (
            <button className="secondary-action" type="button" disabled={starBusy} onClick={() => void handleStarPackage()}>
              <Star size={16} aria-hidden="true" />
              {starred ? "Starred" : "Star"}
            </button>
          ) : (
            <a className="secondary-action" href={githubLoginUrl(returnTo)}>
              <Star size={16} aria-hidden="true" />
              Star
            </a>
          )}
          <a className="primary-action" href={packageDownloadUrl(pkg.name, pkg.latestVersion)}>
            <ArrowDownToLine size={16} aria-hidden="true" />
            Download
          </a>
        </div>
      </div>

      {detailNotice ? <p className="form-success">{detailNotice}</p> : null}
      {detailError ? <p className="form-error">{detailError}</p> : null}

      <div className="detail-tabs" role="tablist" aria-label="Package detail tabs">
        {(["overview", "versions", "compatibility", "files", "discussion"] as const).map((tab) => (
          <button
            className={activeTab === tab ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="detail-tab-body">
          <p className="detail-summary">{pkg.summary ?? "No summary published yet."}</p>
          {topics.length > 0 ? (
            <div className="topic-row" aria-label="Package topics">
              {topics.map((topic) => (
                <Link className="topic-link" to={tagRoute(topic)} key={topic}>
                  #{topic}
                </Link>
              ))}
            </div>
          ) : null}

          <div className="stat-grid">
            <div>
              <span className="stat-label">Latest</span>
              <strong>{pkg.latestVersion ? `v${pkg.latestVersion}` : "None"}</strong>
            </div>
            <div>
              <span className="stat-label">Downloads</span>
              <strong>{stats?.downloads ?? 0}</strong>
            </div>
            <div>
              <span className="stat-label">Stars</span>
              <strong>{stats?.stars ?? 0}</strong>
            </div>
            <div>
              <span className="stat-label">Versions</span>
              <strong>{stats?.versions ?? (pkg.latestVersion ? 1 : 0)}</strong>
            </div>
          </div>

          <div className="info-section">
            <h2>
              <ShieldCheck size={17} aria-hidden="true" />
              Review Status
            </h2>
            <div className="compat-grid">
              <InfoCell label="moderation" value={formatStatus(verification?.moderationStatus)} />
              <InfoCell label="securityScan" value={formatStatus(verification?.scanStatus)} />
              <InfoCell label="tier" value={formatStatus(verification?.tier)} />
              <InfoCell label="risk" value={formatStatus(verification?.riskLevel)} />
            </div>
            {verification?.summary ? <p className="content-muted">{verification.summary}</p> : null}
            {verification?.findings?.length ? (
              <div className="finding-list">
                {verification.findings.map((finding) => (
                  <div className={`finding-row severity-${finding.severity}`} key={`${finding.code}-${finding.path ?? "artifact"}`}>
                    <strong>{finding.code}</strong>
                    <span>{finding.message}</span>
                    {finding.path ? <code>{finding.path}</code> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {documentationMarkdown ? (
            <div className="info-section">
              <h2>
                <BookOpen size={17} aria-hidden="true" />
                Package Docs
              </h2>
              {documentationPath ? <p className="content-muted">{documentationPath}</p> : null}
              <MarkdownDocument markdown={documentationMarkdown} />
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "versions" ? (
        <div className="info-section detail-tab-body">
          <h2>
            <History size={17} aria-hidden="true" />
            Version History
          </h2>
          <div className="version-list">
            {versions.length === 0 ? <p className="muted">No published versions yet.</p> : null}
            {versions.map((version) => {
              const isLatest = version.distTags.includes("latest");
              return (
                <div className="version-row" key={version.version}>
                  <div className="version-main">
                    <div className="version-title">
                      <strong>v{version.version}</strong>
                      {isLatest ? <span className="tag latest-tag">latest</span> : null}
                    </div>
                    <span className="version-meta">
                      {formatDate(version.createdAt)} · {version.files.length} files
                    </span>
                    {version.changelog ? <p>{version.changelog}</p> : null}
                    <code className="version-digest">{version.sha256hash.slice(0, 16)}</code>
                  </div>
                  <a
                    className="icon-action"
                    href={packageDownloadUrl(pkg.name, version.version)}
                    aria-label={`Download ${pkg.name} ${version.version}`}
                  >
                    <ArrowDownToLine size={16} aria-hidden="true" />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "compatibility" ? (
        <div className="detail-tab-body">
          <div className="info-section">
            <h2>
              <ShieldCheck size={17} aria-hidden="true" />
              Compatibility
            </h2>
            <div className="compat-grid">
              <InfoCell label="pluginApi" value={compatibility?.pluginApiRange ?? "Not required"} />
              <InfoCell label="minGatewayVersion" value={compatibility?.minGatewayVersion ?? "Any"} />
              <InfoCell label="builtWith" value={compatibility?.builtWithKovaVersion ?? "Not declared"} />
              <InfoCell label="pluginSdk" value={compatibility?.pluginSdkVersion ?? "Not declared"} />
            </div>
          </div>

          <div className="info-section">
            <h2>
              <Plug size={17} aria-hidden="true" />
              Capability Signals
            </h2>
            <div className="tag-cloud">
              {(capabilities?.capabilityTags?.length ? capabilities.capabilityTags : tags.map(([tag]) => tag)).map(
                (tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ),
              )}
              {capabilities?.executesCode ? <span className="tag danger">executes code</span> : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "files" ? (
        <div className="info-section detail-tab-body">
          <h2>
            <FileArchive size={17} aria-hidden="true" />
            Archive Files
          </h2>
          <div className="version-list">
            {!latestVersion || latestVersion.files.length === 0 ? <p className="muted">No file metadata published.</p> : null}
            {latestVersion?.files.map((file) => (
              <div className="archive-file-row" key={file.path}>
                <div>
                  <strong>{file.path}</strong>
                  <span>{file.contentType ?? "file"} · {formatCompactNumber(file.size, "0")} bytes</span>
                </div>
                <code>{file.sha256.slice(0, 16)}</code>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "discussion" ? (
        <div className="detail-tab-body discussion-panel">
          <div className="info-section">
            <h2>
              <MessageSquare size={17} aria-hidden="true" />
              Comments
            </h2>
            {user ? (
              <form className="comment-form" onSubmit={submitComment}>
                <textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Leave a note for other KovaHub users."
                  rows={4}
                />
                <button className="primary-action" type="submit" disabled={!commentBody.trim()}>
                  <MessageSquare size={16} aria-hidden="true" />
                  Post comment
                </button>
              </form>
            ) : (
              <p className="muted">
                <a className="inline-link" href={githubLoginUrl(returnTo)}>Sign in with GitHub</a> to comment.
              </p>
            )}
            <div className="comment-list">
              {commentsLoading ? <p className="muted">Loading comments...</p> : null}
              {!commentsLoading && comments.length === 0 ? <p className="muted">No comments yet.</p> : null}
              {comments.map((comment) => (
                <article className="comment-card" key={comment.id}>
                  <div className="comment-card-head">
                    <strong>@{comment.user.handle}</strong>
                    <span>{formatDate(comment.createdAt)}</span>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="info-section">
            <h2>
              <Flag size={17} aria-hidden="true" />
              Report Package
            </h2>
            {user ? (
              reportOpen ? (
                <form className="comment-form" onSubmit={submitReport}>
                  <textarea
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    placeholder="What should moderators review?"
                    rows={3}
                  />
                  <div className="form-actions">
                    <button className="secondary-action" type="button" onClick={() => setReportOpen(false)}>
                      Cancel
                    </button>
                    <button className="primary-action" type="submit" disabled={!reportReason.trim()}>
                      Submit report
                    </button>
                  </div>
                </form>
              ) : (
                <button className="secondary-action" type="button" onClick={() => setReportOpen(true)}>
                  <Flag size={16} aria-hidden="true" />
                  Report for review
                </button>
              )
            ) : (
              <p className="muted">
                <a className="inline-link" href={githubLoginUrl(returnTo)}>Sign in with GitHub</a> to report packages.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuthPanel() {
  return (
    <section className="auth-card">
      <div className="section-title">
        <KeyRound size={17} aria-hidden="true" />
        <h2>Sign in required</h2>
      </div>
      <p className="muted">Publisher authentication is required.</p>
    </section>
  );
}

function GitHubAuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const returnTo = safeLocalPath(query.get("returnTo"));
    const token = hash.get("token");

    if (token) {
      storeToken(token);
      navigate(returnTo, { replace: true });
      return;
    }

    setError(query.get("error") ?? "GitHub sign-in failed.");
  }, [navigate]);

  return (
    <main className="auth-callback-shell">
      <section className="auth-card">
        <div className="section-title">
          <Github size={17} aria-hidden="true" />
          <h2>{error ? "GitHub sign-in failed" : "Completing sign-in"}</h2>
        </div>
        <p className={error ? "form-error" : "muted"}>
          {error ?? "Finishing your KovaHub session..."}
        </p>
        {error ? (
          <Link className="primary-action full" to="/publish">
            Back to login
          </Link>
        ) : null}
      </section>
    </main>
  );
}

function DeviceAuthPage({ theme }: { theme: ThemeSettings }) {
  const { user, setUser, hasSession } = useLandingUser();
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get("user_code") ?? "";
  const [userCode, setUserCode] = useState(initialCode);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returnTo = `/auth/device${userCode ? `?user_code=${encodeURIComponent(userCode)}` : ""}`;

  async function approve(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    setError(null);
    try {
      const result = await approveDeviceLogin(userCode);
      setStatus(result.clientName ? `${result.clientName} is connected.` : "Device login approved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Device approval failed.");
    }
  }

  return (
    <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
      <section className="auth-card profile-auth-card">
        <div className="section-title">
          <KeyRound size={17} aria-hidden="true" />
          <h2>Approve device login</h2>
        </div>
        {!hasSession && !user ? (
          <>
            <p className="muted">Sign in with GitHub to approve this KovaHub CLI login.</p>
            <a className="content-primary-action" href={githubLoginUrl(returnTo)}>
              <Github size={16} aria-hidden="true" />
              Sign in with GitHub
            </a>
          </>
        ) : (
          <form className="device-auth-form" onSubmit={approve}>
            <label>
              Code
              <input value={userCode} onChange={(event) => setUserCode(event.target.value.toUpperCase())} />
            </label>
            <button className="primary-action full" type="submit" disabled={!userCode.trim()}>
              Approve login
            </button>
            {status ? <p className="form-success">{status}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}
          </form>
        )}
      </section>
    </LandingPageShell>
  );
}

function ApiTokenPanel({ user }: { user: AuthUser | null }) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [tokenName, setTokenName] = useState("local cli");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadTokens = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listApiTokens();
      setTokens(result.tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API tokens.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  async function createToken(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const result = await createApiToken(tokenName);
      setCreatedToken(result.token);
      setTokens((current) => [result.apiToken, ...current]);
      setStatus("API token created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API token.");
    }
  }

  async function copyCreatedToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setStatus("API token copied.");
    } catch {
      setStatus("Copy unavailable in this browser.");
    }
  }

  async function revokeToken(id: string) {
    setError(null);
    setStatus(null);
    try {
      await revokeApiToken(id);
      setTokens((current) => current.filter((token) => token.id !== id));
      setStatus("API token revoked.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API token.");
    }
  }

  if (!user) return null;

  return (
    <section className="token-panel">
      <div className="section-title">
        <KeyRound size={17} aria-hidden="true" />
        <h2>Publish Tokens</h2>
      </div>
      <form className="token-create-row" onSubmit={createToken}>
        <label>
          Token name
          <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
        </label>
        <button className="primary-action" type="submit">
          <KeyRound size={16} aria-hidden="true" />
          Create token
        </button>
      </form>
      {createdToken ? (
        <div className="token-secret-box">
          <span>{createdToken}</span>
          <button type="button" onClick={copyCreatedToken} aria-label="Copy API token">
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="token-list-heading">
        <span>{loading ? "Loading tokens..." : `${tokens.length} active tokens`}</span>
        <button type="button" onClick={() => void loadTokens()} aria-label="Refresh API tokens">
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="token-list">
        {tokens.length === 0 && !loading ? <p className="muted">No API tokens yet.</p> : null}
        {tokens.map((token) => (
          <div className="token-row" key={token.id}>
            <div>
              <strong>{token.name}</strong>
              <span>
                Created {formatDate(token.createdAt)}
                {token.lastUsedAt ? ` · Used ${formatDate(token.lastUsedAt)}` : ""}
              </span>
            </div>
            <button type="button" onClick={() => void revokeToken(token.id)} aria-label={`Revoke ${token.name}`}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function PublishPanel({
  user,
  onPublished,
}: {
  user: AuthUser | null;
  onPublished: (name: string) => void;
}) {
  const [publishMethod, setPublishMethod] = useState<"compose" | "archive">("compose");
  const [family, setFamily] = useState<PackageFamily>("code-plugin");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [version, setVersion] = useState("");
  const [summary, setSummary] = useState("");
  const [pluginApi, setPluginApi] = useState("");
  const [minGatewayVersion, setMinGatewayVersion] = useState("");
  const [readme, setReadme] = useState("");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archiveFamily, setArchiveFamily] = useState<PackageFamily | "auto">("auto");
  const [archiveName, setArchiveName] = useState("");
  const [archiveDisplayName, setArchiveDisplayName] = useState("");
  const [archiveVersion, setArchiveVersion] = useState("");
  const [archiveSummary, setArchiveSummary] = useState("");
  const [archiveTags, setArchiveTags] = useState("");
  const [archivePluginApi, setArchivePluginApi] = useState("");
  const [archiveMinGatewayVersion, setArchiveMinGatewayVersion] = useState("");
  const [publisherHandle, setPublisherHandle] = useState("self");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setOrganizations([]);
      setPublisherHandle("self");
      return;
    }
    let active = true;
    fetchMyOrganizations()
      .then((result) => {
        if (active) setOrganizations(result.organizations);
      })
      .catch(() => {
        if (active) setOrganizations([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    setError(null);
    try {
      const detail =
        publishMethod === "archive"
          ? await publishArchive()
          : await publishComposedPackage();
      const publishedName = detail.package?.name ?? name;
      const publishedVersion = detail.package?.latestVersion ?? version;
      setStatus(`Published ${publishedName}@${publishedVersion}`);
      onPublished(publishedName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
    }
  }

  async function publishComposedPackage() {
    const readmeText = optionalText(readme);
    const ownerHandle = publisherHandle === "self" ? undefined : publisherHandle;
    const payload: PublishPayload = {
      name,
      ownerHandle,
      displayName: optionalText(displayName),
      family,
      version,
      summary: optionalText(summary),
      compatibility:
        family === "skill"
          ? undefined
          : {
              pluginApi: optionalText(pluginApi),
              minGatewayVersion: optionalText(minGatewayVersion),
            },
      files: readmeText
        ? [
            {
              path: family === "skill" ? "SKILL.md" : "README.md",
              content: readmeText,
              contentType: "text/markdown",
            },
          ]
        : [],
    };
    return publishPackage(payload);
  }

  async function publishArchive() {
    if (!archiveFile) throw new Error("Choose a ZIP archive to publish.");
    const ownerHandle = publisherHandle === "self" ? undefined : publisherHandle;
    const compatibility =
      optionalText(archivePluginApi) || optionalText(archiveMinGatewayVersion)
        ? {
            pluginApi: optionalText(archivePluginApi),
            minGatewayVersion: optionalText(archiveMinGatewayVersion),
          }
        : undefined;
    const metadata: PublishArchiveMetadata = {
      name: optionalText(archiveName),
      ownerHandle,
      displayName: optionalText(archiveDisplayName),
      family: archiveFamily === "auto" ? undefined : archiveFamily,
      version: optionalText(archiveVersion),
      summary: optionalText(archiveSummary),
      tags: parseTags(archiveTags),
      compatibility,
    };
    return publishArchivePackage(archiveFile, metadata);
  }

  function updateFamily(nextFamily: PackageFamily) {
    setFamily(nextFamily);
    if (nextFamily === "skill") {
      if (name && !skillSlugPattern.test(name)) setName("");
    }
  }

  if (!user) return <AuthPanel />;

  return (
    <form className="publish-panel" onSubmit={submit}>
      <div className="section-title">
        <UploadCloud size={17} aria-hidden="true" />
        <h2>Publish Package</h2>
      </div>
      <label>
        Publisher
        <select value={publisherHandle} onChange={(event) => setPublisherHandle(event.target.value)}>
          <option value="self">@{user.handle}</option>
          {organizations.map((organization) => (
            <option value={organization.handle} key={organization.id}>
              @{organization.handle}
            </option>
          ))}
        </select>
      </label>
      <div className="mode-tabs" aria-label="Publish method">
        <button
          className={publishMethod === "compose" ? "is-active" : ""}
          type="button"
          onClick={() => {
            setPublishMethod("compose");
            setStatus(null);
            setError(null);
          }}
        >
          <Code2 size={15} aria-hidden="true" />
          Compose
        </button>
        <button
          className={publishMethod === "archive" ? "is-active" : ""}
          type="button"
          onClick={() => {
            setPublishMethod("archive");
            setStatus(null);
            setError(null);
          }}
        >
          <FileArchive size={15} aria-hidden="true" />
          Archive ZIP
        </button>
      </div>

      {publishMethod === "compose" ? (
        <>
          <div className="form-grid">
            <label>
              Package name
              <input
                placeholder={family === "skill" ? "my-skill" : "@scope/my-plugin"}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Display name
              <input
                placeholder="Shown in package lists"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Family
              <select value={family} onChange={(event) => updateFamily(event.target.value as PackageFamily)}>
                <option value="code-plugin">Code plugin</option>
                <option value="bundle-plugin">Bundle plugin</option>
                <option value="skill">Skill</option>
              </select>
            </label>
            <label>
              Version
              <input placeholder="0.1.0" value={version} onChange={(event) => setVersion(event.target.value)} />
            </label>
          </div>
          <label>
            Summary
            <input placeholder="Short package summary" value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          {family !== "skill" ? (
            <div className="form-grid">
              <label>
                pluginApi
                <input placeholder="^1.0.0" value={pluginApi} onChange={(event) => setPluginApi(event.target.value)} />
              </label>
              <label>
                minGatewayVersion
                <input
                  placeholder="2026.3.0"
                  value={minGatewayVersion}
                  onChange={(event) => setMinGatewayVersion(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <label>
            Package content
            <textarea
              placeholder={family === "skill" ? "Paste SKILL.md content" : "Paste README.md content"}
              value={readme}
              onChange={(event) => setReadme(event.target.value)}
              rows={7}
            />
          </label>
        </>
      ) : (
        <>
          <label className="file-field">
            Kova package ZIP
            <input
              accept=".zip,application/zip"
              type="file"
              onChange={(event) => {
                setArchiveFile(event.target.files?.[0] ?? null);
                setStatus(null);
                setError(null);
              }}
            />
          </label>
          {archiveFile ? (
            <div className="archive-file-summary">
              <FileArchive size={17} aria-hidden="true" />
              <span>{archiveFile.name}</span>
              <strong>{(archiveFile.size / 1024).toFixed(1)} KB</strong>
            </div>
          ) : null}
          <div className="form-grid">
            <label>
              Display name override
              <input
                placeholder="Inferred from archive"
                value={archiveDisplayName}
                onChange={(event) => setArchiveDisplayName(event.target.value)}
              />
            </label>
            <label>
              Family override
              <select
                value={archiveFamily}
                onChange={(event) => setArchiveFamily(event.target.value as PackageFamily | "auto")}
              >
                <option value="auto">Auto</option>
                <option value="code-plugin">Code plugin</option>
                <option value="bundle-plugin">Bundle plugin</option>
                <option value="skill">Skill</option>
              </select>
            </label>
            <label>
              Package name override
              <input
                placeholder="Inferred from package.json"
                value={archiveName}
                onChange={(event) => setArchiveName(event.target.value)}
              />
            </label>
            <label>
              Version override
              <input
                placeholder="Inferred from package.json"
                value={archiveVersion}
                onChange={(event) => setArchiveVersion(event.target.value)}
              />
            </label>
          </div>
          <label>
            Summary override
            <input
              placeholder="Inferred from package metadata"
              value={archiveSummary}
              onChange={(event) => setArchiveSummary(event.target.value)}
            />
          </label>
          <label>
            Tags
            <input value={archiveTags} onChange={(event) => setArchiveTags(event.target.value)} />
          </label>
          <div className="form-grid">
            <label>
              pluginApi
              <input
                placeholder="Inferred from kova.compat"
                value={archivePluginApi}
                onChange={(event) => setArchivePluginApi(event.target.value)}
              />
            </label>
            <label>
              minGatewayVersion
              <input
                placeholder="Inferred from kova.compat"
                value={archiveMinGatewayVersion}
                onChange={(event) => setArchiveMinGatewayVersion(event.target.value)}
              />
            </label>
          </div>
        </>
      )}
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-action full" type="submit">
        {publishMethod === "archive" ? (
          <FileArchive size={16} aria-hidden="true" />
        ) : (
          <UploadCloud size={16} aria-hidden="true" />
        )}
        {publishMethod === "archive" ? "Publish archive" : "Publish latest"}
      </button>
    </form>
  );
}

function LandingHeader({
  user,
  onSignOut,
  onSearch,
  theme,
}: {
  user: AuthUser | null;
  onSignOut: () => void;
  onSearch: (query: string) => void;
  theme: ThemeSettings;
}) {
  const [navQuery, setNavQuery] = useState("");
  const returnTo = `${window.location.pathname}${window.location.search}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(navQuery);
  }

  return (
    <header className="home-nav">
      <div className="home-nav-primary">
        <Link className="home-brand" to="/">
          <span className="home-brand-mark">
            <img src={kovaRoboLogo} alt="" aria-hidden="true" />
          </span>
          <span>KovaHub</span>
        </Link>

        <form className="home-nav-search" onSubmit={submit}>
          <Search size={18} aria-hidden="true" />
          <input
            value={navQuery}
            onChange={(event) => setNavQuery(event.target.value)}
            placeholder="Search skills and plugins"
          />
        </form>

        <div className="home-nav-actions">
          <div className="home-theme-toggle" aria-label="Theme mode">
            <button
              type="button"
              className={theme.mode === "system" ? "is-active" : ""}
              aria-label="System theme"
              aria-pressed={theme.mode === "system"}
              onClick={() => theme.setMode("system")}
            >
              <Monitor size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={theme.mode === "light" ? "is-active" : ""}
              aria-label="Light theme"
              aria-pressed={theme.mode === "light"}
              onClick={() => theme.setMode("light")}
            >
              <Sun size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={theme.mode === "dark" ? "is-active" : ""}
              aria-label="Dark theme"
              aria-pressed={theme.mode === "dark"}
              onClick={() => theme.setMode("dark")}
            >
              <Moon size={15} aria-hidden="true" />
            </button>
          </div>
          {user ? (
            <div className="home-user-chip">
              <UserRound size={15} aria-hidden="true" />
              <span>{displayUserName(user)}</span>
              <Link to="/dashboard">Dashboard</Link>
              <Link to="/stars">Stars</Link>
              <Link to="/profile">Profile</Link>
              <button type="button" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <a className="home-github-button" href={githubLoginUrl(returnTo)}>
              <Github size={16} aria-hidden="true" />
              Sign in with GitHub
            </a>
          )}
        </div>
      </div>

      <nav className="home-nav-secondary" aria-label="Marketplace sections">
        <Link to="/skills">
          <Wrench size={14} aria-hidden="true" />
          Skills
        </Link>
        <Link to="/plugins">
          <Plug size={14} aria-hidden="true" />
          Plugins
        </Link>
        <Link to="/publishers">Publishers</Link>
        <Link to="/audits">Audits</Link>
        <Link to="/docs">Docs</Link>
      </nav>
    </header>
  );
}

function HomePackageCard({ item, dense = false }: { item: HomeCardItem; dense?: boolean }) {
  const owner = item.ownerHandle ? `by ${item.ownerHandle}` : "by publisher";
  const version = item.version ? `v${item.version}` : "No release";

  return (
    <Link to={item.href} className={`home-v2-c-card${dense ? " is-dense" : ""}`}>
      <div className="home-v2-c-head">
        <div className="home-v2-c-name">{item.displayName}</div>
        <div className="home-v2-c-by">{owner}</div>
      </div>
      <span className="home-v2-c-tag">{familyLabels[item.family]}</span>
      <div className="home-v2-c-desc">{item.summary ?? "A Kova-compatible package."}</div>
      <div className="home-v2-c-footer">
        <div className="home-v2-c-stats">
          {item.kind === "plugin" ? (
            <span>{version}</span>
          ) : (
            <>
              <span>
                <Star size={12} aria-hidden="true" /> {item.stars}
              </span>
              <span>
                <Download size={12} aria-hidden="true" /> {item.downloads}
              </span>
            </>
          )}
        </div>
        <span className="home-v2-c-install">
          <Download size={13} aria-hidden="true" /> Install
        </span>
      </div>
    </Link>
  );
}

function HomeLanding({ theme }: { theme: ThemeSettings }) {
  const navigate = useNavigate();
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const { packages } = usePackageCatalog();
  const { user, setUser } = useLandingUser();

  const skillPackages = packages.filter((item) => item.family === "skill");
  const pluginPackages = packages.filter((item) => item.family !== "skill");
  const featuredSkills = skillPackages.map((item) => toHomeCard(item, "skill")).slice(0, 10);
  const trendingCards = [...packages]
    .sort((left, right) => packageActivityScore(right) - packageActivityScore(left) || right.updatedAt - left.updatedAt)
    .slice(0, 6)
    .map((item) => toHomeCard(item));
  const featuredPlugins = pluginPackages.map((item) => toHomeCard(item, "plugin")).slice(0, 3);
  const publisherCount = new Set(packages.map((item) => item.ownerHandle).filter(Boolean)).size;
  const totalDownloads = packages.reduce((total, item) => total + (item.stats?.downloads ?? 0), 0);
  const totalStars = packages.reduce((total, item) => total + (item.stats?.stars ?? 0), 0);
  const searchSuggestions = useMemo(() => {
    const terms = new Set<string>();
    for (const item of packages) {
      for (const topic of topicsFor(item)) {
        if (terms.size < 4) terms.add(topic);
      }
      if (terms.size < 4) terms.add(item.displayName);
      if (terms.size >= 4) break;
    }
    return Array.from(terms).slice(0, 4);
  }, [packages]);

  function runSearch(value: string) {
    navigate(searchRoute({ q: value }));
  }

  function submitHeroSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    runSearch(String(form.get("q") ?? ""));
  }

  function scrollFeatured(direction: -1 | 1) {
    carouselRef.current?.scrollBy({ left: direction * 356, behavior: "smooth" });
  }

  return (
    <div className="home-page" data-theme={theme.resolved}>
      <LandingHeader
        user={user}
        onSignOut={() => {
          clearToken();
          setUser(null);
        }}
        onSearch={runSearch}
        theme={theme}
      />

      <main className="home-v2-main">
        <section className="home-v2-hero">
          <div className="home-v2-hero-bg">
            <div className="home-v2-glow" />
            <div className="home-v2-dots" />
            <div className="home-v2-ring home-v2-ring-1" />
            <div className="home-v2-ring home-v2-ring-2" />
            <div className="home-v2-ring home-v2-ring-3" />
          </div>

          <p className="home-v2-hero-label">BUILT BY THE COMMUNITY.</p>
          <h1 className="home-v2-headline">
            <span className="home-v2-headline-inner">
              <span className="home-v2-action-word">Equip</span>
              <span className="home-v2-sep" />
              <span className="home-v2-action-word">Install</span>
              <span className="home-v2-sep" />
              <span className="home-v2-cycle-wrap">
                <span className="home-v2-cycle-track">
                  <span className="home-v2-cycle-word">Unleash.</span>
                  <span className="home-v2-cycle-word">Ship.</span>
                  <span className="home-v2-cycle-word">Build.</span>
                  <span className="home-v2-cycle-word">Create.</span>
                  <span className="home-v2-cycle-word">Unleash.</span>
                </span>
              </span>
            </span>
          </h1>
          <p className="home-v2-sub">Search Kova-compatible plugins and skills.</p>

          <div className="home-v2-search-container">
            <form className="home-v2-search-bar" onSubmit={submitHeroSearch}>
              <Search className="home-v2-search-icon" size={20} aria-hidden="true" />
              <input name="q" type="text" placeholder="What are you looking for?" />
              <button type="submit" className="home-v2-search-go" aria-label="Search">
                <span className="home-v2-search-go-label">Search</span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          </div>

          {searchSuggestions.length > 0 ? (
            <div className="home-v2-suggestions">
              {searchSuggestions.map((term) => (
                <button type="button" className="home-v2-suggestion" key={term} onClick={() => runSearch(term)}>
                  {term}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="home-v2-carousel-section">
          <div className="home-v2-carousel-header">
            <h2>Featured skills</h2>
            <div className="home-v2-carousel-controls">
              <Link className="home-v2-section-link" to="/skills">
                View all <ArrowRight size={14} aria-hidden="true" />
              </Link>
              {featuredSkills.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="home-v2-arrow"
                    aria-label="Previous featured skills"
                    onClick={() => scrollFeatured(-1)}
                  >
                    <ArrowRight className="home-v2-arrow-left" size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="home-v2-arrow"
                    aria-label="Next featured skills"
                    onClick={() => scrollFeatured(1)}
                  >
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {featuredSkills.length > 0 ? (
            <div className="home-v2-carousel-wrap" ref={carouselRef}>
              <div className="home-v2-carousel-track">
                {featuredSkills.map((item) => (
                  <HomePackageCard item={item} key={item.name} />
                ))}
              </div>
            </div>
          ) : (
            <p className="home-v2-empty">No skills published yet.</p>
          )}
        </section>

        <section className="home-v2-categories">
          <div className="home-v2-categories-grid">
            <Link to="/skills" className="home-v2-cat-item">
              <div className="home-v2-cat-icon">
                <Package size={20} aria-hidden="true" />
              </div>
              <div className="home-v2-cat-text">
                <div className="home-v2-cat-name">Skills</div>
                <div className="home-v2-cat-desc">Agent skill bundles</div>
              </div>
              <span className="home-v2-cat-arrow">
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </Link>
            <Link to="/plugins" className="home-v2-cat-item">
              <div className="home-v2-cat-icon">
                <Code2 size={20} aria-hidden="true" />
              </div>
              <div className="home-v2-cat-text">
                <div className="home-v2-cat-name">Plugins</div>
                <div className="home-v2-cat-desc">Gateway plugins</div>
              </div>
              <span className="home-v2-cat-arrow">
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </Link>
            <Link to="/publishers" className="home-v2-cat-item">
              <div className="home-v2-cat-icon">
                <Users size={20} aria-hidden="true" />
              </div>
              <div className="home-v2-cat-text">
                <div className="home-v2-cat-name">Publishers</div>
                <div className="home-v2-cat-desc">Builders and orgs</div>
              </div>
              <span className="home-v2-cat-arrow">
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </Link>
          </div>
        </section>

        <div className="home-v2-proof-bar">
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">{formatCompactNumber(packages.length, "0")}</span>
            <span className="home-v2-proof-label">tools</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">{formatCompactNumber(publisherCount, "0")}</span>
            <span className="home-v2-proof-label">publishers</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">{formatCompactNumber(totalDownloads, "0")}</span>
            <span className="home-v2-proof-label">downloads</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">{formatCompactNumber(totalStars, "0")}</span>
            <span className="home-v2-proof-label">stars</span>
          </div>
        </div>

        <section className="home-v2-grid-section">
          <div className="home-v2-grid-header">
            <h2>Trending now</h2>
            <Link className="home-v2-section-link" to="/skills">
              View all <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className="home-v2-card-grid">
            {trendingCards.map((item) => (
              <HomePackageCard item={item} dense key={item.name} />
            ))}
          </div>
          {trendingCards.length === 0 ? <p className="home-v2-empty">No trending packages yet.</p> : null}
        </section>

        <section className="home-v2-grid-section">
          <div className="home-v2-grid-header">
            <h2>Featured plugins</h2>
            <Link className="home-v2-section-link" to="/plugins">
              View all <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className="home-v2-card-grid home-v2-card-grid-plugins">
            {featuredPlugins.map((item) => (
              <HomePackageCard item={item} dense key={item.name} />
            ))}
          </div>
          {featuredPlugins.length === 0 ? <p className="home-v2-empty">No plugins published yet.</p> : null}
        </section>

        <footer className="home-v2-footer">
          <div>
            <h3>Browse</h3>
            <Link to="/skills">Skills</Link>
            <Link to="/plugins">Plugins</Link>
            <Link to={marketplaceRoute()}>Audits</Link>
          </div>
          <div>
            <h3>Publish</h3>
            <Link to="/publish">Publish Skill</Link>
            <Link to="/publish">Publish Plugin</Link>
          </div>
          <div>
            <h3>Community</h3>
            <a href="https://github.com/OpenKova/kovahub">GitHub</a>
            <Link to="/">KovaHub</Link>
          </div>
          <div>
            <h3>Platform</h3>
            <a href={getApiBase()}>Registry API</a>
            <Link to="/docs">Kova docs</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

function LandingPageShell({
  theme,
  children,
  userOverride,
  onUserChange,
}: {
  theme: ThemeSettings;
  children: ReactNode;
  userOverride?: AuthUser | null;
  onUserChange?: (user: AuthUser | null) => void;
}) {
  const navigate = useNavigate();
  const { user: loadedUser, setUser: setLoadedUser } = useLandingUser();
  const user = userOverride === undefined ? loadedUser : userOverride;
  const setUser = onUserChange ?? setLoadedUser;

  return (
    <div className="home-page" data-theme={theme.resolved}>
      <LandingHeader
        user={user}
        onSignOut={() => {
          clearToken();
          setUser(null);
        }}
        onSearch={(query) => navigate(searchRoute({ q: query }))}
        theme={theme}
      />
      <main className="content-page-shell">{children}</main>
    </div>
  );
}

function DirectoryPackageCard({ item }: { item: PackageListItem }) {
  const Icon = familyIcons[item.family];
  const topics = topicsFor(item).slice(0, 2);
  const review = reviewLabel(item);

  return (
    <Link to={packageRoute(item.name)} className="directory-card">
      <div className="directory-card-head">
        <span className="directory-card-icon">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div>
          <h3>{item.displayName}</h3>
          <p>{item.ownerHandle ? `@${item.ownerHandle}` : "Kova publisher"}</p>
        </div>
      </div>
      <p className="directory-card-summary">{item.summary ?? "Kova-compatible package."}</p>
      <div className="directory-card-meta">
        <span>{familyLabels[item.family]}</span>
        {item.latestVersion ? <span>v{item.latestVersion}</span> : null}
        {topics.map((topic) => (
          <span key={topic}>#{topic}</span>
        ))}
        {item.stats ? <span>{formatCompactNumber(item.stats.downloads, "0")} downloads</span> : null}
        {review ? <span>{review}</span> : null}
        <span>{formatDate(item.updatedAt)}</span>
      </div>
    </Link>
  );
}

function OwnerPackageCard({
  item,
  onChanged,
}: {
  item: PackageListItem;
  onChanged: (item: PackageListItem) => void;
}) {
  const [displayName, setDisplayName] = useState(item.displayName);
  const [summary, setSummary] = useState(item.summary ?? "");
  const [tags, setTags] = useState((item.topics ?? []).join(", "));
  const [channel, setChannel] = useState(item.channel);
  const [nextName, setNextName] = useState(item.name);
  const [targetHandle, setTargetHandle] = useState("");
  const [yankMessage, setYankMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(item.displayName);
    setSummary(item.summary ?? "");
    setTags((item.topics ?? []).join(", "));
    setChannel(item.channel);
    setNextName(item.name);
  }, [item]);

  function applyPackage(result: { package: PackageListItem | null }) {
    if (!result.package) throw new Error("Package update returned no package.");
    onChanged(result.package);
  }

  async function runAction(action: () => Promise<{ package: PackageListItem | null }>, message: string) {
    setStatus(null);
    setError(null);
    try {
      applyPackage(await action());
      setStatus(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Package action failed.");
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const payload: PackageSettingsPayload = {
      displayName,
      summary: summary.trim() ? summary : null,
      tags: parseTags(tags),
      channel,
    };
    await runAction(() => updatePackageSettings(item.name, payload), "Package settings saved.");
  }

  const latestVersion = item.latestVersion;

  return (
    <article className={`owner-package-card${item.deletedAt ? " is-deleted" : ""}`}>
      <div className="owner-package-card-head">
        <div>
          <h3>{item.displayName}</h3>
          <span>{item.name}</span>
        </div>
        <div className="owner-package-actions">
          <Link to={packageRoute(item.name)}>View</Link>
          {item.deletedAt ? (
            <button type="button" onClick={() => void runAction(() => restorePackage(item.name), "Package restored.")}>
              Restore
            </button>
          ) : (
            <button type="button" onClick={() => void runAction(() => deletePackage(item.name), "Package deleted.")}>
              Delete
            </button>
          )}
        </div>
      </div>

      <form className="owner-package-form" onSubmit={saveSettings}>
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Summary
          <input value={summary} onChange={(event) => setSummary(event.target.value)} />
        </label>
        <label>
          Tags
          <input value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
        <label>
          Channel
          <select value={channel} onChange={(event) => setChannel(event.target.value as PackageListItem["channel"])}>
            <option value="community">Community</option>
            <option value="private">Private</option>
            <option value="official">Official</option>
          </select>
        </label>
        <button className="primary-action" type="submit">
          Save settings
        </button>
      </form>

      <div className="owner-package-tools">
        <label>
          Rename
          <span>
            <input value={nextName} onChange={(event) => setNextName(event.target.value)} />
            <button type="button" onClick={() => void runAction(() => renamePackage(item.name, nextName), "Package renamed.")}>
              Rename
            </button>
          </span>
        </label>
        <label>
          Transfer
          <span>
            <input placeholder="target-publisher" value={targetHandle} onChange={(event) => setTargetHandle(event.target.value)} />
            <button
              type="button"
              disabled={!targetHandle.trim()}
              onClick={() => void runAction(() => transferPackage(item.name, targetHandle), "Package transferred.")}
            >
              Transfer
            </button>
          </span>
        </label>
        <label>
          Yank latest version
          <span>
            <input placeholder={latestVersion ? `Reason for ${latestVersion}` : "No version"} value={yankMessage} onChange={(event) => setYankMessage(event.target.value)} />
            <button
              type="button"
              disabled={!latestVersion}
              onClick={() => void runAction(() => yankPackageVersion(item.name, latestVersion ?? "", yankMessage || null), "Version yanked.")}
            >
              Yank
            </button>
          </span>
        </label>
      </div>
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </article>
  );
}

function ModerationPanel() {
  const [reports, setReports] = useState<PackageReport[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchReviewerReports({ status: "open", limit: 20 })
      .then((page) => {
        if (!active) return;
        setReports(page.items);
        setAvailable(true);
      })
      .catch((err) => {
        if (!active) return;
        if (isAuthError(err)) {
          setAvailable(false);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load moderation reports.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function closeReport(
    report: PackageReport,
    action: "dismissed" | "approved" | "rejected" | "clean",
  ) {
    setStatus(null);
    setError(null);
    try {
      if (action === "clean") {
        await updatePackageModeration(report.packageName, {
          scanStatus: "clean",
          riskLevel: "low",
          summary: "Reviewer marked this package clean.",
        });
        setStatus("Package scan status updated.");
        return;
      }
      const result = await updateReviewerReport(report.id, {
        status: action === "dismissed" ? "dismissed" : "reviewed",
        moderationStatus: action === "dismissed" ? "pending" : action,
        resolution:
          action === "dismissed"
            ? "Report dismissed by reviewer."
            : `Package moderation marked ${action}.`,
      });
      if (result.report) {
        setReports((current) => current.filter((candidate) => candidate.id !== result.report?.id));
      }
      setStatus("Moderation report updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Moderation action failed.");
    }
  }

  if (!available) return null;

  return (
    <section className="content-section moderation-panel">
      <div className="content-section-head">
        <h2>Review queue</h2>
        <span>{reports.length} open</span>
      </div>
      {loading ? <p className="content-muted">Loading reports...</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {status ? <p className="form-success">{status}</p> : null}
      {!loading && reports.length === 0 ? <p className="content-muted">No open reports.</p> : null}
      <div className="moderation-list">
        {reports.map((report) => (
          <article className="moderation-row" key={report.id}>
            <div>
              <Link to={packageRoute(report.packageName)}>{report.packageName}</Link>
              <p>{report.reason}</p>
              <small>
                Reported by @{report.user.handle} - {formatDate(report.createdAt)}
              </small>
            </div>
            <div className="moderation-actions">
              <button type="button" onClick={() => void closeReport(report, "approved")}>
                Approve
              </button>
              <button type="button" onClick={() => void closeReport(report, "rejected")}>
                Reject
              </button>
              <button type="button" onClick={() => void closeReport(report, "dismissed")}>
                Dismiss
              </button>
              <button type="button" onClick={() => void closeReport(report, "clean")}>
                Mark clean
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OrganizationPanel() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchMyOrganizations()
      .then((result) => {
        if (active) setOrganizations(result.organizations);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load organizations.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus(null);
    setError(null);
    try {
      const result = await createOrganization({
        handle,
        displayName: optionalText(displayName) ?? undefined,
        description: optionalText(description),
      });
      setOrganizations((current) => [...current, result.organization]);
      setHandle("");
      setDisplayName("");
      setDescription("");
      setStatus("Organization created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization creation failed.");
    }
  }

  return (
    <section className="content-section organization-panel">
      <div className="content-section-head">
        <h2>Organizations</h2>
        <span>{organizations.length} teams</span>
      </div>
      <form className="organization-form" onSubmit={submit}>
        <label>
          Handle
          <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="team-handle" />
        </label>
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Team name" />
        </label>
        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this team publishes" />
        </label>
        <button className="primary-action" type="submit" disabled={!handle.trim()}>
          Create organization
        </button>
      </form>
      {loading ? <p className="content-muted">Loading organizations...</p> : null}
      {status ? <p className="form-success">{status}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div className="organization-list">
        {organizations.map((organization) => (
          <Link className="organization-row" to={publisherRoute(organization.handle)} key={organization.id}>
            <span>
              <strong>{organization.displayName}</strong>
              <small>@{organization.handle}</small>
            </span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function DirectoryPage({ kind, theme }: { kind: "skills" | "plugins"; theme: ThemeSettings }) {
  const { packages, loading, error } = usePackageCatalog();
  const isSkills = kind === "skills";
  const items = packages.filter((item) => (isSkills ? item.family === "skill" : item.family !== "skill"));
  const title = isSkills ? "KovaHub Skills" : "KovaHub Plugins";
  const label = isSkills ? "SKILL DIRECTORY" : "PLUGIN DIRECTORY";
  const description = isSkills
    ? "Agent-ready skills published for Kova workflows, research, release work, and automation."
    : "Gateway-ready code and bundle plugins with compatibility metadata for Kova deployments.";
  const actionTarget = marketplaceRoute({ family: isSkills ? "skill" : "code-plugin" });

  return (
    <LandingPageShell theme={theme}>
      <section className="content-hero">
        <p>{label}</p>
        <h1>{title}</h1>
        <span>{description}</span>
        <div className="content-actions">
          <Link className="content-primary-action" to={actionTarget}>
            Browse marketplace <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="content-secondary-action" to="/publish">
            Publish package
          </Link>
        </div>
      </section>

      <section className="content-section">
        <div className="content-section-head">
          <h2>{isSkills ? "Latest skills" : "Latest plugins"}</h2>
          <span>{items.length} listed</span>
        </div>
        {loading ? <p className="content-muted">Loading packages...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        {!loading && items.length === 0 ? <p className="content-muted">No packages published yet.</p> : null}
        <div className="directory-grid">
          {items.map((item) => (
            <DirectoryPackageCard item={item} key={item.name} />
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function PublishersPage({ theme }: { theme: ThemeSettings }) {
  const { packages, loading, error } = usePackageCatalog();
  const publishers = useMemo(() => {
    const byHandle = new Map<
      string,
      { handle: string; packages: number; skills: number; plugins: number; latest: number }
    >();

    packages.forEach((item) => {
      const handle = item.ownerHandle;
      if (!handle) return;
      const current = byHandle.get(handle) ?? {
        handle,
        packages: 0,
        skills: 0,
        plugins: 0,
        latest: 0,
      };
      current.packages += 1;
      if (item.family === "skill") current.skills += 1;
      else current.plugins += 1;
      current.latest = Math.max(current.latest, item.updatedAt);
      byHandle.set(handle, current);
    });

    return Array.from(byHandle.values()).sort((a, b) => b.latest - a.latest);
  }, [packages]);

  return (
    <LandingPageShell theme={theme}>
      <section className="content-hero">
        <p>PUBLISHERS</p>
        <h1>Kova builders and teams</h1>
        <span>Discover the people and organizations publishing Kova-compatible packages.</span>
        <div className="content-actions">
          <Link className="content-primary-action" to="/publish">
            Publish with GitHub <Github size={16} aria-hidden="true" />
          </Link>
          <Link className="content-secondary-action" to="/marketplace">
            Browse packages
          </Link>
        </div>
      </section>

      <section className="content-section">
        <div className="content-section-head">
          <h2>Publisher index</h2>
          <span>{publishers.length} active</span>
        </div>
        {loading ? <p className="content-muted">Loading publishers...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        {!loading && publishers.length === 0 ? <p className="content-muted">No publishers yet.</p> : null}
        <div className="publisher-grid">
          {publishers.map((publisher) => (
            <Link
              className="publisher-card"
              to={publisherRoute(publisher.handle)}
              key={publisher.handle}
            >
              <span className="publisher-avatar">
                <Users size={19} aria-hidden="true" />
              </span>
              <div>
                <h3>@{publisher.handle}</h3>
                <p>
                  {publisher.packages} packages · {publisher.plugins} plugins · {publisher.skills} skills
                </p>
              </div>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function ProfileAvatar({
  profile,
  user,
  handle,
}: {
  profile?: UserProfile | null;
  user?: AuthUser | null;
  handle: string;
}) {
  const imageUrl = profile?.imageUrl ?? user?.imageUrl ?? null;
  const label = profile?.displayName ?? user?.displayName ?? handle;

  return (
    <span className="profile-avatar" aria-hidden="true">
      {imageUrl ? <img src={imageUrl} alt="" /> : profileInitial(label || handle)}
    </span>
  );
}

function ProfileMeta({ profile }: { profile: UserProfile }) {
  const entries = [
    profile.company ? ["Company", profile.company] : null,
    profile.location ? ["Location", profile.location] : null,
  ].filter((item): item is [string, string] => Boolean(item));

  return (
    <div className="profile-meta">
      {entries.map(([label, value]) => (
        <span key={label}>{value}</span>
      ))}
      {profile.websiteUrl ? (
        <a href={profile.websiteUrl} target="_blank" rel="noreferrer">
          Website <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

function ProfileStatsRow({ profile }: { profile: UserProfile }) {
  const stats: Array<[string, number]> = [
    ["Packages", profile.stats.packages],
    ["Plugins", profile.stats.plugins],
    ["Skills", profile.stats.skills],
    ["Downloads", profile.stats.downloads],
    ["Stars", profile.stats.stars],
  ];

  return (
    <div className="profile-stats" aria-label="Publisher stats">
      {stats.map(([label, value]) => (
        <span key={label}>
          <strong>{formatCompactNumber(value, "0")}</strong>
          {label}
        </span>
      ))}
    </div>
  );
}

function nullableProfileText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ProfilePage({ theme }: { theme: ThemeSettings }) {
  const { user, setUser, hasSession } = useLandingUser();
  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setForm(profileFormFromUser(user));
  }, [user]);

  function updateField(field: keyof ProfileFormState, value: string) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const result = await updateProfile({
        displayName: nullableProfileText(form.displayName),
        bio: nullableProfileText(form.bio),
        websiteUrl: nullableProfileText(form.websiteUrl),
        company: nullableProfileText(form.company),
        location: nullableProfileText(form.location),
      });
      setUser(result.user);
      setForm(profileFormFromUser(result.user));
      setStatus("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  if (!hasSession && !user) {
    return (
      <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
        <section className="auth-card profile-auth-card">
          <div className="section-title">
            <UserRound size={17} aria-hidden="true" />
            <h2>Sign in required</h2>
          </div>
          <p className="muted">GitHub sign-in is required to edit your KovaHub profile.</p>
          <a className="content-primary-action" href={githubLoginUrl("/profile")}>
            <Github size={16} aria-hidden="true" />
            Sign in with GitHub
          </a>
        </section>
      </LandingPageShell>
    );
  }

  if (!user || !form) {
    return (
      <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
        <section className="content-section">
          <p className="content-muted">Loading profile...</p>
        </section>
      </LandingPageShell>
    );
  }

  return (
    <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
      <section className="content-hero">
        <p>PROFILE</p>
        <div className="profile-hero-row">
          <ProfileAvatar user={user} handle={user.handle} />
          <div>
            <h1>{displayUserName(user)}</h1>
            <span>@{user.handle}</span>
          </div>
        </div>
        <span>Your public KovaHub identity for published plugins, skills, and registry activity.</span>
        <div className="content-actions">
          <Link className="content-primary-action" to={publisherRoute(user.handle)}>
            Public profile <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="content-secondary-action" to="/publish">
            Publish package
          </Link>
        </div>
      </section>

      <section className="profile-grid">
        <form className="profile-card profile-form" onSubmit={saveProfile}>
          <div className="section-title">
            <UserRound size={17} aria-hidden="true" />
            <h2>Profile details</h2>
          </div>
          <label>
            Display name
            <input
              value={form.displayName}
              onChange={(event) => updateField("displayName", event.target.value)}
              placeholder="Kova publisher"
            />
          </label>
          <label>
            Bio
            <textarea
              value={form.bio}
              onChange={(event) => updateField("bio", event.target.value)}
              maxLength={280}
              placeholder="What are you building for Kova?"
            />
          </label>
          <div className="profile-form-pair">
            <label>
              Website
              <input
                value={form.websiteUrl}
                onChange={(event) => updateField("websiteUrl", event.target.value)}
                placeholder="https://example.com"
              />
            </label>
            <label>
              Company
              <input
                value={form.company}
                onChange={(event) => updateField("company", event.target.value)}
                placeholder="Team or organization"
              />
            </label>
          </div>
          <label>
            Location
            <input
              value={form.location}
              onChange={(event) => updateField("location", event.target.value)}
              placeholder="City, country"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {status ? <p className="form-success">{status}</p> : null}
          <button className="primary-action" type="submit" disabled={saving}>
            <UserRound size={16} aria-hidden="true" />
            {saving ? "Saving..." : "Save profile"}
          </button>
        </form>

        <aside className="profile-card profile-preview">
          <div className="section-title">
            <Users size={17} aria-hidden="true" />
            <h2>Public preview</h2>
          </div>
          <div className="profile-preview-head">
            <ProfileAvatar user={user} handle={user.handle} />
            <div>
              <strong>{form.displayName.trim() || `@${user.handle}`}</strong>
              <span>@{user.handle}</span>
            </div>
          </div>
          <p>{form.bio.trim() || "No bio added yet."}</p>
          <div className="profile-meta">
            {form.company.trim() ? <span>{form.company.trim()}</span> : null}
            {form.location.trim() ? <span>{form.location.trim()}</span> : null}
            {form.websiteUrl.trim() ? <span>{form.websiteUrl.trim()}</span> : null}
          </div>
        </aside>
      </section>
    </LandingPageShell>
  );
}

function PublisherDetailPage({ theme }: { theme: ThemeSettings }) {
  const { handle = "" } = useParams();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const plugins = packages.filter((item) => item.family !== "skill").length;
  const skills = packages.filter((item) => item.family === "skill").length;
  const displayName = profile?.displayName || `@${handle}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setProfile(null);
    Promise.allSettled([fetchPackages({ owner: handle, limit: 100 }), fetchProfile(handle)])
      .then(([packagesResult, profileResult]) => {
        if (!active) return;
        if (packagesResult.status === "fulfilled") setPackages(packagesResult.value.items);
        else {
          setPackages([]);
          setError(packagesResult.reason instanceof Error ? packagesResult.reason.message : "Failed to load publisher packages.");
        }
        if (profileResult.status === "fulfilled") setProfile(profileResult.value.profile);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [handle]);

  return (
    <LandingPageShell theme={theme}>
      <section className="content-hero">
        <p>PUBLISHER</p>
        <div className="profile-hero-row">
          <ProfileAvatar profile={profile} handle={handle} />
          <div>
            <h1>{displayName}</h1>
            <span>@{handle}</span>
          </div>
        </div>
        <span>{profile?.bio ?? `${packages.length} Kova-compatible packages · ${plugins} plugins · ${skills} skills`}</span>
        {profile ? <ProfileMeta profile={profile} /> : null}
        {profile ? <ProfileStatsRow profile={profile} /> : null}
        <div className="content-actions">
          <Link className="content-primary-action" to={marketplaceRoute({ owner: handle })}>
            Search publisher <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="content-secondary-action" to="/publishers">
            All publishers
          </Link>
        </div>
      </section>

      <section className="content-section">
        <div className="content-section-head">
          <h2>Published packages</h2>
          <span>{packages.length} listed</span>
        </div>
        {loading ? <p className="content-muted">Loading publisher packages...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        {!loading && packages.length === 0 ? <p className="content-muted">No packages found for this publisher.</p> : null}
        <div className="directory-grid">
          {packages.map((item) => (
            <DirectoryPackageCard item={item} key={item.name} />
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function TagPage({ theme }: { theme: ThemeSettings }) {
  const { tag = "" } = useParams();
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPackages({ tag, limit: 100 })
      .then((page) => {
        if (active) setPackages(page.items);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load tag packages.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tag]);

  return (
    <LandingPageShell theme={theme}>
      <section className="content-hero">
        <p>TOPIC</p>
        <h1>#{tag}</h1>
        <span>Packages tagged for this KovaHub discovery topic.</span>
        <div className="content-actions">
          <Link className="content-primary-action" to={marketplaceRoute({ tag })}>
            Search topic <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="content-secondary-action" to="/marketplace">
            Browse marketplace
          </Link>
        </div>
      </section>

      <section className="content-section">
        <div className="content-section-head">
          <h2>Tagged packages</h2>
          <span>{packages.length} listed</span>
        </div>
        {loading ? <p className="content-muted">Loading tag packages...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        {!loading && packages.length === 0 ? <p className="content-muted">No packages found for this topic.</p> : null}
        <div className="directory-grid">
          {packages.map((item) => (
            <DirectoryPackageCard item={item} key={item.name} />
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function DocsPage({ theme }: { theme: ThemeSettings }) {
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <LandingPageShell theme={theme}>
      <section className="content-hero">
        <p>DOCS</p>
        <h1>KovaHub registry docs</h1>
        <span>Registry targets, package contracts, and compatibility fields for Kova clients.</span>
        <div className="content-actions">
          <a className="content-primary-action" href={`${getApiBase()}/api/v1/meta`}>
            Open API metadata <BookOpen size={16} aria-hidden="true" />
          </a>
          <Link className="content-secondary-action" to="/publish">
            Publish package
          </Link>
        </div>
      </section>

      <section className="docs-grid">
        <article className="docs-card">
          <KeyRound size={19} aria-hidden="true" />
          <h2>Environment targets</h2>
          <code>KOVA_KOVAHUB_URL={getApiBase()}</code>
          <code>KOVAHUB_URL={getApiBase()}</code>
          <code>KOVAHUB_REGISTRY={getApiBase()}</code>
          <code>KOVAHUB_SITE={siteUrl || "http://localhost:5173"}</code>
        </article>
        <article className="docs-card">
          <ShieldCheck size={19} aria-hidden="true" />
          <h2>Compatibility metadata</h2>
          <p>Plugin packages must include compatible API and gateway fields.</p>
          <code>pluginApi</code>
          <code>minGatewayVersion</code>
        </article>
        <article className="docs-card">
          <Package size={19} aria-hidden="true" />
          <h2>Registry endpoints</h2>
          <code>GET /api/v1/packages</code>
          <code>GET /api/v1/packages/:name/download</code>
          <code>GET /.well-known/kovahub.json</code>
        </article>
      </section>
    </LandingPageShell>
  );
}

function parseSearchKind(value: string | null): SearchKind {
  return value === "skills" || value === "plugins" ? value : "all";
}

function SearchPage({ theme }: { theme: ThemeSettings }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = parseSearchKind(searchParams.get("type"));
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [items, setItems] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    const q = searchParams.get("q") ?? "";
    setLoading(true);
    setError(null);
    fetchPackages({
      q: q.trim() || undefined,
      family: activeType === "skills" ? "skill" : undefined,
      limit: 100,
      sort: "trending",
    })
      .then((page) => {
        if (!active) return;
        setItems(activeType === "plugins" ? page.items.filter((item) => item.family !== "skill") : page.items);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to search packages.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeType, searchParams]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (activeType !== "all") next.set("type", activeType);
    setSearchParams(next);
  }

  function setType(type: SearchKind) {
    const next = new URLSearchParams(searchParams);
    if (type === "all") next.delete("type");
    else next.set("type", type);
    setSearchParams(next);
  }

  const skillCount = items.filter((item) => item.family === "skill").length;
  const pluginCount = items.filter((item) => item.family !== "skill").length;

  return (
    <LandingPageShell theme={theme}>
      <section className="content-hero">
        <p>SEARCH</p>
        <h1>{searchParams.get("q") ? `Results for "${searchParams.get("q")}"` : "Search KovaHub"}</h1>
        <span>Find Kova-compatible skills, code plugins, bundle plugins, publishers, and compatibility metadata.</span>
      </section>

      <section className="content-section search-page-section">
        <form className="search-page-form" onSubmit={submitSearch}>
          <div className="search-box search-page-field">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills and plugins..." />
          </div>
          <button className="content-primary-action" type="submit">
            Search <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>

        <div className="search-tabs" role="tablist" aria-label="Search result type">
          {(["all", "skills", "plugins"] as const).map((type) => (
            <button
              className={activeType === type ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={activeType === type}
              key={type}
              onClick={() => setType(type)}
            >
              {type}
              <span>{type === "skills" ? skillCount : type === "plugins" ? pluginCount : items.length}</span>
            </button>
          ))}
        </div>

        {loading ? <p className="content-muted">Searching...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        {!loading && items.length === 0 ? <p className="content-muted">No matches found.</p> : null}
        <div className="directory-grid">
          {items.map((item) => (
            <DirectoryPackageCard item={item} key={item.name} />
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function StarsPage({ theme }: { theme: ThemeSettings }) {
  const { user, setUser, hasSession } = useLandingUser();
  const [items, setItems] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(hasSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSession) {
      setItems([]);
      setLoading(false);
      return;
    }
    if (!user) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchStarredPackages({ limit: 100 })
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load highlights.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hasSession, user]);

  if (!hasSession && !user) {
    return (
      <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
        <section className="auth-card profile-auth-card">
          <div className="section-title">
            <Star size={17} aria-hidden="true" />
            <h2>Sign in to see your highlights</h2>
          </div>
          <p className="muted">Star KovaHub packages for quick access later.</p>
          <a className="content-primary-action" href={githubLoginUrl("/stars")}>
            <Github size={16} aria-hidden="true" />
            Sign in with GitHub
          </a>
        </section>
      </LandingPageShell>
    );
  }

  return (
    <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
      <section className="content-hero">
        <p>HIGHLIGHTS</p>
        <h1>Your starred packages</h1>
        <span>ClawHub-style highlights for skills and plugins you want to revisit.</span>
        <div className="content-actions">
          <Link className="content-primary-action" to="/search">
            Find packages <Search size={16} aria-hidden="true" />
          </Link>
          <Link className="content-secondary-action" to="/marketplace">
            Marketplace
          </Link>
        </div>
      </section>

      <section className="content-section">
        <div className="content-section-head">
          <h2>Starred packages</h2>
          <span>{items.length} saved</span>
        </div>
        {loading ? <p className="content-muted">Loading highlights...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        {!loading && items.length === 0 ? <p className="content-muted">No starred packages yet.</p> : null}
        <div className="directory-grid">
          {items.map((item) => (
            <DirectoryPackageCard item={item} key={item.name} />
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function DashboardPage({ theme }: { theme: ThemeSettings }) {
  const { user, setUser, hasSession } = useLandingUser();
  const [items, setItems] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(hasSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSession) {
      setItems([]);
      setLoading(false);
      return;
    }
    if (!user) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchOwnerPackages({ limit: 100 })
      .then((page) => {
        if (active) setItems(page.items);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load dashboard.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hasSession, user]);

  if (!hasSession && !user) {
    return (
      <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
        <section className="auth-card profile-auth-card">
          <div className="section-title">
            <LayoutDashboard size={17} aria-hidden="true" />
            <h2>Sign in to access your dashboard</h2>
          </div>
          <p className="muted">GitHub sign-in is required to manage your KovaHub packages.</p>
          <a className="content-primary-action" href={githubLoginUrl("/dashboard")}>
            <Github size={16} aria-hidden="true" />
            Sign in with GitHub
          </a>
        </section>
      </LandingPageShell>
    );
  }

  const stats = items.reduce(
    (accumulator, item) => ({
      packages: accumulator.packages + 1,
      downloads: accumulator.downloads + (item.stats?.downloads ?? 0),
      stars: accumulator.stars + (item.stats?.stars ?? 0),
      pending: accumulator.pending + (item.moderationStatus === "pending" ? 1 : 0),
    }),
    { packages: 0, downloads: 0, stars: 0, pending: 0 },
  );

  return (
    <LandingPageShell theme={theme} userOverride={user} onUserChange={setUser}>
      <section className="content-hero">
        <p>DASHBOARD</p>
        <h1>{user ? `@${user.handle}` : "Publisher dashboard"}</h1>
        <span>Manage your KovaHub package activity, publishing tokens, and review status.</span>
        <div className="content-actions">
          <Link className="content-primary-action" to="/publish">
            Publish package <UploadCloud size={16} aria-hidden="true" />
          </Link>
          {user ? (
            <Link className="content-secondary-action" to={publisherRoute(user.handle)}>
              Public profile
            </Link>
          ) : null}
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="profile-card">
          <div className="section-title">
            <LayoutDashboard size={17} aria-hidden="true" />
            <h2>Publisher stats</h2>
          </div>
          <div className="profile-stats dashboard-stats">
            <span><strong>{stats.packages}</strong>Packages</span>
            <span><strong>{formatCompactNumber(stats.downloads, "0")}</strong>Downloads</span>
            <span><strong>{formatCompactNumber(stats.stars, "0")}</strong>Stars</span>
            <span><strong>{stats.pending}</strong>Pending</span>
          </div>
        </article>
        <ApiTokenPanel user={user} />
      </section>

      <OrganizationPanel />

      <ModerationPanel />

      <section className="content-section">
        <div className="content-section-head">
          <h2>Your packages</h2>
          <span>{items.length} listed</span>
        </div>
        {loading ? <p className="content-muted">Loading packages...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        {!loading && items.length === 0 ? <p className="content-muted">No packages published yet.</p> : null}
        <div className="directory-grid">
          {items.map((item) => (
            <OwnerPackageCard
              item={item}
              key={item.name}
              onChanged={(updated) => setItems((current) => current.map((candidate) => (candidate.name === item.name ? updated : candidate)))}
            />
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function AuditsPage({ theme }: { theme: ThemeSettings }) {
  const { packages, loading, error } = usePackageCatalog();
  const auditItems = packages.filter(
    (item) =>
      item.scanStatus ||
      item.moderationStatus ||
      item.verificationTier ||
      item.executesCode ||
      item.family !== "skill",
  );
  const pending = auditItems.filter((item) => item.scanStatus === "pending" || item.moderationStatus === "pending").length;
  const codePackages = auditItems.filter((item) => item.executesCode).length;

  return (
    <LandingPageShell theme={theme}>
      <section className="content-hero">
        <p>AUDITS</p>
        <h1>Package review queue</h1>
        <span>Security and moderation signals for Kova-compatible packages.</span>
        <div className="profile-stats">
          <span><strong>{auditItems.length}</strong>Tracked</span>
          <span><strong>{pending}</strong>Pending</span>
          <span><strong>{codePackages}</strong>Execute code</span>
        </div>
      </section>

      <section className="content-section">
        <div className="content-section-head">
          <h2>Audit signals</h2>
          <span>{auditItems.length} packages</span>
        </div>
        {loading ? <p className="content-muted">Loading audits...</p> : null}
        {error ? <p className="content-muted">{error}</p> : null}
        <div className="audit-list">
          {auditItems.map((item) => (
            <Link className="audit-row" to={packageRoute(item.name)} key={item.name}>
              <span className="audit-icon">
                <ListChecks size={18} aria-hidden="true" />
              </span>
              <span>
                <strong>{item.displayName}</strong>
                <small>{item.name}</small>
              </span>
              <span>{familyLabels[item.family]}</span>
              <span>{formatStatus(item.moderationStatus)}</span>
              <span>{formatStatus(item.scanStatus)}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </LandingPageShell>
  );
}

function Marketplace({ publishMode = false }: { publishMode?: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeName = useRoutePackageName();
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [family, setFamily] = useState<PackageFamily | "all">(parseRouteFamily(searchParams.get("family")));
  const [sort, setSort] = useState<PackageSort>(parseRouteSort(searchParams.get("sort")));
  const [ownerFilter, setOwnerFilter] = useState(searchParams.get("owner") ?? "");
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag") ?? "");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const activeName = routeName ?? packages[0]?.name ?? null;

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setFamily(parseRouteFamily(searchParams.get("family")));
    setSort(parseRouteSort(searchParams.get("sort")));
    setOwnerFilter(searchParams.get("owner") ?? "");
    setTagFilter(searchParams.get("tag") ?? "");
  }, [searchParams]);

  const loadPackages = useCallback(async (cursor?: string | null) => {
    const append = Boolean(cursor);
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await fetchPackages({
        q: query.trim() || undefined,
        family: family === "all" ? undefined : family,
        owner: ownerFilter.trim() || undefined,
        tag: tagFilter.trim() || undefined,
        sort,
        cursor,
        limit: 20,
      });
      setPackages((current) => (append ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load packages.");
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [family, ownerFilter, query, sort, tagFilter]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  useEffect(() => {
    if (!getStoredToken()) return;
    fetchMe()
      .then((result) => setUser(result.user))
      .catch((err) => {
        if (isAuthError(err)) clearToken();
      });
  }, []);

  useEffect(() => {
    if (!activeName || publishMode) {
      setDetail(null);
      return;
    }
    fetchPackageDetail(activeName)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [activeName, publishMode]);

  function searchSubmit(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (family !== "all") next.set("family", family);
    if (sort !== "recent") next.set("sort", sort);
    if (ownerFilter.trim()) next.set("owner", ownerFilter.trim());
    if (tagFilter.trim()) next.set("tag", tagFilter.trim());
    setSearchParams(next);
  }

  function clearDiscoveryFilters() {
    const next = new URLSearchParams(searchParams);
    next.delete("owner");
    next.delete("tag");
    setSearchParams(next);
  }

  function applyPackageUpdate(item: PackageListItem) {
    setPackages((current) => current.map((candidate) => (candidate.name === item.name ? item : candidate)));
    setDetail((current) =>
      current?.package?.name === item.name
        ? {
            ...current,
            package: {
              ...current.package,
              ...item,
              stats: item.stats ?? current.package.stats,
            },
          }
        : current,
    );
  }

  const visibleMeta = useMemo(() => {
    const plugins = packages.filter((item) => item.family !== "skill").length;
    const skills = packages.filter((item) => item.family === "skill").length;
    return { plugins, skills, total: packages.length };
  }, [packages]);

  return (
    <>
      <Header
        user={user}
        onSignOut={() => {
          clearToken();
          setUser(null);
        }}
      />
      <main className="app-shell">
        <section className="workspace-head">
          <div>
            <h1>KovaHub Registry</h1>
            <p>Fresh marketplace infrastructure for Kova plugins, bundle plugins, and skills.</p>
          </div>
          <div className="registry-target">
            <span>Registry target</span>
            <code>KOVAHUB_REGISTRY={getApiBase()}</code>
          </div>
        </section>

        <section className="market-grid">
          <aside className="browse-panel">
            <form className="search-box" onSubmit={searchSubmit}>
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search packages..."
              />
            </form>
            <div className="filter-row" aria-label="Package family filters">
              {(["all", "code-plugin", "bundle-plugin", "skill"] as const).map((value) => (
                <button
                  className={family === value ? "is-active" : ""}
                  type="button"
                  key={value}
                  onClick={() => {
                    setFamily(value);
                    const next = new URLSearchParams(searchParams);
                    if (value === "all") next.delete("family");
                    else next.set("family", value);
                    setSearchParams(next);
                  }}
                >
                  {value === "all" ? "All" : familyLabels[value]}
                </button>
              ))}
            </div>
            <div className="filter-row" aria-label="Package sort">
              {(["recent", "trending", "popular"] as const).map((value) => (
                <button
                  className={sort === value ? "is-active" : ""}
                  type="button"
                  key={value}
                  onClick={() => {
                    setSort(value);
                    const next = new URLSearchParams(searchParams);
                    if (value === "recent") next.delete("sort");
                    else next.set("sort", value);
                    setSearchParams(next);
                  }}
                >
                  {sortLabels[value]}
                </button>
              ))}
            </div>
            <div className="browse-stats">
              <span>{visibleMeta.total} packages</span>
              <span>{visibleMeta.plugins} plugins</span>
              <span>{visibleMeta.skills} skills</span>
            </div>
            {ownerFilter || tagFilter ? (
              <div className="active-discovery-filters" aria-label="Active discovery filters">
                {ownerFilter ? <Link to={publisherRoute(ownerFilter)}>@{ownerFilter}</Link> : null}
                {tagFilter ? <Link to={tagRoute(tagFilter)}>#{tagFilter}</Link> : null}
                <button type="button" onClick={clearDiscoveryFilters}>
                  Clear
                </button>
              </div>
            ) : null}
            <div className="results-list">
              {loading ? <p className="muted">Loading registry...</p> : null}
              {error ? <p className="form-error">{error}</p> : null}
              {!loading && packages.length === 0 ? <p className="muted">No packages found.</p> : null}
              {packages.map((item) => (
                <PackageRow key={item.name} item={item} active={item.name === activeName} />
              ))}
            </div>
            {nextCursor && !loading ? (
              <button
                className="load-more-button"
                type="button"
                disabled={loadingMore}
                onClick={() => void loadPackages(nextCursor)}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            ) : null}
          </aside>

          {publishMode ? (
            <div className="publish-stack">
              <PublishPanel
                user={user}
                onPublished={(name) => {
                  void loadPackages();
                  navigate(packageRoute(name));
                }}
              />
              <ApiTokenPanel user={user} />
            </div>
          ) : (
            <DetailPanel detail={detail} user={user} onPackageUpdated={applyPackageUpdate} />
          )}
        </section>
      </main>
    </>
  );
}

export default function App() {
  const theme = useThemeSettings();

  return (
    <Routes>
      <Route path="/" element={<HomeLanding theme={theme} />} />
      <Route path="/skills" element={<DirectoryPage kind="skills" theme={theme} />} />
      <Route path="/plugins" element={<DirectoryPage kind="plugins" theme={theme} />} />
      <Route path="/profile" element={<ProfilePage theme={theme} />} />
      <Route path="/publishers/:handle" element={<PublisherDetailPage theme={theme} />} />
      <Route path="/publishers" element={<PublishersPage theme={theme} />} />
      <Route path="/tags/:tag" element={<TagPage theme={theme} />} />
      <Route path="/docs" element={<DocsPage theme={theme} />} />
      <Route path="/search" element={<SearchPage theme={theme} />} />
      <Route path="/stars" element={<StarsPage theme={theme} />} />
      <Route path="/dashboard" element={<DashboardPage theme={theme} />} />
      <Route path="/audits" element={<AuditsPage theme={theme} />} />
      <Route path="/skills/publish" element={<Marketplace publishMode />} />
      <Route path="/plugins/publish" element={<Marketplace publishMode />} />
      <Route path="/skills/:slug" element={<Marketplace />} />
      <Route path="/plugins/*" element={<Marketplace />} />
      <Route path="/marketplace" element={<Marketplace />} />
      <Route path="/packages/*" element={<Marketplace />} />
      <Route path="/publish" element={<Marketplace publishMode />} />
      <Route path="/auth/device" element={<DeviceAuthPage theme={theme} />} />
      <Route path="/auth/github/callback" element={<GitHubAuthCallback />} />
    </Routes>
  );
}
