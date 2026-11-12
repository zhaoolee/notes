import { createHash, generateKeyPairSync } from "node:crypto";
import {
  GitHubApi,
  type GitHubAppConfig,
  type GitHubPages,
  type GitHubUser,
} from "../../../server/site-publishing/github-api.js";
import type { GitHubSiteRepository } from "../../../src/features/site-publishing/github-model.js";
import type { SiteZipEntry } from "../../../server/site-publishing/build.js";

const BLOB_PREFIX = "notes-hugo-site/public/";

let cachedPrivateKey: string | undefined;

/** 测试专用 RSA 私钥；只用于本地假 GitHub API，不写入日志。 */
export function testGitHubPrivateKey(): string {
  cachedPrivateKey ??= generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  return cachedPrivateKey;
}

export function createFakeGitHubConfig(
  overrides: Partial<GitHubAppConfig> = {},
): GitHubAppConfig {
  return {
    appId: 12345,
    slug: "notes-publisher",
    clientId: "Iv1.test-client",
    clientSecret: "test-client-secret",
    privateKey: testGitHubPrivateKey(),
    tokenKey: Buffer.alloc(32, 0x2a),
    callbackUrl: "https://notes.example/api/site-publishing/github/callback",
    ...overrides,
  };
}

export function fakeGitBlobSha(data: Buffer): string {
  return createHash("sha1")
    .update(`blob ${data.length}\0`)
    .update(data)
    .digest("hex");
}

export function siteEntries(
  files: Record<string, string | Buffer>,
): SiteZipEntry[] {
  return Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, data]) => ({
      path: `${BLOB_PREFIX}${name}`,
      data: Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data),
    }));
}

export interface FakeTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

export interface FakeCommit {
  sha: string;
  tree: string;
  parents: string[];
  message: string;
}

export interface FakeBuild {
  commit: string;
  status: string;
  error?: { message?: string };
}

export interface FakeRequestCall {
  method: string;
  url: string;
  path: string;
  host: string;
  search: string;
  headers: Headers;
  body: unknown;
}

export interface FakeRefUpdateContext {
  method: "POST" | "PATCH";
  branch: string;
  sha: string;
  currentSha?: string;
  fake: FakeGitHub;
}

export interface FakeGitHubHooks {
  beforeRefUpdate?: (
    context: FakeRefUpdateContext,
  ) => "conflict" | "lost" | void;
}

export interface FakeRepositoryFixture {
  id: number;
  name: string;
  full_name?: string;
  owner: { login: string };
  default_branch?: string;
  archived?: boolean;
  disabled?: boolean;
  permissions?: { push?: boolean; admin?: boolean; maintain?: boolean };
}

export interface FakeInstallationFixture {
  id: number;
  appId: number;
  suspended_at?: string | null;
  repositories: FakeRepositoryFixture[];
}

export interface FakeOAuthTokens {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

export interface CreateFakeGitHubOptions {
  repository?: GitHubSiteRepository;
  config?: GitHubAppConfig;
  /** null 表示不初始化默认分支，用来模拟空仓库。 */
  defaultFiles?: Record<string, string | Buffer> | null;
  branches?: Record<string, Record<string, string | Buffer>>;
  user?: GitHubUser;
  installations?: FakeInstallationFixture[];
  pages?: GitHubPages | null;
  latestBuild?: FakeBuild | null;
  oauthTokens?: FakeOAuthTokens;
  installationAccessToken?: string;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 内存版 GitHub API。只接受注入的 fetch 请求，绝不访问真实网络。
 * 支持发布所需的 blobs/trees/commits/refs/pages、OAuth、安装与用户接口。
 */
export class FakeGitHub {
  readonly calls: FakeRequestCall[] = [];
  readonly hooks: FakeGitHubHooks = {};
  readonly branches = new Map<string, string>();
  readonly commits = new Map<string, FakeCommit>();
  readonly trees = new Map<string, Map<string, FakeTreeEntry>>();
  readonly blobs = new Map<string, Buffer>();
  readonly treeViews = new Map<string, { root: string; prefix: string }>();

  user: GitHubUser;
  installations: FakeInstallationFixture[];
  pages: GitHubPages | null;
  latestBuild: FakeBuild | null;
  oauthTokens: FakeOAuthTokens;
  installationAccessToken: string;
  truncateRecursive = false;
  pagesCreateConflictOnce = false;
  buildOnRequest: FakeBuild | undefined;
  pollUpdates: FakeBuild[] = [];

  private pagesBuildRequested = false;
  private commitSequence = 0;

  readonly fetchImpl: typeof fetch = async (input, init) => {
    return this.handle(new Request(input, init));
  };

  constructor(
    readonly repository: GitHubSiteRepository,
    readonly config: GitHubAppConfig,
    options: CreateFakeGitHubOptions = {},
  ) {
    this.user = options.user ?? { id: 1001, login: "octo" };
    this.installations = options.installations ?? [];
    this.pages = options.pages ?? null;
    this.latestBuild = options.latestBuild ?? null;
    this.oauthTokens = options.oauthTokens ?? {
      access_token: "gho_fake_user_token",
      refresh_token: "ghr_fake_refresh_token",
      expires_in: 28_800,
      refresh_token_expires_in: 15_897_600,
    };
    this.installationAccessToken =
      options.installationAccessToken ?? "ghs_fake_installation_token";

    const defaultFiles =
      options.defaultFiles === undefined
        ? { "README.md": `# ${repository.name}\n` }
        : options.defaultFiles;
    if (defaultFiles) {
      this.initializeBranch(repository.defaultBranch, defaultFiles);
    }
    for (const [name, files] of Object.entries(options.branches ?? {})) {
      this.initializeBranch(name, files);
    }
  }

  initializeBranch(
    branch: string,
    files: Record<string, string | Buffer>,
  ): string {
    const treeEntries = new Map<string, FakeTreeEntry>();
    for (const [name, contents] of Object.entries(files)) {
      const data = Buffer.isBuffer(contents) ? Buffer.from(contents) : Buffer.from(contents);
      const sha = fakeGitBlobSha(data);
      this.blobs.set(sha, data);
      treeEntries.set(name, {
        path: name,
        mode: "100644",
        type: "blob",
        sha,
        size: data.length,
      });
    }
    const tree = this.storeTree(treeEntries);
    const commit = this.storeCommit(tree, [], `Initialize ${branch}`);
    this.branches.set(branch, commit);
    return commit;
  }

  /** 模拟其他客户端直接推进分支，用于并发/丢失响应测试。 */
  writeFilesExternally(
    branch: string,
    files: Record<string, string | Buffer | null>,
  ): string {
    const current = this.branches.get(branch);
    const entries = current
      ? new Map(this.branchTreeEntries(current))
      : new Map<string, FakeTreeEntry>();
    for (const [name, contents] of Object.entries(files)) {
      if (contents === null) {
        entries.delete(name);
        continue;
      }
      const data = Buffer.isBuffer(contents) ? Buffer.from(contents) : Buffer.from(contents);
      const sha = fakeGitBlobSha(data);
      this.blobs.set(sha, data);
      entries.set(name, {
        path: name,
        mode: "100644",
        type: "blob",
        sha,
        size: data.length,
      });
    }
    const tree = this.storeTree(entries);
    const commit = this.storeCommit(
      tree,
      current ? [current] : [],
      "External update",
    );
    this.branches.set(branch, commit);
    return commit;
  }

  branchHead(branch: string): string | undefined {
    return this.branches.get(branch);
  }

  commit(sha: string): FakeCommit | undefined {
    return this.commits.get(sha);
  }

  branchFile(branch: string, name: string): Buffer | undefined {
    const head = this.branches.get(branch);
    if (!head) return undefined;
    const commit = this.commits.get(head);
    if (!commit) return undefined;
    const entry = this.trees.get(commit.tree)?.get(name);
    return entry?.type === "blob" ? this.blobs.get(entry.sha) : undefined;
  }

  branchFiles(branch: string): Record<string, string> {
    const head = this.branches.get(branch);
    if (!head) return {};
    const commit = this.commits.get(head);
    if (!commit) return {};
    return Object.fromEntries(
      [...(this.trees.get(commit.tree)?.values() ?? [])]
        .filter((entry) => entry.type === "blob")
        .map((entry) => [
          entry.path,
          this.blobs.get(entry.sha)?.toString("utf8") ?? "",
        ]),
    );
  }

  fileSha(branch: string, name: string): string | undefined {
    const head = this.branches.get(branch);
    if (!head) return undefined;
    const commit = this.commits.get(head);
    if (!commit) return undefined;
    return this.trees.get(commit.tree)?.get(name)?.sha;
  }

  private branchTreeEntries(commitSha: string): Map<string, FakeTreeEntry> {
    const commit = this.commits.get(commitSha);
    if (!commit) throw new Error("fixture commit missing");
    const entries = this.trees.get(commit.tree);
    if (!entries) throw new Error("fixture tree missing");
    return entries;
  }

  private storeTree(entries: Map<string, FakeTreeEntry>): string {
    const sorted = [...entries.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const signature = sorted
      .map(
        (entry) =>
          `${entry.path}\0${entry.mode}\0${entry.type}\0${entry.sha}`,
      )
      .join("\n");
    const sha = createHash("sha1").update(`tree\n${signature}`).digest("hex");
    this.trees.set(
      sha,
      new Map(sorted.map((entry) => [entry.path, { ...entry }])),
    );
    this.treeViews.set(sha, { root: sha, prefix: "" });
    return sha;
  }

  private storeCommit(
    tree: string,
    parents: string[],
    message: string,
  ): string {
    const sha = `c${(++this.commitSequence).toString(16).padStart(39, "0")}`;
    this.commits.set(sha, { sha, tree, parents, message });
    return sha;
  }

  private directoryView(rootSha: string, prefix: string): string {
    const sha = createHash("sha1")
      .update(`tree-view\n${rootSha}\n${prefix}`)
      .digest("hex");
    this.treeViews.set(sha, { root: rootSha, prefix });
    return sha;
  }

  private treeResponse(
    entries: Map<string, FakeTreeEntry>,
    treeSha: string,
    recursive: boolean,
  ): { sha: string; truncated: boolean; tree: FakeTreeEntry[] } {
    if (recursive) {
      return {
        sha: treeSha,
        truncated: this.truncateRecursive,
        tree: this.truncateRecursive
          ? []
          : [...entries.values()].map((entry) => ({ ...entry })),
      };
    }

    const view = this.treeViews.get(treeSha);
    if (!view) throw new Error("fixture tree view missing");
    const prefix = view.prefix ? `${view.prefix}/` : "";
    const result = new Map<string, FakeTreeEntry>();
    for (const entry of entries.values()) {
      if (!entry.path.startsWith(prefix)) continue;
      const relative = entry.path.slice(prefix.length);
      if (!relative) continue;
      const slash = relative.indexOf("/");
      if (slash === -1) {
        result.set(relative, { ...entry, path: relative });
        continue;
      }
      const directory = relative.slice(0, slash);
      if (result.has(directory)) continue;
      result.set(directory, {
        path: directory,
        mode: "040000",
        type: "tree",
        sha: this.directoryView(view.root, `${prefix}${directory}`),
      });
    }
    return {
      sha: treeSha,
      truncated: false,
      tree: [...result.values()].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    };
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const bodyText = request.body ? await request.clone().text() : "";
    let body: unknown;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }
    const call: FakeRequestCall = {
      method: request.method,
      url: request.url,
      path: url.pathname,
      host: url.host,
      search: url.search,
      headers: new Headers(request.headers),
      body,
    };
    this.calls.push(call);

    if (
      call.host === "github.com" &&
      call.method === "POST" &&
      call.path === "/login/oauth/access_token"
    ) {
      const fields = (body ?? {}) as Record<string, unknown>;
      if (
        fields.client_id !== this.config.clientId ||
        fields.client_secret !== this.config.clientSecret
      ) {
        return jsonResponse({ error: "bad_client" }, 401);
      }
      return jsonResponse(this.oauthTokens);
    }

    if (call.host !== "api.github.com") {
      return jsonResponse({ message: "Not Found" }, 404);
    }

    if (call.method === "GET" && call.path === "/user") {
      return jsonResponse(this.user);
    }

    if (call.method === "GET" && call.path === "/user/installations") {
      const perPage = Number(url.searchParams.get("per_page") ?? 30);
      const page = Number(url.searchParams.get("page") ?? 1);
      const slice = this.installations.slice(
        (page - 1) * perPage,
        page * perPage,
      );
      return jsonResponse({
        installations: slice.map((installation) => ({
          id: installation.id,
          app_id: installation.appId,
          suspended_at: installation.suspended_at ?? null,
        })),
      });
    }

    const installationsMatch = call.path.match(
      /^\/user\/installations\/(\d+)\/repositories$/,
    );
    if (call.method === "GET" && installationsMatch) {
      const installation = this.installations.find(
        (candidate) => candidate.id === Number(installationsMatch[1]),
      );
      if (!installation) return jsonResponse({ message: "Not Found" }, 404);
      const perPage = Number(url.searchParams.get("per_page") ?? 30);
      const page = Number(url.searchParams.get("page") ?? 1);
      const slice = installation.repositories.slice(
        (page - 1) * perPage,
        page * perPage,
      );
      return jsonResponse({
        repositories: slice.map((repository) => ({
          id: repository.id,
          name: repository.name,
          full_name:
            repository.full_name ??
            `${repository.owner.login}/${repository.name}`,
          owner: repository.owner,
          default_branch: repository.default_branch ?? "main",
          archived: repository.archived ?? false,
          disabled: repository.disabled ?? false,
          permissions: repository.permissions,
        })),
      });
    }

    const accessTokensMatch = call.path.match(
      /^\/app\/installations\/(\d+)\/access_tokens$/,
    );
    if (call.method === "POST" && accessTokensMatch) {
      return jsonResponse({
        token: this.installationAccessToken,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    }

    const repositoryMatch = call.path.match(
      /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/,
    );
    if (!repositoryMatch) {
      return jsonResponse({ message: "Not Found" }, 404);
    }
    if (
      decodePathPart(repositoryMatch[1]) !== this.repository.owner ||
      decodePathPart(repositoryMatch[2]) !== this.repository.name
    ) {
      return jsonResponse({ message: "Not Found" }, 404);
    }

    const rest = repositoryMatch[3] ?? "";
    const refMatch = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (call.method === "GET" && refMatch) {
      const branch = decodePathPart(refMatch[1]);
      const sha = this.branches.get(branch);
      if (!sha) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse({
        ref: `refs/heads/${branch}`,
        object: { sha, type: "commit" },
      });
    }

    const commitMatch = rest.match(/^\/git\/commits\/([^/]+)$/);
    if (call.method === "GET" && commitMatch) {
      const commit = this.commits.get(decodePathPart(commitMatch[1]));
      if (!commit) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse({
        sha: commit.sha,
        message: commit.message,
        tree: { sha: commit.tree },
        parents: commit.parents.map((sha) => ({ sha })),
      });
    }

    const treeMatch = rest.match(/^\/git\/trees\/([^/]+)$/);
    if (call.method === "GET" && treeMatch) {
      const treeSha = decodePathPart(treeMatch[1]);
      const view = this.treeViews.get(treeSha);
      if (!view) return jsonResponse({ message: "Not Found" }, 404);
      const entries = this.trees.get(view.root);
      if (!entries) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse(
        this.treeResponse(
          entries,
          treeSha,
          url.searchParams.get("recursive") === "1",
        ),
      );
    }

    const blobMatch = rest.match(/^\/git\/blobs\/([^/]+)$/);
    if (call.method === "GET" && blobMatch) {
      const sha = decodePathPart(blobMatch[1]);
      const data = this.blobs.get(sha);
      if (!data) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse({
        sha,
        size: data.length,
        content: data.toString("base64"),
        encoding: "base64",
      });
    }

    if (call.method === "POST" && rest === "/git/blobs") {
      const value = body as {
        content?: unknown;
        encoding?: unknown;
      } | null;
      if (
        !value ||
        typeof value.content !== "string" ||
        value.encoding !== "base64"
      ) {
        return jsonResponse({ message: "Invalid blob" }, 422);
      }
      const data = Buffer.from(value.content, "base64");
      const sha = fakeGitBlobSha(data);
      this.blobs.set(sha, data);
      return jsonResponse({ sha, size: data.length }, 201);
    }

    if (call.method === "POST" && rest === "/git/trees") {
      const value = body as {
        base_tree?: unknown;
        tree?: unknown;
      } | null;
      if (!value || !Array.isArray(value.tree)) {
        return jsonResponse({ message: "Invalid tree" }, 422);
      }
      const base =
        typeof value.base_tree === "string"
          ? this.trees.get(value.base_tree)
          : undefined;
      if (value.base_tree && !base) {
        return jsonResponse({ message: "Base tree not found" }, 422);
      }
      const entries = new Map(base ?? []);
      for (const item of value.tree as Array<{
        path?: unknown;
        mode?: unknown;
        type?: unknown;
        sha?: unknown;
      }>) {
        if (
          !item ||
          typeof item.path !== "string" ||
          (item.sha !== null && typeof item.sha !== "string")
        ) {
          return jsonResponse({ message: "Invalid tree entry" }, 422);
        }
        if (item.sha === null) {
          entries.delete(item.path);
          continue;
        }
        const data = this.blobs.get(item.sha);
        if (!data) return jsonResponse({ message: "Blob not found" }, 422);
        entries.set(item.path, {
          path: item.path,
          mode: typeof item.mode === "string" ? item.mode : "100644",
          type: "blob",
          sha: item.sha,
          size: data.length,
        });
      }
      const sha = this.storeTree(entries);
      return jsonResponse({ sha, tree: [...entries.values()] }, 201);
    }

    if (call.method === "POST" && rest === "/git/commits") {
      const value = body as {
        message?: unknown;
        tree?: unknown;
        parents?: unknown;
      } | null;
      if (
        !value ||
        typeof value.tree !== "string" ||
        !this.trees.has(value.tree)
      ) {
        return jsonResponse({ message: "Tree not found" }, 422);
      }
      const parents = Array.isArray(value.parents)
        ? value.parents.filter((item): item is string => typeof item === "string")
        : [];
      const sha = this.storeCommit(
        value.tree,
        parents,
        typeof value.message === "string" ? value.message : "",
      );
      return jsonResponse({ sha, tree: { sha: value.tree }, parents }, 201);
    }

    if (call.method === "POST" && rest === "/git/refs") {
      const value = body as { ref?: unknown; sha?: unknown } | null;
      if (
        !value ||
        typeof value.ref !== "string" ||
        typeof value.sha !== "string" ||
        !value.ref.startsWith("refs/heads/")
      ) {
        return jsonResponse({ message: "Invalid ref" }, 422);
      }
      const branch = value.ref.slice("refs/heads/".length);
      if (this.branches.has(branch)) {
        return jsonResponse({ message: "Reference already exists" }, 422);
      }
      if (!this.commits.has(value.sha)) {
        return jsonResponse({ message: "Commit not found" }, 422);
      }
      const outcome = this.hooks.beforeRefUpdate?.({
        method: "POST",
        branch,
        sha: value.sha,
        currentSha: undefined,
        fake: this,
      });
      if (outcome === "conflict") {
        return jsonResponse({ message: "Reference conflict" }, 422);
      }
      this.branches.set(branch, value.sha);
      if (outcome === "lost") {
        throw new TypeError("simulated lost ref response");
      }
      return jsonResponse(
        {
          ref: value.ref,
          object: { sha: value.sha, type: "commit" },
        },
        201,
      );
    }

    const patchRefMatch = rest.match(/^\/git\/refs\/heads\/(.+)$/);
    if (call.method === "PATCH" && patchRefMatch) {
      const branch = decodePathPart(patchRefMatch[1]);
      const value = body as { sha?: unknown; force?: unknown } | null;
      if (!value || typeof value.sha !== "string") {
        return jsonResponse({ message: "Invalid ref update" }, 422);
      }
      const commit = this.commits.get(value.sha);
      if (!commit) return jsonResponse({ message: "Commit not found" }, 422);
      const currentSha = this.branches.get(branch);
      const outcome = this.hooks.beforeRefUpdate?.({
        method: "PATCH",
        branch,
        sha: value.sha,
        currentSha,
        fake: this,
      });
      if (outcome === "conflict") {
        return jsonResponse({ message: "Update is not a fast forward" }, 409);
      }
      if (
        currentSha &&
        value.force !== true &&
        !commit.parents.includes(currentSha)
      ) {
        return jsonResponse({ message: "Update is not a fast forward" }, 409);
      }
      this.branches.set(branch, value.sha);
      if (outcome === "lost") {
        throw new TypeError("simulated lost ref response");
      }
      return jsonResponse({
        ref: `refs/heads/${branch}`,
        object: { sha: value.sha, type: "commit" },
      });
    }

    if (call.method === "GET" && rest === "/pages") {
      if (!this.pages) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse(this.pages);
    }

    if (call.method === "POST" && rest === "/pages") {
      if (this.pages) return jsonResponse({ message: "Already exists" }, 409);
      const value = (body ?? {}) as {
        build_type?: unknown;
        source?: GitHubPages["source"];
      };
      const created: GitHubPages = {
        html_url: `https://${this.repository.owner}.github.io/${this.repository.name}/`,
        build_type:
          typeof value.build_type === "string"
            ? value.build_type
            : "legacy",
        source:
          value.source ?? { branch: "gh-pages", path: "/" },
        status: "building",
      };
      this.pages = created;
      if (this.pagesCreateConflictOnce) {
        this.pagesCreateConflictOnce = false;
        return jsonResponse({ message: "Pages already exists" }, 409);
      }
      return jsonResponse(created, 201);
    }

    if (call.method === "GET" && rest === "/pages/builds/latest") {
      if (
        this.pagesBuildRequested &&
        this.pollUpdates.length > 0 &&
        this.latestBuild
      ) {
        this.latestBuild = this.pollUpdates.shift()!;
      }
      if (!this.latestBuild) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      return jsonResponse(this.latestBuild);
    }

    if (call.method === "POST" && rest === "/pages/builds") {
      this.pagesBuildRequested = true;
      if (this.buildOnRequest) {
        this.latestBuild = this.buildOnRequest;
        this.buildOnRequest = undefined;
      }
      return jsonResponse({ status: "queued" }, 201);
    }

    return jsonResponse({ message: "Not Found" }, 404);
  }
}

export interface FakeGitHubFixture {
  fake: FakeGitHub;
  api: GitHubApi;
  fetchImpl: typeof fetch;
  repository: GitHubSiteRepository;
  config: GitHubAppConfig;
}

export function createFakeGitHub(
  options: CreateFakeGitHubOptions = {},
): FakeGitHubFixture {
  const repository: GitHubSiteRepository = options.repository ?? {
    id: 42,
    installationId: 77,
    owner: "octo",
    name: "notes-site",
    fullName: "octo/notes-site",
    defaultBranch: "main",
  };
  const config = options.config ?? createFakeGitHubConfig();
  const fake = new FakeGitHub(repository, config, options);
  return {
    fake,
    api: new GitHubApi(config, fake.fetchImpl),
    fetchImpl: fake.fetchImpl,
    repository,
    config,
  };
}
