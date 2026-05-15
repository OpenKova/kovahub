import {
  ArrowDownToLine,
  ArrowRight,
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
  Sun,
  Trash2,
  UploadCloud,
  UserRound,
  Users,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function safeLocalPath(value: string | null) {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  return "/publish";
}

function packageRoute(name: string) {
  return `/packages/${encodeURIComponent(name)}`;
}

function marketplaceRoute(params: { q?: string; family?: PackageFamily } = {}) {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.family) query.set("family", params.family);
  const suffix = query.toString();
  return `/marketplace${suffix ? `?${suffix}` : ""}`;
}

function useRoutePackageName() {
  const params = useParams();
  const wildcard = params["*"];
  return wildcard ? decodeURIComponent(wildcard) : null;
}

function parseRouteFamily(value: string | null): PackageFamily | "all" {
  return value && value in familyLabels ? (value as PackageFamily) : "all";
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
  const tags = Object.entries(pkg.tags ?? {});
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
}: {
  user: AuthUser | null;
  onSignOut: () => void;
  onSearch: (query: string) => void;
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
            <button type="button" aria-label="System theme">
              <Monitor size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Light theme">
              <Sun size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Dark theme">
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
        <Link to={marketplaceRoute({ family: "skill" })}>
          <Sparkles size={14} aria-hidden="true" />
          Skills
        </Link>
        <Link to={marketplaceRoute({ family: "code-plugin" })}>
          <Plug size={14} aria-hidden="true" />
          Plugins
        </Link>
        <Link to="/publish">Publishers</Link>
        <a href={`${getApiBase()}/api/v1/meta`}>Docs</a>
      </nav>
    </header>
  );
}

function HomePackageCard({ item }: { item: PackageListItem }) {
  const Icon = familyIcons[item.family];
  const owner = item.ownerHandle ? `by ${item.ownerHandle}` : "by kova builders";
  const latest = item.latestVersion ? `v${item.latestVersion}` : "No version";

  return (
    <Link to={packageRoute(item.name)} className="home-v2-c-card">
      <div className="home-v2-c-head">
        <div className="home-v2-c-icon">
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="home-v2-c-meta">
          <div className="home-v2-c-name">{item.displayName}</div>
          <div className="home-v2-c-by">{owner}</div>
        </div>
      </div>
      <span className="home-v2-c-tag">{familyLabels[item.family]}</span>
      <div className="home-v2-c-desc">{item.summary ?? "A Kova-compatible package."}</div>
      <div className="home-v2-c-footer">
        <div className="home-v2-c-stats">
          <span>
            <History size={12} aria-hidden="true" /> {latest}
          </span>
          <span>
            <Download size={12} aria-hidden="true" /> Archive
          </span>
        </div>
        <span className="home-v2-c-install">
          <Download size={13} aria-hidden="true" /> Install
        </span>
      </div>
    </Link>
  );
}

function HomeLanding() {
  const navigate = useNavigate();
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetchPackages({}).then((page) => setPackages(page.items)).catch(() => setPackages([]));
  }, []);

  useEffect(() => {
    if (!getStoredToken()) return;
    fetchMe()
      .then((result) => setUser(result.user))
      .catch(() => clearToken());
  }, []);

  const featured = packages.slice(0, 6);
  const pluginCount = packages.filter((item) => item.family !== "skill").length;
  const skillCount = packages.filter((item) => item.family === "skill").length;

  function runSearch(value: string) {
    navigate(marketplaceRoute({ q: value }));
  }

  function submitHeroSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    runSearch(String(form.get("q") ?? ""));
  }

  return (
    <div className="home-page">
      <LandingHeader
        user={user}
        onSignOut={() => {
          clearToken();
          setUser(null);
        }}
        onSearch={runSearch}
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
          <p className="home-v2-sub">Kova tools built by builders, ready in one search.</p>

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
            {["Kova gateway", "GitHub integration", "plugin API", "dashboard builder"].map((term) => (
              <button type="button" className="home-v2-suggestion" key={term} onClick={() => runSearch(term)}>
                {term}
              </button>
            ))}
          </div>
        </section>

        <section className="home-v2-carousel-section">
          <div className="home-v2-carousel-header">
            <h2>Featured packages</h2>
            <div className="home-v2-carousel-controls">
              <Link className="home-v2-section-link" to="/marketplace">
                View all <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="home-v2-carousel-wrap">
            <div className="home-v2-carousel-track">
              {(featured.length > 0 ? [...featured, ...featured] : []).map((item, index) => (
                <HomePackageCard item={item} key={`${item.name}-${index}`} />
              ))}
              {featured.length === 0
                ? [0, 1, 2, 3].map((index) => <div className="home-v2-c-card home-v2-c-card-empty" key={index} />)
                : null}
            </div>
          </div>
        </section>

        <section className="home-v2-categories">
          <div className="home-v2-categories-grid">
            <Link to={marketplaceRoute({ family: "skill" })} className="home-v2-cat-item">
              <div className="home-v2-cat-icon">
                <Sparkles size={20} aria-hidden="true" />
              </div>
              <div className="home-v2-cat-text">
                <div className="home-v2-cat-name">Skills</div>
                <div className="home-v2-cat-desc">Agent skill bundles</div>
              </div>
              <span className="home-v2-cat-arrow">
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </Link>
            <Link to={marketplaceRoute({ family: "code-plugin" })} className="home-v2-cat-item">
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
            <Link to="/publish" className="home-v2-cat-item">
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
            <span className="home-v2-proof-num">{formatCount(packages.length)}</span>
            <span className="home-v2-proof-label">tools</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">{formatCount(pluginCount)}</span>
            <span className="home-v2-proof-label">plugins</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">{formatCount(skillCount)}</span>
            <span className="home-v2-proof-label">skills</span>
          </div>
          <span className="home-v2-proof-sep" />
          <div className="home-v2-proof-item">
            <span className="home-v2-proof-num">Kova</span>
            <span className="home-v2-proof-label">ready</span>
          </div>
        </div>
      </main>
    </div>
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeName = routeName ?? packages[0]?.name ?? null;

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setFamily(parseRouteFamily(searchParams.get("family")));
  }, [searchParams]);

  const loadPackages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPackages({
        q: query.trim() || undefined,
        family: family === "all" ? undefined : family,
      });
      setPackages(page.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load packages.");
    } finally {
      setLoading(false);
    }
  }, [family, query]);

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
            <div className="results-list">
              {loading ? <p className="muted">Loading registry...</p> : null}
              {error ? <p className="form-error">{error}</p> : null}
              {!loading && packages.length === 0 ? <p className="muted">No packages found.</p> : null}
              {packages.map((item) => (
                <PackageRow key={item.name} item={item} active={item.name === activeName} />
              ))}
            </div>
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
  return (
    <Routes>
      <Route path="/" element={<HomeLanding />} />
      <Route path="/marketplace" element={<Marketplace />} />
      <Route path="/packages/*" element={<Marketplace />} />
      <Route path="/publish" element={<Marketplace publishMode />} />
      <Route path="/auth/github/callback" element={<GitHubAuthCallback />} />
    </Routes>
  );
}
