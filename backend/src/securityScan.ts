import type {
  PackageChannel,
  PackageVerificationSummary,
} from "./contracts.js";

type JsonRecord = Record<string, unknown>;

export type SecurityScanFile = {
  path: string;
  bytes?: Uint8Array | Buffer;
  content?: string;
  contentBase64?: string;
  contentType?: string;
  size?: number;
};

type Finding = NonNullable<PackageVerificationSummary["findings"]>[number];

const textFilePattern = /\.(cjs|cts|env|js|json|jsx|mjs|mts|md|ps1|py|sh|ts|tsx|txt|yaml|yml)$/i;
const secretPathPattern = /(^|\/)(\.env|\.npmrc|\.pypirc|id_rsa|id_dsa|id_ecdsa|id_ed25519|.+\.(key|pem|p12))$/i;
const provenancePathPattern = /(^|\/)(.+\.intoto\.jsonl|.+\.attestation|attestation\.json|provenance\.json|sigstore\/.+|.+\.sig)$/i;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function fileText(file: SecurityScanFile) {
  if (file.content !== undefined) return file.content;
  if (file.contentBase64 !== undefined) return Buffer.from(file.contentBase64, "base64").toString("utf8");
  if (!file.bytes) return undefined;
  const size = file.size ?? file.bytes.byteLength;
  if (size > 512 * 1024) return undefined;
  if (file.contentType?.startsWith("text/") || file.contentType === "application/json" || textFilePattern.test(file.path)) {
    return Buffer.from(file.bytes).toString("utf8");
  }
  return undefined;
}

function tryParsePackageJson(files: SecurityScanFile[]) {
  const file = files.find((candidate) => candidate.path.split("/").pop()?.toLowerCase() === "package.json");
  const text = file ? fileText(file) : undefined;
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function repositoryUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isRecord(value)) return readString(value.url);
  return undefined;
}

function sourceMetadata(packageJson: JsonRecord | null) {
  const kova = isRecord(packageJson?.kova) ? packageJson.kova : null;
  const source = isRecord(kova?.source) ? kova.source : null;
  return {
    sourceRepo: readString(source?.repo) ?? readString(source?.repository) ?? repositoryUrl(packageJson?.repository),
    sourceCommit: readString(source?.commit) ?? readString(source?.revision) ?? readString(packageJson?.gitHead),
  };
}

function pushFinding(findings: Finding[], finding: Finding) {
  if (findings.some((candidate) => candidate.code === finding.code && candidate.path === finding.path)) return;
  findings.push(finding);
}

function scanLifecycleScripts(packageJson: JsonRecord | null, findings: Finding[]) {
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : null;
  if (!scripts) return;
  for (const scriptName of ["preinstall", "install", "postinstall", "prepare"]) {
    const script = readString(scripts[scriptName]);
    if (!script) continue;
    const severity = /(curl|wget)\b.+\|\s*(bash|sh)|eval\s*\(|base64\s+-d/i.test(script) ? "high" : "medium";
    pushFinding(findings, {
      severity,
      code: "install-lifecycle-script",
      message: `package.json defines a ${scriptName} lifecycle script.`,
      path: "package.json",
    });
  }
}

function scanTextFile(file: SecurityScanFile, text: string, findings: Finding[]) {
  if (/-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    pushFinding(findings, {
      severity: "high",
      code: "embedded-private-key",
      message: "Archive contains private key material.",
      path: file.path,
    });
  }
  if (/(AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*["']?[A-Za-z0-9_./+=-]{20,}/.test(text)) {
    pushFinding(findings, {
      severity: "high",
      code: "embedded-secret",
      message: "Archive contains a token-like secret assignment.",
      path: file.path,
    });
  }
  if (/\b(child_process|execFile|spawn|execSync)\b/.test(text)) {
    pushFinding(findings, {
      severity: "medium",
      code: "process-execution-api",
      message: "Code references process execution APIs.",
      path: file.path,
    });
  }
  if (/(curl|wget)\b.+\|\s*(bash|sh)/i.test(text)) {
    pushFinding(findings, {
      severity: "high",
      code: "network-pipe-shell",
      message: "Script downloads remote content and pipes it to a shell.",
      path: file.path,
    });
  }
  if (/\beval\s*\(/.test(text)) {
    pushFinding(findings, {
      severity: "medium",
      code: "dynamic-eval",
      message: "Code uses dynamic eval.",
      path: file.path,
    });
  }
}

function highestSeverity(findings: Finding[]) {
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium")) return "medium";
  if (findings.some((finding) => finding.severity === "low")) return "low";
  return null;
}

function scannerWebhookUrl() {
  return process.env.KOVAHUB_SCANNER_WEBHOOK_URL?.trim() || undefined;
}

export function scanPackageArtifact(params: {
  files: SecurityScanFile[];
  packageJson?: JsonRecord | null;
  executesCode: boolean;
  channel: PackageChannel;
}): PackageVerificationSummary {
  const packageJson = params.packageJson ?? tryParsePackageJson(params.files);
  const findings: Finding[] = [];
  const hasProvenance = params.files.some((file) => provenancePathPattern.test(file.path));

  for (const file of params.files) {
    if (secretPathPattern.test(file.path)) {
      pushFinding(findings, {
        severity: "high",
        code: "secret-like-file",
        message: "Archive contains a file that commonly stores credentials.",
        path: file.path,
      });
    }
    const text = fileText(file);
    if (text) scanTextFile(file, text, findings);
  }

  scanLifecycleScripts(packageJson, findings);

  const severity = highestSeverity(findings);
  const { sourceRepo, sourceCommit } = sourceMetadata(packageJson);
  const webhookUrl = scannerWebhookUrl();
  const tier = hasProvenance
    ? "provenance-verified"
    : sourceRepo
      ? "source-linked"
      : "structural";
  const scanStatus =
    severity === "high" && findings.some((finding) => finding.code === "embedded-private-key" || finding.code === "embedded-secret")
      ? "malicious"
      : severity
        ? "suspicious"
        : "clean";
  const riskLevel =
    scanStatus === "malicious"
      ? "high"
      : severity === "high"
        ? "high"
        : severity === "medium"
          ? "medium"
          : params.executesCode && !hasProvenance
            ? "medium"
            : "low";

  return {
    tier,
    scope: "artifact-only",
    summary:
      findings.length > 0
        ? `Structural scan found ${findings.length} review item${findings.length === 1 ? "" : "s"}.`
        : hasProvenance
          ? "Structural scan passed and provenance metadata was found."
          : "Structural scan passed with no suspicious archive content.",
    sourceRepo,
    sourceCommit,
    hasProvenance,
    scanStatus,
    scanner: webhookUrl
      ? {
          provider: "webhook",
          status: "queued",
          url: webhookUrl,
        }
      : {
          provider: "structural",
          status: scanStatus,
          checkedAt: Date.now(),
        },
    rebuild: {
      status: "not-run",
    },
    moderationStatus: params.channel === "official" ? "approved" : "pending",
    riskLevel,
    findings,
  };
}
