import { describe, expect, it, vi, afterEach } from "vitest";
import { createArchiveStoreFromEnv, LocalArchiveStore, S3ArchiveStore } from "../src/archiveStore.js";

describe("archive stores", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects unsafe local archive keys", async () => {
    const store = new LocalArchiveStore("/tmp/kovahub-test-archives");

    await expect(store.put("../archive.zip", Buffer.from("zip"))).rejects.toThrow(
      "Archive storage key must be relative",
    );
  });

  it("uses signed S3-compatible object requests", async () => {
    const calls: Array<{ method: string | undefined; url: string; authorization: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
        const headers = new Headers(init?.headers);
        calls.push({
          method: init?.method,
          url,
          authorization: headers.get("authorization"),
        });
        expect(headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
        expect(headers.get("x-amz-content-sha256")).toMatch(/^[a-f0-9]{64}$/);

        if (init?.method === "GET") return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    );

    const store = new S3ArchiveStore({
      endpoint: "https://example.r2.cloudflarestorage.com",
      bucket: "kovahub",
      region: "auto",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      prefix: "archives",
    });

    await store.put("packages/demo/file.zip", Buffer.from("zip"));
    const archive = await store.get("packages/demo/file.zip");

    expect(archive?.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(calls).toEqual([
      {
        method: "PUT",
        url: "https://example.r2.cloudflarestorage.com/kovahub/archives/packages/demo/file.zip",
        authorization: expect.stringContaining("Credential=access-key/"),
      },
      {
        method: "GET",
        url: "https://example.r2.cloudflarestorage.com/kovahub/archives/packages/demo/file.zip",
        authorization: expect.stringContaining("Credential=access-key/"),
      },
    ]);
  });

  it("returns null when S3-compatible archive object is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch,
    );

    const store = new S3ArchiveStore({
      endpoint: "https://example.r2.cloudflarestorage.com",
      bucket: "kovahub",
      region: "auto",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    });

    await expect(store.get("packages/missing/file.zip")).resolves.toBeNull();
  });

  it("supports Supabase as an S3-compatible archive storage target", () => {
    vi.stubEnv("KOVAHUB_ARCHIVE_STORAGE", "supabase");
    vi.stubEnv("KOVAHUB_S3_ENDPOINT", "https://project-ref.supabase.co/storage/v1/s3");
    vi.stubEnv("KOVAHUB_S3_BUCKET", "kovahub-archives");
    vi.stubEnv("KOVAHUB_S3_REGION", "us-east-1");
    vi.stubEnv("KOVAHUB_S3_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("KOVAHUB_S3_SECRET_ACCESS_KEY", "secret-key");

    expect(createArchiveStoreFromEnv()).toBeInstanceOf(S3ArchiveStore);
  });

  it("rejects local archive storage on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("KOVAHUB_ARCHIVE_STORAGE", "local");

    expect(() => createArchiveStoreFromEnv()).toThrow("KOVAHUB_ARCHIVE_STORAGE=s3 or supabase is required on Vercel.");
  });
});
