import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FileArchive,
  Github,
  History,
  KeyRound,
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
  clearToken,
  createApiToken,
  fetchMe,
  fetchPackageDetail,
  fetchPackages,
  getApiBase,
  getStoredToken,
  githubLoginUrl,
  packageDownloadUrl,
  publishArchivePackage,
  publishPackage,
  revokeApiToken,
  listApiTokens,
  storeToken,
} from "./api";
import { kovaRoboLogo } from "./brandAssets";
import type {
  AuthUser,
  ApiTokenSummary,
  PackageDetail,
  PackageFamily,
  PackageListItem,
  PublishArchiveMetadata,
  PublishPayload,
} from "./types";

const familyLabels: Record<PackageFamily, string> = {
  skill: "Skill",
  "code-plugin": "Code plugin",
  "bundle-plugin": "Bundle plugin",
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
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!getStoredToken()) return;
    let active = true;
    fetchMe()
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch(() => {
        clearToken();
        if (active) setUser(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return { user, setUser };
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

function safeLocalPath(value: string | null) {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  return "/publish";
}

function packageRoute(name: string) {
  return `/packages/${encodeURIComponent(name)}`;
}

function marketplaceRoute(params: { q?: string; family?: PackageFamily; owner?: string; tag?: string } = {}) {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.family) query.set("family", params.family);
  if (params.owner?.trim()) query.set("owner", params.owner.trim());
  if (params.tag?.trim()) query.set("tag", params.tag.trim());
  const suffix = query.toString();
  return `/marketplace${suffix ? `?${suffix}` : ""}`;
}

function publisherRoute(handle: string) {
  return `/publishers/${encodeURIComponent(handle)}`;
}

function tagRoute(tag: string) {
  return `/tags/${encodeURIComponent(tag)}`;
}

function useRoutePackageName() {
  const params = useParams();
  const wildcard = params["*"];
  return wildcard ? decodeURIComponent(wildcard) : null;
}

function parseRouteFamily(value: string | null): PackageFamily | "all" {
  return value && value in familyLabels ? (value as PackageFamily) : "all";
}

function topicsFor(item: Pick<PackageListItem, "topics">) {
  return item.topics?.filter(Boolean) ?? [];
}

function formatStatus(value?: string | null) {
  return value ? value.replace(/-/g, " ") : "unknown";
}

function reviewLabel(item: Pick<PackageListItem, "moderationStatus">) {
  if (!item.moderationStatus || item.moderationStatus === "approved") return null;
  return item.moderationStatus === "pending" ? "Pending review" : "Review rejected";
}

const fallbackSkillCards: HomeCardItem[] = [
  {
    name: "release-notes-sherpa",
    displayName: "Release Notes Sherpa",
    ownerHandle: "openkova",
    summary: "Turns changelogs and commit ranges into concise release notes.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "112",
    downloads: "12.2k",
    kind: "skill",
  },
  {
    name: "context-bridge",
    displayName: "Context Bridge",
    ownerHandle: "openkova",
    summary: "Gateway-side context extension for Kova agents.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "147",
    downloads: "38.0k",
    kind: "skill",
  },
  {
    name: "skill-vetter",
    displayName: "Skill Vetter",
    ownerHandle: "openkova",
    summary: "Check packages before installing them into a Kova workspace.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "144",
    downloads: "43.7k",
    kind: "skill",
  },
  {
    name: "gateway-notes",
    displayName: "Gateway Notes",
    ownerHandle: "openkova",
    summary: "Capture and summarize agent memory, handoffs, and workflow context.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "229",
    downloads: "28.0k",
    kind: "skill",
  },
  {
    name: "answer-archive",
    displayName: "Answer Archive",
    ownerHandle: "openkova",
    summary: "Search indexed community discussions and package documentation.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "165",
    downloads: "18.7k",
    kind: "skill",
  },
];

const fallbackPluginCards: HomeCardItem[] = [
  {
    name: "context-bridge",
    displayName: "Context Bridge",
    ownerHandle: "openkova",
    summary: "Gateway-side context extension for Kova agents.",
    family: "code-plugin",
    href: marketplaceRoute({ family: "code-plugin" }),
    version: "0.1.0",
    stars: "121",
    downloads: "185.3k",
    kind: "plugin",
  },
  {
    name: "gateway-exporter",
    displayName: "Gateway Exporter",
    ownerHandle: "openkova",
    summary: "Export Kova gateway traces and package events to observability tools.",
    family: "code-plugin",
    href: marketplaceRoute({ family: "code-plugin" }),
    version: "0.5.0",
    stars: "601",
    downloads: "180.5k",
    kind: "plugin",
  },
  {
    name: "github-runner",
    displayName: "GitHub Runner",
    ownerHandle: "openkova",
    summary: "Interact with GitHub issues, pull requests, and workflow runs from Kova.",
    family: "code-plugin",
    href: marketplaceRoute({ family: "code-plugin" }),
    version: "1.0.0",
    stars: "594",
    downloads: "177.4k",
    kind: "plugin",
  },
];

const trendingFallbackCards: HomeCardItem[] = [
  {
    name: "self-improving-agent",
    displayName: "Self-Improving Agent",
    ownerHandle: "openkova",
    summary: "Captures learnings, errors, and corrections to enable continuous improvement.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "3.6k",
    downloads: "436.1k",
    kind: "skill",
  },
  {
    name: "skill-vetter",
    displayName: "Skill Vetter",
    ownerHandle: "openkova",
    summary: "Security-first skill vetting for agent package installs.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "1.1k",
    downloads: "239.6k",
    kind: "skill",
  },
  {
    name: "proactive-agent",
    displayName: "Self-Improving + Proactive Agent",
    ownerHandle: "openkova",
    summary: "Self-reflection, learning, and self-organization for long-running agents.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "1.1k",
    downloads: "186.4k",
    kind: "skill",
  },
  {
    name: "market-monitor",
    displayName: "Market Monitor",
    ownerHandle: "openkova",
    summary: "Query prediction markets, track price movements, and monitor events.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "121",
    downloads: "185.3k",
    kind: "skill",
  },
  {
    name: "ontology",
    displayName: "ontology",
    ownerHandle: "openkova",
    summary: "Typed knowledge graph for structured agent memory and composable skills.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "601",
    downloads: "180.5k",
    kind: "skill",
  },
  {
    name: "github",
    displayName: "Github",
    ownerHandle: "openkova",
    summary: "Interact with GitHub from Kova using issues, pull requests, and workflow runs.",
    family: "skill",
    href: marketplaceRoute({ family: "skill" }),
    stars: "594",
    downloads: "177.4k",
    kind: "skill",
  },
];

function toHomeCard(item: PackageListItem, index: number, kind?: HomeCardKind): HomeCardItem {
  const resolvedKind = kind ?? (item.family === "skill" ? "skill" : "plugin");
  return {
    name: item.name,
    displayName: item.displayName,
    ownerHandle: item.ownerHandle,
    summary: item.summary,
    family: item.family,
    href: packageRoute(item.name),
    version: item.latestVersion,
    stars: ["112", "147", "144", "229", "165", "3.6k"][index % 6] ?? "112",
    downloads: ["12.2k", "38.0k", "43.7k", "28.0k", "18.7k", "436.1k"][index % 6] ?? "12.2k",
    kind: resolvedKind,
  };
}

function homeCardKey(item: HomeCardItem) {
  return `${item.kind}:${item.displayName.toLowerCase()}`;
}

function fillCards(cards: HomeCardItem[], fallback: HomeCardItem[], count: number): HomeCardItem[] {
  const seen = new Set(cards.map(homeCardKey));
  const base = [...cards, ...fallback.filter((item) => !seen.has(homeCardKey(item)))];
  const filled: HomeCardItem[] = [];

  if (base.length === 0) return filled;

  for (let index = 0; index < count; index += 1) {
    const item = base[index % base.length];
    if (item) filled.push(item);
  }

  return filled;
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
          <a href={`${getApiBase()}/api/v1/meta`}>Registry API</a>
          <Link to="/publish">Publish</Link>
        </nav>
        {user ? (
          <div className="user-chip">
            <UserRound size={15} aria-hidden="true" />
            <span>@{user.handle}</span>
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
          {review ? <span>{review}</span> : null}
          <span>{formatDate(item.updatedAt)}</span>
        </span>
      </span>
    </Link>
  );
}

function DetailPanel({ detail }: { detail: PackageDetail | null }) {
  const pkg = detail?.package;
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
        <a className="primary-action" href={packageDownloadUrl(pkg.name, pkg.latestVersion)}>
          <ArrowDownToLine size={16} aria-hidden="true" />
          Download
        </a>
      </div>

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
          <strong>{pkg.stats?.downloads ?? 0}</strong>
        </div>
        <div>
          <span className="stat-label">Versions</span>
          <strong>{pkg.stats?.versions ?? (pkg.latestVersion ? 1 : 0)}</strong>
        </div>
      </div>

      <div className="info-section">
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

      <div className="info-section">
        <h2>
          <ShieldCheck size={17} aria-hidden="true" />
          Compatibility
        </h2>
        <div className="compat-grid">
          <InfoCell label="pluginApi" value={compatibility?.pluginApiRange ?? "Not required"} />
          <InfoCell label="minGatewayVersion" value={compatibility?.minGatewayVersion ?? "Any"} />
          <InfoCell
            label="builtWith"
            value={compatibility?.builtWithKovaVersion ?? "Not declared"}
          />
          <InfoCell label="pluginSdk" value={compatibility?.pluginSdkVersion ?? "Not declared"} />
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
  const [name, setName] = useState("@builder/demo-plugin");
  const [displayName, setDisplayName] = useState("Demo Plugin");
  const [version, setVersion] = useState("0.1.0");
  const [summary, setSummary] = useState("A Kova-compatible package published from KovaHub.");
  const [pluginApi, setPluginApi] = useState("^1.0.0");
  const [minGatewayVersion, setMinGatewayVersion] = useState("2026.3.0");
  const [readme, setReadme] = useState("# Demo Plugin\n\nDescribe the package here.\n");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archiveFamily, setArchiveFamily] = useState<PackageFamily | "auto">("auto");
  const [archiveName, setArchiveName] = useState("");
  const [archiveDisplayName, setArchiveDisplayName] = useState("");
  const [archiveVersion, setArchiveVersion] = useState("");
  const [archiveSummary, setArchiveSummary] = useState("");
  const [archiveTags, setArchiveTags] = useState("kova, archive");
  const [archivePluginApi, setArchivePluginApi] = useState("");
  const [archiveMinGatewayVersion, setArchiveMinGatewayVersion] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const payload: PublishPayload = {
      name,
      displayName,
      family,
      version,
      summary,
      compatibility:
        family === "skill"
          ? undefined
          : {
              pluginApi,
              minGatewayVersion,
            },
      files: [
        {
          path: family === "skill" ? "SKILL.md" : "README.md",
          content: readme,
          contentType: "text/markdown",
        },
      ],
    };
    return publishPackage(payload);
  }

  async function publishArchive() {
    if (!archiveFile) throw new Error("Choose a ZIP archive to publish.");
    const compatibility =
      optionalText(archivePluginApi) || optionalText(archiveMinGatewayVersion)
        ? {
            pluginApi: optionalText(archivePluginApi),
            minGatewayVersion: optionalText(archiveMinGatewayVersion),
          }
        : undefined;
    const metadata: PublishArchiveMetadata = {
      name: optionalText(archiveName),
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
      if (!skillSlugPattern.test(name)) setName("demo-skill");
      if (displayName === "Demo Plugin") setDisplayName("Demo Skill");
    }
  }

  if (!user) return <AuthPanel />;

  return (
    <form className="publish-panel" onSubmit={submit}>
      <div className="section-title">
        <UploadCloud size={17} aria-hidden="true" />
        <h2>Publish Package</h2>
      </div>
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
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
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
              <input value={version} onChange={(event) => setVersion(event.target.value)} />
            </label>
          </div>
          <label>
            Summary
            <input value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          {family !== "skill" ? (
            <div className="form-grid">
              <label>
                pluginApi
                <input value={pluginApi} onChange={(event) => setPluginApi(event.target.value)} />
              </label>
              <label>
                minGatewayVersion
                <input
                  value={minGatewayVersion}
                  onChange={(event) => setMinGatewayVersion(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          <label>
            Package content
            <textarea value={readme} onChange={(event) => setReadme(event.target.value)} rows={7} />
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
              <span>@{user.handle}</span>
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
        <Link to="/docs">Docs</Link>
      </nav>
    </header>
  );
}

function HomePackageCard({ item, dense = false }: { item: HomeCardItem; dense?: boolean }) {
  const owner = item.ownerHandle ? `by ${item.ownerHandle}` : "by openkova";
  const version = item.version ? `v${item.version}` : "v1.0.0";

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
  const featuredSkills = fillCards(skillPackages.map((item, index) => toHomeCard(item, index, "skill")), fallbackSkillCards, 10);
  const trendingCards = fillCards(packages.map((item, index) => toHomeCard(item, index)), trendingFallbackCards, 6);
  const featuredPlugins = fillCards(
    pluginPackages.map((item, index) => toHomeCard(item, index, "plugin")),
    fallbackPluginCards,
    3,
  );

  function runSearch(value: string) {
    navigate(marketplaceRoute({ q: value }));
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
          <p className="home-v2-sub">Tools built by thousands, ready in one search.</p>

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

          <div className="home-v2-suggestions">
            {["self-improving agent", "GitHub integration", "security soul", "dashboard builder"].map((term) => (
              <button type="button" className="home-v2-suggestion" key={term} onClick={() => runSearch(term)}>
                {term}
              </button>
            ))}
          </div>
        </section>

        <section className="home-v2-carousel-section">
          <div className="home-v2-carousel-header">
            <h2>Featured skills</h2>
            <div className="home-v2-carousel-controls">
              <Link className="home-v2-section-link" to="/skills">
                View all <ArrowRight size={14} aria-hidden="true" />
              </Link>
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
            </div>
          </div>
          <div className="home-v2-carousel-wrap" ref={carouselRef}>
            <div className="home-v2-carousel-track">
              {featuredSkills.map((item, index) => (
                <HomePackageCard item={item} key={`${item.name}-${index}`} />
              ))}
            </div>
          </div>
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
            <span className="home-v2-proof-num">52.7k</span>
            <span className="home-v2-proof-label">tools</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">180k</span>
            <span className="home-v2-proof-label">users</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">12M</span>
            <span className="home-v2-proof-label">downloads</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">4.8</span>
            <span className="home-v2-proof-label">avg rating</span>
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
            {trendingCards.map((item, index) => (
              <HomePackageCard item={item} dense key={`${item.name}-trend-${index}`} />
            ))}
          </div>
        </section>

        <section className="home-v2-grid-section">
          <div className="home-v2-grid-header">
            <h2>Featured plugins</h2>
            <Link className="home-v2-section-link" to="/plugins">
              View all <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className="home-v2-card-grid home-v2-card-grid-plugins">
            {featuredPlugins.map((item, index) => (
              <HomePackageCard item={item} dense key={`${item.name}-plugin-${index}`} />
            ))}
          </div>
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

function LandingPageShell({ theme, children }: { theme: ThemeSettings; children: ReactNode }) {
  const navigate = useNavigate();
  const { user, setUser } = useLandingUser();

  return (
    <div className="home-page" data-theme={theme.resolved}>
      <LandingHeader
        user={user}
        onSignOut={() => {
          clearToken();
          setUser(null);
        }}
        onSearch={(query) => navigate(marketplaceRoute({ q: query }))}
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
        {review ? <span>{review}</span> : null}
        <span>{formatDate(item.updatedAt)}</span>
      </div>
    </Link>
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
      const handle = item.ownerHandle ?? "openkova";
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

function PublisherDetailPage({ theme }: { theme: ThemeSettings }) {
  const { handle = "" } = useParams();
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const plugins = packages.filter((item) => item.family !== "skill").length;
  const skills = packages.filter((item) => item.family === "skill").length;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchPackages({ owner: handle, limit: 100 })
      .then((page) => {
        if (active) setPackages(page.items);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load publisher packages.");
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
        <h1>@{handle}</h1>
        <span>
          {packages.length} Kova-compatible packages · {plugins} plugins · {skills} skills
        </span>
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

function Marketplace({ publishMode = false }: { publishMode?: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeName = useRoutePackageName();
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [family, setFamily] = useState<PackageFamily | "all">(parseRouteFamily(searchParams.get("family")));
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
  }, [family, ownerFilter, query, tagFilter]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  useEffect(() => {
    if (!getStoredToken()) return;
    fetchMe()
      .then((result) => setUser(result.user))
      .catch(() => clearToken());
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
            <DetailPanel detail={detail} />
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
      <Route path="/publishers/:handle" element={<PublisherDetailPage theme={theme} />} />
      <Route path="/publishers" element={<PublishersPage theme={theme} />} />
      <Route path="/tags/:tag" element={<TagPage theme={theme} />} />
      <Route path="/docs" element={<DocsPage theme={theme} />} />
      <Route path="/marketplace" element={<Marketplace />} />
      <Route path="/packages/*" element={<Marketplace />} />
      <Route path="/publish" element={<Marketplace publishMode />} />
      <Route path="/auth/github/callback" element={<GitHubAuthCallback />} />
    </Routes>
  );
}
