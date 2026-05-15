import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";

export type ArchiveStore = {
  put(key: string, archive: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
};

export function archiveStorageKey(input: { packageName: string; version: string; sha256hash: string }) {
  const packageHash = createHash("sha256").update(input.packageName.toLowerCase()).digest("hex").slice(0, 16);
  return `packages/${packageHash}/${input.version}-${input.sha256hash}.zip`;
}

function normalizeArchiveKey(key: string) {
  const normalized = normalize(key).replace(/\\/g, "/");
  if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Archive storage key must be relative to the archive root.");
  }
  return normalized;
}

function sha256Hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function utcTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for S3-compatible archive storage.`);
  return value;
}

export class LocalArchiveStore implements ArchiveStore {
  constructor(private readonly rootDir: string) {}

  async put(key: string, archive: Buffer) {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, archive);
  }

  async get(key: string) {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  private resolveKey(key: string) {
    return join(this.rootDir, normalizeArchiveKey(key));
  }
}

export type S3ArchiveStoreOptions = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
};

export class S3ArchiveStore implements ArchiveStore {
  private readonly endpoint: URL;
  private readonly prefix: string;

  constructor(private readonly options: S3ArchiveStoreOptions) {
    this.endpoint = new URL(options.endpoint);
    this.prefix = options.prefix ? normalizeArchiveKey(options.prefix).replace(/\/+$/, "") : "";
  }

  async put(key: string, archive: Buffer) {
    const response = await this.request("PUT", key, archive, {
      "content-type": "application/zip",
    });
    if (!response.ok) throw new Error(`Archive upload failed with HTTP ${response.status}.`);
  }

  async get(key: string) {
    const response = await this.request("GET", key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Archive download failed with HTTP ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }

  private objectUrl(key: string) {
    const normalizedKey = normalizeArchiveKey(key);
    const objectKey = this.prefix ? `${this.prefix}/${normalizedKey}` : normalizedKey;
    const url = new URL(this.endpoint.toString());
    const basePath = url.pathname.replace(/\/+$/, "");
    const objectPath = [this.options.bucket, ...objectKey.split("/")].map(encodePathSegment).join("/");
    url.pathname = `${basePath}/${objectPath}`;
    return url;
  }

  private async request(method: "GET" | "PUT", key: string, body?: Buffer, extraHeaders: Record<string, string> = {}) {
    const url = this.objectUrl(key);
    const payloadHash = sha256Hex(body ?? "");
    const amzDate = utcTimestamp();
    const dateStamp = amzDate.slice(0, 8);
    const headers = new Headers(extraHeaders);
    headers.set("host", url.host);
    headers.set("x-amz-content-sha256", payloadHash);
    headers.set("x-amz-date", amzDate);

    const signedHeaders = Array.from(headers.keys()).map((header) => header.toLowerCase()).sort();
    const canonicalHeaders = signedHeaders
      .map((header) => `${header}:${headers.get(header)?.trim().replace(/\s+/g, " ") ?? ""}\n`)
      .join("");
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders.join(";"),
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.options.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = hmacHex(signingKey, stringToSign);

    headers.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(
        ";",
      )}, Signature=${signature}`,
    );

    const requestBody = body ? (new Uint8Array(body) as BodyInit) : undefined;

    return fetch(url, {
      method,
      headers,
      body: requestBody,
    });
  }
}

export function createArchiveStoreFromEnv(): ArchiveStore {
  const storage = process.env.KOVAHUB_ARCHIVE_STORAGE ?? "local";
  if (storage === "local") {
    return new LocalArchiveStore(process.env.KOVAHUB_ARCHIVE_DIR ?? ".kovahub/archives");
  }
  if (storage === "s3" || storage === "r2") {
    return new S3ArchiveStore({
      endpoint: requireEnv("KOVAHUB_S3_ENDPOINT"),
      bucket: requireEnv("KOVAHUB_S3_BUCKET"),
      region: process.env.KOVAHUB_S3_REGION ?? "auto",
      accessKeyId: requireEnv("KOVAHUB_S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("KOVAHUB_S3_SECRET_ACCESS_KEY"),
      prefix: process.env.KOVAHUB_S3_PREFIX,
    });
  }
  throw new Error(`Unsupported KOVAHUB_ARCHIVE_STORAGE value: ${storage}`);
}
