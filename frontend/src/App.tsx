import {
  ArrowDownToLine,
  Boxes,
  CheckCircle2,
  Code2,
  Copy,
  FileArchive,
  History,
  KeyRound,
  Package,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  clearToken,
  createApiToken,
  fetchMe,
  fetchPackageDetail,
  fetchPackages,
  getApiBase,
  getStoredToken,
  login,
  packageDownloadUrl,
  publishArchivePackage,
  publishPackage,
  register,
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

function packageRoute(name: string) {
  return `/packages/${encodeURIComponent(name)}`;
}

function useRoutePackageName() {
  const params = useParams();
  const wildcard = params["*"];
  return wildcard ? decodeURIComponent(wildcard) : null;
}

function Header({ user, onSignOut }: { user: AuthUser | null; onSignOut: () => void }) {
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
          <Link to="/">Marketplace</Link>
          <a href={`${getApiBase()}/api/v1/meta`}>Registry API</a>
          <Link to="/publish">Publish</Link>
        </nav>
        <div className="user-chip">
          <UserRound size={15} aria-hidden="true" />
          {user ? (
            <>
              <span>@{user.handle}</span>
              <button className="link-button" type="button" onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <span>Signed out</span>
          )}
        </div>
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

function AuthPanel({ onAuth }: { onAuth: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [handle, setHandle] = useState("builder");
  const [email, setEmail] = useState("builder@example.com");
  const [password, setPassword] = useState("correct-horse");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result =
        mode === "register"
          ? await register({ handle, email, password })
          : await login({ email, password });
      storeToken(result.token);
      onAuth(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <div className="section-title">
        <KeyRound size={17} aria-hidden="true" />
        <h2>{mode === "register" ? "Create account" : "Sign in"}</h2>
      </div>
      {mode === "register" ? (
        <label>
          Handle
          <input value={handle} onChange={(event) => setHandle(event.target.value)} />
        </label>
      ) : null}
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
      </label>
      <label>
        Password
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-action full" type="submit">
        {mode === "register" ? "Create account" : "Sign in"}
      </button>
      <button
        className="link-button"
        type="button"
        onClick={() => setMode(mode === "register" ? "login" : "register")}
      >
        {mode === "register" ? "Use existing account" : "Create a new account"}
      </button>
    </form>
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
  onAuth,
  onPublished,
}: {
  user: AuthUser | null;
  onAuth: (user: AuthUser) => void;
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

  if (!user) return <AuthPanel onAuth={onAuth} />;

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

function Marketplace({ publishMode = false }: { publishMode?: boolean }) {
  const navigate = useNavigate();
  const routeName = useRoutePackageName();
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<PackageFamily | "all">("all");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeName = routeName ?? packages[0]?.name ?? null;

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
    void loadPackages();
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
                  onClick={() => setFamily(value)}
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
                onAuth={setUser}
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
      <Route path="/" element={<Marketplace />} />
      <Route path="/packages/*" element={<Marketplace />} />
      <Route path="/publish" element={<Marketplace publishMode />} />
    </Routes>
  );
}
