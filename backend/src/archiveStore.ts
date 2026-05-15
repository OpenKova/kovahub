import { createHash } from "node:crypto";
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
    const normalized = normalize(key);
    if (isAbsolute(normalized) || normalized.startsWith("..")) {
      throw new Error("Archive storage key must be relative to the archive root.");
    }
    return join(this.rootDir, normalized);
  }
}
