import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { activeGitHubPublishPhases, type GitHubPublishJob, type GitHubSiteRepository } from "../../src/features/site-publishing/github-model.js";
import type { GitHubTokens, GitHubUser } from "./github-api.js";

export interface GitHubPublishingAccount {
  connection?: { user: GitHubUser; tokens: string };
  repository?: GitHubSiteRepository;
  job?: GitHubPublishJob;
}
interface Database { version: 1; accounts: Record<string, GitHubPublishingAccount> }
export class GitHubPublishingStore {
  private queue: Promise<unknown> = Promise.resolve();
  private filename: string;
  constructor(directory: string, private key?: Buffer) { this.filename = path.join(directory, "github-site-publishing.json"); }
  private ownerKey(owner: string) { return createHash("sha256").update(owner).digest("hex"); }
  private async read(): Promise<Database> {
    try {
      const value = JSON.parse(await fs.readFile(this.filename, "utf8")) as Database;
      if (value.version !== 1 || !value.accounts || Array.isArray(value.accounts)) throw new Error("Invalid GitHub publishing database");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, accounts: {} };
      throw error;
    }
  }
  async get(owner: string): Promise<GitHubPublishingAccount> {
    await this.queue;
    return structuredClone((await this.read()).accounts[this.ownerKey(owner)] ?? {});
  }
  async update(owner: string, change: (account: GitHubPublishingAccount) => GitHubPublishingAccount): Promise<GitHubPublishingAccount> {
    const operation = this.queue.then(async () => {
      const database = await this.read();
      const account = change(structuredClone(database.accounts[this.ownerKey(owner)] ?? {}));
      database.accounts[this.ownerKey(owner)] = account;
      await this.write(database);
      return structuredClone(account);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async write(database: Database) {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${randomBytes(12).toString("hex")}.tmp`;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(database)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.filename);
      const directory = await fs.open(path.dirname(this.filename), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.rm(temporary, { force: true }); }
  }
  seal(owner: string, value: GitHubTokens): string {
    if (!this.key) throw new Error("GitHub token encryption is not configured");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(this.ownerKey(owner)));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  unseal(owner: string, sealed: string): GitHubTokens {
    if (!this.key) throw new Error("GitHub token encryption is not configured");
    const data = Buffer.from(sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(this.ownerKey(owner)));
    decipher.setAuthTag(data.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8")) as GitHubTokens;
    if (!value.accessToken) throw new Error("Invalid stored GitHub authorization");
    return value;
  }
  async recoverInterruptedJobs() {
    const operation = this.queue.then(async () => {
      const database = await this.read(); let changed = false;
      for (const account of Object.values(database.accounts)) if (account.job && activeGitHubPublishPhases.includes(account.job.phase)) {
        account.job = { ...account.job, phase: "interrupted", updatedAt: Date.now(), message: account.job.commitSha ? "服务重启，网站已提交到 GitHub；请重新发布以继续确认 Pages 状态。" : "服务重启导致发布中断，请重新发布。" };
        changed = true;
      }
      if (changed) await this.write(database);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
