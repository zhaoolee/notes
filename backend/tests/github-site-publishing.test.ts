import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  GitHubPublishingError,
  loadGitHubAppConfig,
  type GitHubAppConfig,
} from "../../server/site-publishing/github-api.js";
import {
  SITE_PUBLISH_BRANCH,
  commitStaticSite,
  configurePages,
  gitBlobSha,
  githubSiteLocation,
  waitForPages,
} from "../../server/site-publishing/github-publisher.js";
import { GitHubPublishingStore } from "../../server/site-publishing/github-store.js";
import type {
  GitHubPublishJob,
  GitHubSiteRepository,
} from "../../src/features/site-publishing/github-model.js";
import type { SiteSettings } from "../../src/features/site-publishing/model.js";
import {
  createFakeGitHub,
  createFakeGitHubConfig,
  siteEntries,
  testGitHubPrivateKey,
  type FakeGitHubFixture,
  type FakeRequestCall,
} from "./fixtures/github-publishing.js";

const REPOSITORY: GitHubSiteRepository = {
  id: 42,
  installationId: 77,
  owner: "octo",
  name: "notes-site",
  fullName: "octo/notes-site",
  defaultBranch: "main",
};
const MANIFEST_KEY = Buffer.alloc(32, 0x5a);
const signal = () => new AbortController().signal;

function makeSettings(overrides: Partial<SiteSettings> = {}): SiteSettings {
  return {
    title: "便签网站",
    description: "记录与分享",
    author: "作者",
    origin: "",
    basePath: "/",
    logoPath: "",
    themeId: "smartisan-blog",
    ...overrides,
  };
}

async function temporaryDirectory(
  context: TestContext,
  prefix: string,
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function publish(
  fixture: FakeGitHubFixture,
  files: Record<string, string | Buffer>,
  overrides: Partial<Parameters<typeof commitStaticSite>[0]> = {},
) {
  return commitStaticSite({
    api: fixture.api,
    token: "user-access-token",
    repository: fixture.repository,
    ownerId: "owner-1",
    manifestKey: MANIFEST_KEY,
    entries: siteEntries(files),
    prefix: "",
    signal: signal(),
    ...overrides,
  });
}

function writeCalls(fixture: FakeGitHubFixture): FakeRequestCall[] {
  return fixture.fake.calls.filter((call) => call.method !== "GET");
}

function callsEndingWith(
  fixture: FakeGitHubFixture,
  method: string,
  suffix: string,
): FakeRequestCall[] {
  return fixture.fake.calls.filter(
    (call) => call.method === method && call.path.endsWith(suffix),
  );
}

async function assertGitHubError(
  operation: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof GitHubPublishingError && pattern.test(error.message),
  );
}

test("gitBlobSha 按 Git blob 的字节长度加 NUL 计算，覆盖多字节和二进制", () => {
  const samples = [
    Buffer.alloc(0),
    Buffer.from("hello\n"),
    Buffer.from("锤子便签\n"),
    Buffer.from([0, 1, 2, 0xff, 0x0a, 0x80]),
  ];
  for (const data of samples) {
    const expected = createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]))
      .digest("hex");
    assert.equal(gitBlobSha(data), expected);
  }

  const multibyte = Buffer.from("锤子便签");
  const wrongCharacterLength = createHash("sha1")
    .update(`blob ${"锤子便签".length}\0`)
    .update(multibyte)
    .digest("hex");
  assert.notEqual(wrongCharacterLength, gitBlobSha(multibyte));
  assert.equal(
    gitBlobSha(Buffer.alloc(0)),
    "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
  );
});

test("githubSiteLocation 正确拼接项目站点、根站点、自定义域名和 basePath", () => {
  const project = githubSiteLocation(
    REPOSITORY,
    makeSettings({ basePath: "/" }),
    {
      html_url: "https://octo.github.io/notes-site/",
      source: { branch: SITE_PUBLISH_BRANCH, path: "/" },
    },
  );
  assert.equal(project.url, "https://octo.github.io/notes-site/");
  assert.equal(project.prefix, "");
  assert.equal(project.settings.origin, "https://octo.github.io");
  assert.equal(project.settings.basePath, "/notes-site/");

  const subpath = githubSiteLocation(
    REPOSITORY,
    makeSettings({ basePath: "/blog/" }),
    { html_url: "https://octo.github.io/notes-site/" },
  );
  assert.equal(subpath.url, "https://octo.github.io/notes-site/blog/");
  assert.equal(subpath.prefix, "blog/");

  const legacy = githubSiteLocation(
    REPOSITORY,
    makeSettings({ basePath: "/notes-site/blog/" }),
    { html_url: "https://octo.github.io/notes-site/" },
  );
  assert.equal(legacy.url, "https://octo.github.io/notes-site/blog/");
  assert.equal(legacy.settings.basePath, "/notes-site/blog/");
  assert.equal(legacy.prefix, "blog/");

  const custom = githubSiteLocation(
    REPOSITORY,
    makeSettings({ basePath: "/docs/" }),
    { html_url: "https://blog.example.com/" },
  );
  assert.equal(custom.url, "https://blog.example.com/docs/");
  assert.equal(custom.prefix, "docs/");

  const rootRepository = { ...REPOSITORY, name: "octo.github.io" };
  const root = githubSiteLocation(
    rootRepository,
    makeSettings({ basePath: "/" }),
    null,
  );
  assert.equal(root.url, "https://octo.github.io/");
  assert.equal(root.prefix, "");

  assert.throws(
    () =>
      githubSiteLocation(REPOSITORY, makeSettings(), {
        html_url: "javascript:alert(1)",
      }),
    GitHubPublishingError,
  );
});

test("githubSiteLocation 对项目根 /notes/ 和根域名 Pages /notes/ 不重复追加前缀", () => {
  const notesRepository = { ...REPOSITORY, name: "notes", fullName: "octo/notes" };
  const pages = { html_url: "https://octo.github.io/notes/" };
  for (const basePath of ["/notes", "/notes/"]) {
    const location = githubSiteLocation(notesRepository, makeSettings({ basePath }), pages);
    assert.equal(location.url, "https://octo.github.io/notes/");
    assert.equal(location.prefix, "");
    assert.equal(location.settings.basePath, "/notes/");
  }

  const nested = githubSiteLocation(
    notesRepository,
    makeSettings({ basePath: "/notes/blog/" }),
    pages,
  );
  assert.equal(nested.url, "https://octo.github.io/notes/blog/");
  assert.equal(nested.prefix, "blog/");

  const repositorySubpath = githubSiteLocation(
    notesRepository,
    makeSettings({ basePath: "/blog/" }),
    pages,
  );
  assert.equal(repositorySubpath.url, "https://octo.github.io/notes/blog/");
  assert.equal(repositorySubpath.prefix, "blog/");

  const rootDomainPages = githubSiteLocation(
    { ...REPOSITORY, name: "octo.github.io" },
    makeSettings({ basePath: "/notes/" }),
    { html_url: "https://blog.example.com/" },
  );
  assert.equal(rootDomainPages.url, "https://blog.example.com/notes/");
  assert.equal(rootDomainPages.prefix, "notes/");
  assert.equal(rootDomainPages.settings.basePath, "/notes/");
});

test("首次发布创建 orphan gh-pages 单次提交，不写默认分支", async () => {
  const fixture = createFakeGitHub({
    repository: REPOSITORY,
    defaultFiles: { "README.md": "# main branch\n" },
  });
  const mainHead = fixture.fake.branchHead("main");
  const result = await publish(fixture, {
    "index.html": "<h1>hello</h1>",
    "assets/app.js": "console.log(1);\n",
    "images/a.png": Buffer.from([0, 1, 2, 255]),
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.counts, {
    added: 5,
    modified: 0,
    deleted: 0,
    unchanged: 0,
    uploaded: 5,
  });
  assert.equal(fixture.fake.branchHead("main"), mainHead);
  assert.equal(fixture.fake.branchHead(SITE_PUBLISH_BRANCH), result.commitSha);

  const commit = fixture.fake.commit(result.commitSha);
  assert.ok(commit);
  assert.deepEqual(commit.parents, []);

  const commitPosts = callsEndingWith(fixture, "POST", "/git/commits");
  assert.equal(commitPosts.length, 1);
  const refCreates = fixture.fake.calls.filter(
    (call) => call.method === "POST" && call.path.endsWith("/git/refs"),
  );
  assert.equal(refCreates.length, 1);
  assert.deepEqual(refCreates[0].body, {
    ref: `refs/heads/${SITE_PUBLISH_BRANCH}`,
    sha: result.commitSha,
  });
  assert.equal(
    fixture.fake.calls.filter(
      (call) => call.method === "PATCH" && call.path.includes("/git/refs/"),
    ).length,
    0,
  );

  const treePost = callsEndingWith(fixture, "POST", "/git/trees")[0];
  assert.ok(treePost);
  assert.equal(
    (treePost.body as { base_tree?: string }).base_tree,
    undefined,
  );
  assert.ok(
    !writeCalls(fixture).some(
      (call) => call.path.includes("/git/ref") && call.path.includes("main"),
    ),
  );

  const files = fixture.fake.branchFiles(SITE_PUBLISH_BRANCH);
  assert.deepEqual(Object.keys(files).sort(), [
    ".nojekyll",
    ".notes-site-publishing.json",
    "assets/app.js",
    "images/a.png",
    "index.html",
  ]);
  assert.equal(files["assets/app.js"], "console.log(1);\n");
  const manifest = JSON.parse(files[".notes-site-publishing.json"]) as {
    version: number;
    paths: string[];
    signature: string;
  };
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.paths, [
    ".nojekyll",
    "assets/app.js",
    "images/a.png",
    "index.html",
  ]);
  assert.match(manifest.signature, /^[0-9a-f]{64}$/);
});

test("重复发布同一快照不产生 blob、tree、commit 或 ref 写请求", async () => {
  const fixture = createFakeGitHub({ repository: REPOSITORY });
  const first = await publish(fixture, {
    "index.html": "<h1>v1</h1>",
    "assets/app.js": "same\n",
  });
  const writesBefore = writeCalls(fixture).length;

  const second = await publish(fixture, {
    "index.html": "<h1>v1</h1>",
    "assets/app.js": "same\n",
  });

  assert.equal(second.changed, false);
  assert.equal(second.commitSha, first.commitSha);
  assert.equal(second.counts.uploaded, 0);
  assert.equal(second.counts.added, 0);
  assert.equal(second.counts.modified, 0);
  assert.equal(second.counts.deleted, 0);
  assert.ok(second.counts.unchanged >= 3);
  assert.equal(writeCalls(fixture).length, writesBefore);
  assert.equal(
    fixture.fake.branchHead(SITE_PUBLISH_BRANCH),
    first.commitSha,
  );
});

test("修改、新增、删除只提交差异，删除用 sha:null 并复用未变 blob", async () => {
  const fixture = createFakeGitHub({ repository: REPOSITORY });
  const first = await publish(fixture, {
    "index.html": "<h1>v1</h1>",
    "keep.txt": "keep-unchanged\n",
    "old.txt": "remove-me\n",
  });
  const firstCommit = fixture.fake.commit(first.commitSha);
  assert.ok(firstCommit);
  const keepSha = fixture.fake.fileSha(SITE_PUBLISH_BRANCH, "keep.txt");
  const treePostCount = callsEndingWith(fixture, "POST", "/git/trees").length;
  const blobPostCount = callsEndingWith(fixture, "POST", "/git/blobs").length;

  const second = await publish(fixture, {
    "index.html": "<h1>v2</h1>",
    "keep.txt": "keep-unchanged\n",
    "new.txt": "new-file\n",
  });

  assert.equal(second.changed, true);
  assert.deepEqual(second.counts, {
    added: 1,
    modified: 2,
    deleted: 1,
    unchanged: 2,
    uploaded: 3,
  });
  assert.equal(fixture.fake.fileSha(SITE_PUBLISH_BRANCH, "keep.txt"), keepSha);
  assert.equal(fixture.fake.branchFile(SITE_PUBLISH_BRANCH, "old.txt"), undefined);
  assert.equal(
    fixture.fake.branchFile(SITE_PUBLISH_BRANCH, "new.txt")?.toString(),
    "new-file\n",
  );

  const treePost = callsEndingWith(fixture, "POST", "/git/trees")[
    treePostCount
  ];
  assert.ok(treePost);
  const treeBody = treePost.body as {
    base_tree: string;
    tree: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string | null;
    }>;
  };
  assert.equal(treeBody.base_tree, firstCommit.tree);
  assert.deepEqual(
    treeBody.tree.find((entry) => entry.path === "old.txt"),
    {
      path: "old.txt",
      mode: "100644",
      type: "blob",
      sha: null,
    },
  );
  assert.equal(
    treeBody.tree.some((entry) => entry.path === "keep.txt"),
    false,
  );
  assert.equal(
    treeBody.tree.find((entry) => entry.path === "index.html")?.sha,
    fixture.fake.fileSha(SITE_PUBLISH_BRANCH, "index.html"),
  );

  const newBlobCalls = callsEndingWith(
    fixture,
    "POST",
    "/git/blobs",
  ).slice(blobPostCount);
  assert.ok(
    !newBlobCalls.some(
      (call) =>
        Buffer.from(
          (call.body as { content: string }).content,
          "base64",
        ).toString() === "keep-unchanged\n",
    ),
  );
});

test("不同新路径的相同内容只上传一次 blob", async () => {
  const fixture = createFakeGitHub({ repository: REPOSITORY });
  const duplicate = "duplicated-content\n";
  await publish(fixture, {
    "index.html": "<h1>dedupe</h1>",
    "a.txt": duplicate,
    "nested/b.txt": duplicate,
  });

  const matchingBlobUploads = callsEndingWith(
    fixture,
    "POST",
    "/git/blobs",
  ).filter(
    (call) =>
      Buffer.from(
        (call.body as { content: string }).content,
        "base64",
      ).toString() === duplicate,
  );
  assert.equal(matchingBlobUploads.length, 1);
  assert.equal(
    fixture.fake.fileSha(SITE_PUBLISH_BRANCH, "a.txt"),
    fixture.fake.fileSha(SITE_PUBLISH_BRANCH, "nested/b.txt"),
  );
});

test("签名清单保留未受管 README 和文件，只删除自己管理过的路径", async () => {
  const fixture = createFakeGitHub({
    repository: REPOSITORY,
    defaultFiles: { "README.md": "# main\n" },
    branches: {
      [SITE_PUBLISH_BRANCH]: {
        "README.md": "# gh-pages docs\n",
        "assets/public.css": "/* unmanaged */\n",
      },
    },
  });
  const seededHead = fixture.fake.branchHead(SITE_PUBLISH_BRANCH);
  const first = await publish(fixture, {
    "index.html": "<h1>v1</h1>",
    "old/page.html": "old page\n",
  });
  assert.equal(
    fixture.fake.commit(first.commitSha)?.parents[0],
    seededHead,
  );
  assert.equal(
    fixture.fake.branchFile(SITE_PUBLISH_BRANCH, "README.md")?.toString(),
    "# gh-pages docs\n",
  );

  await publish(fixture, {
    "index.html": "<h1>v2</h1>",
    "new/page.html": "new page\n",
  });

  const files = fixture.fake.branchFiles(SITE_PUBLISH_BRANCH);
  assert.equal(files["README.md"], "# gh-pages docs\n");
  assert.equal(files["assets/public.css"], "/* unmanaged */\n");
  assert.equal(files["old/page.html"], undefined);
  assert.equal(files["new/page.html"], "new page\n");
  assert.equal(files["index.html"], "<h1>v2</h1>");

  const manifest = JSON.parse(files[".notes-site-publishing.json"]) as {
    paths: string[];
  };
  assert.ok(!manifest.paths.includes("README.md"));
  assert.ok(!manifest.paths.includes("assets/public.css"));
  assert.ok(manifest.paths.includes("new/page.html"));
  assert.ok(!manifest.paths.includes("old/page.html"));
});

test("外部清单或已有 index.html 冲突时停止发布且不改动原分支", async () => {
  const foreignManifest = JSON.stringify({
    version: 1,
    owner: "other-owner",
    paths: ["index.html"],
    signature: "00".repeat(32),
  });
  const foreign = createFakeGitHub({
    repository: REPOSITORY,
    branches: {
      [SITE_PUBLISH_BRANCH]: {
        "index.html": "existing index\n",
        ".notes-site-publishing.json": foreignManifest,
      },
    },
  });
  const foreignMain = foreign.fake.branchHead("main");
  const foreignHead = foreign.fake.branchHead(SITE_PUBLISH_BRANCH);
  await assertGitHubError(
    publish(foreign, { "index.html": "ours\n" }),
    /发布清单/,
  );
  assert.equal(foreign.fake.branchHead(SITE_PUBLISH_BRANCH), foreignHead);
  assert.equal(foreign.fake.branchHead("main"), foreignMain);
  assert.equal(writeCalls(foreign).length, 0);

  const collision = createFakeGitHub({
    repository: REPOSITORY,
    branches: {
      [SITE_PUBLISH_BRANCH]: { "index.html": "existing index\n" },
    },
  });
  const collisionMain = collision.fake.branchHead("main");
  const collisionHead = collision.fake.branchHead(SITE_PUBLISH_BRANCH);
  await assertGitHubError(
    publish(collision, { "index.html": "ours\n" }),
    /非本应用管理/,
  );
  assert.equal(collision.fake.branchHead(SITE_PUBLISH_BRANCH), collisionHead);
  assert.equal(collision.fake.branchHead("main"), collisionMain);
  assert.equal(writeCalls(collision).length, 0);
});

test("内容完全相同的未受管页面或资源也不能被发布清单接管", async () => {
  for (const collision of ["index.html", "assets/shared.css"]) {
    const fixture = createFakeGitHub({
      repository: REPOSITORY,
      branches: { [SITE_PUBLISH_BRANCH]: { [collision]: "identical content\n" } },
    });
    const head = fixture.fake.branchHead(SITE_PUBLISH_BRANCH);
    await assertGitHubError(
      publish(fixture, { "index.html": "new home\n", [collision]: "identical content\n" }),
      /非本应用管理/,
    );
    assert.equal(fixture.fake.branchHead(SITE_PUBLISH_BRANCH), head);
    assert.equal(fixture.fake.branchFile(SITE_PUBLISH_BRANCH, collision)?.toString(), "identical content\n");
    assert.equal(fixture.fake.branchFile(SITE_PUBLISH_BRANCH, ".notes-site-publishing.json"), undefined);
    assert.equal(writeCalls(fixture).length, 0);
  }

  const customDomain = createFakeGitHub({
    repository: REPOSITORY,
    branches: { [SITE_PUBLISH_BRANCH]: { CNAME: "notes.example.com\n", ".nojekyll": "" } },
  });
  await publish(customDomain, { "index.html": "new home\n" }, { cname: "notes.example.com" });
  assert.equal(customDomain.fake.branchFile(SITE_PUBLISH_BRANCH, "CNAME")?.toString(), "notes.example.com\n");
  assert.equal(customDomain.fake.branchFile(SITE_PUBLISH_BRANCH, ".nojekyll")?.length, 0);
});

test("递归树被截断时退回逐层读取，仍能准确删除受管旧文件", async () => {
  const fixture = createFakeGitHub({ repository: REPOSITORY });
  await publish(fixture, {
    "index.html": "<h1>v1</h1>",
    "nested/keep.txt": "keep\n",
    "nested/deep/page.html": "old nested page\n",
  });
  const callsBefore = fixture.fake.calls.length;
  fixture.fake.truncateRecursive = true;

  await publish(fixture, {
    "index.html": "<h1>v2</h1>",
    "nested/keep.txt": "keep\n",
    "new.txt": "new\n",
  });

  const fallbackTreeReads = fixture.fake.calls
    .slice(callsBefore)
    .filter(
      (call) =>
        call.method === "GET" &&
        call.path.includes("/git/trees/") &&
        call.search === "",
    );
  assert.ok(fallbackTreeReads.length >= 2);
  assert.equal(
    fixture.fake.branchFile(
      SITE_PUBLISH_BRANCH,
      "nested/deep/page.html",
    ),
    undefined,
  );
  assert.equal(
    fixture.fake.branchFile(SITE_PUBLISH_BRANCH, "new.txt")?.toString(),
    "new\n",
  );
});

test("forced=false 的 ref 竞争会重新读取分支并重试，保留并发提交", async () => {
  const fixture = createFakeGitHub({ repository: REPOSITORY });
  await publish(fixture, { "index.html": "<h1>v1</h1>" });
  const commitsBefore = callsEndingWith(
    fixture,
    "POST",
    "/git/commits",
  ).length;
  let raced = false;
  let externalCommit: string | undefined;
  fixture.fake.hooks.beforeRefUpdate = ({ method, branch }) => {
    if (
      method === "PATCH" &&
      branch === SITE_PUBLISH_BRANCH &&
      !raced
    ) {
      raced = true;
      externalCommit = fixture.fake.writeFilesExternally(
        SITE_PUBLISH_BRANCH,
        { "external.txt": "concurrent\n" },
      );
      return "conflict";
    }
    return undefined;
  };

  const result = await publish(fixture, { "index.html": "<h1>v2</h1>" });

  assert.equal(raced, true);
  assert.ok(externalCommit);
  assert.equal(result.changed, true);
  assert.equal(fixture.fake.branchHead(SITE_PUBLISH_BRANCH), result.commitSha);
  assert.deepEqual(fixture.fake.commit(result.commitSha)?.parents, [
    externalCommit,
  ]);
  assert.equal(
    fixture.fake.branchFile(SITE_PUBLISH_BRANCH, "external.txt")?.toString(),
    "concurrent\n",
  );
  assert.equal(
    fixture.fake.branchFile(SITE_PUBLISH_BRANCH, "index.html")?.toString(),
    "<h1>v2</h1>",
  );

  assert.equal(
    callsEndingWith(fixture, "POST", "/git/commits").length -
      commitsBefore,
    2,
  );
  const patches = callsEndingWith(
    fixture,
    "PATCH",
    `/git/refs/heads/${SITE_PUBLISH_BRANCH}`,
  );
  assert.equal(patches.length, 2);
  assert.ok(
    patches.every(
      (call) => (call.body as { force: boolean }).force === false,
    ),
  );
});

test("ref 更新响应丢失时回读确认成功，不重复提交", async () => {
  const fixture = createFakeGitHub({ repository: REPOSITORY });
  let lost = false;
  fixture.fake.hooks.beforeRefUpdate = ({ method }) => {
    if (method === "POST" && !lost) {
      lost = true;
      return "lost";
    }
    return undefined;
  };

  const result = await publish(fixture, { "index.html": "<h1>lost</h1>" });

  assert.equal(lost, true);
  assert.equal(result.changed, true);
  assert.equal(fixture.fake.branchHead(SITE_PUBLISH_BRANCH), result.commitSha);
  assert.equal(callsEndingWith(fixture, "POST", "/git/commits").length, 1);
  assert.equal(callsEndingWith(fixture, "POST", "/git/blobs").length, 3);
  assert.equal(
    fixture.fake.calls.filter(
      (call) => call.method === "PATCH" && call.path.includes("/git/refs/"),
    ).length,
    0,
  );
});

test("空仓库和 gh-pages 默认分支都会被拒绝，且不写主分支", async () => {
  const empty = createFakeGitHub({
    repository: REPOSITORY,
    defaultFiles: null,
  });
  await assertGitHubError(
    publish(empty, { "index.html": "<h1>empty</h1>" }),
    /尚未初始化.*README/,
  );
  assert.equal(empty.fake.branchHead("main"), undefined);
  assert.equal(empty.fake.branchHead(SITE_PUBLISH_BRANCH), undefined);
  assert.equal(writeCalls(empty).length, 0);

  const invalidDefault = createFakeGitHub({
    repository: { ...REPOSITORY, defaultBranch: SITE_PUBLISH_BRANCH },
  });
  const callsBefore = invalidDefault.fake.calls.length;
  await assertGitHubError(
    publish(invalidDefault, { "index.html": "<h1>invalid</h1>" }),
    /默认分支/,
  );
  assert.equal(invalidDefault.fake.calls.length, callsBefore);
  assert.equal(writeCalls(invalidDefault).length, 0);
});

test("configurePages 只接受 legacy gh-pages，缺失时创建，409 时重新读取", async () => {
  const legacySourceOnly = createFakeGitHub({
    repository: REPOSITORY,
    pages: {
      html_url: "https://octo.github.io/notes-site/",
      source: { branch: SITE_PUBLISH_BRANCH, path: "/" },
    },
  });
  await configurePages(
    legacySourceOnly.api,
    "token",
    legacySourceOnly.repository,
    signal(),
  );
  assert.equal(
    callsEndingWith(legacySourceOnly, "POST", "/pages").length,
    0,
  );

  const legacyExplicit = createFakeGitHub({
    repository: REPOSITORY,
    pages: {
      html_url: "https://octo.github.io/notes-site/",
      build_type: "legacy",
      source: { branch: SITE_PUBLISH_BRANCH, path: "/" },
    },
  });
  await configurePages(
    legacyExplicit.api,
    "token",
    legacyExplicit.repository,
    signal(),
  );
  assert.equal(callsEndingWith(legacyExplicit, "POST", "/pages").length, 0);

  for (const pages of [
    {
      html_url: "https://octo.github.io/notes-site/",
      build_type: "workflow",
      source: { branch: "main", path: "/" },
    },
    {
      html_url: "https://octo.github.io/notes-site/",
      source: { branch: "main", path: "/" },
    },
  ]) {
    const blocked = createFakeGitHub({ repository: REPOSITORY, pages });
    await assertGitHubError(
      configurePages(
        blocked.api,
        "token",
        blocked.repository,
        signal(),
      ),
      /其他 Pages 发布方式/,
    );
    assert.equal(callsEndingWith(blocked, "POST", "/pages").length, 0);
  }

  const missing = createFakeGitHub({ repository: REPOSITORY, pages: null });
  await configurePages(
    missing.api,
    "token",
    missing.repository,
    signal(),
  );
  const creates = callsEndingWith(missing, "POST", "/pages");
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].body, {
    build_type: "legacy",
    source: { branch: SITE_PUBLISH_BRANCH, path: "/" },
  });

  const raced = createFakeGitHub({ repository: REPOSITORY, pages: null });
  raced.fake.pagesCreateConflictOnce = true;
  await configurePages(raced.api, "token", raced.repository, signal());
  assert.equal(callsEndingWith(raced, "POST", "/pages").length, 1);
  assert.equal(raced.fake.pages?.source?.branch, SITE_PUBLISH_BRANCH);
});

test("waitForPages 只认本次 commit，构建失败和主动中断会传播", async () => {
  const other = createFakeGitHub({ repository: REPOSITORY });
  other.fake.latestBuild = { commit: "another-build", status: "built" };
  other.fake.buildOnRequest = { commit: "target-commit", status: "queued" };
  other.fake.pollUpdates.push({ commit: "target-commit", status: "built" });
  await waitForPages({
    api: other.api,
    token: "token",
    repository: REPOSITORY,
    commitSha: "target-commit",
    signal: signal(),
    pollMs: 1,
  });
  assert.equal(
    callsEndingWith(other, "POST", "/pages/builds").length,
    1,
  );
  assert.equal(
    other.fake.calls.filter(
      (call) =>
        call.method === "GET" && call.path.endsWith("/pages/builds/latest"),
    ).length >= 2,
    true,
  );
  assert.equal(other.fake.latestBuild?.commit, "target-commit");

  const failed = createFakeGitHub({ repository: REPOSITORY });
  failed.fake.latestBuild = {
    commit: "target-commit",
    status: "errored",
    error: { message: "build failed" },
  };
  await assertGitHubError(
    waitForPages({
      api: failed.api,
      token: "token",
      repository: REPOSITORY,
      commitSha: "target-commit",
      signal: signal(),
      pollMs: 1,
    }),
    /构建失败/,
  );
  assert.equal(callsEndingWith(failed, "POST", "/pages/builds").length, 0);

  const hanging = createFakeGitHub({ repository: REPOSITORY });
  hanging.fake.latestBuild = {
    commit: "target-commit",
    status: "building",
  };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("测试主动中断")),
    20,
  );
  try {
    await assert.rejects(
      waitForPages({
        api: hanging.api,
        token: "token",
        repository: REPOSITORY,
        commitSha: "target-commit",
        signal: controller.signal,
        pollMs: 2,
      }),
      (error: unknown) =>
        error instanceof Error && error.message === "测试主动中断",
    );
  } finally {
    clearTimeout(timer);
  }
});

test("loadGitHubAppConfig 校验回调、密钥、App ID 与加密密钥", async (context) => {
  const baseEnv: NodeJS.ProcessEnv = {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_SLUG: "notes-publisher",
    GITHUB_APP_CLIENT_ID: "Iv1.test-client",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
    GITHUB_APP_PRIVATE_KEY: testGitHubPrivateKey().replace(/\n/g, "\\n"),
    GITHUB_PUBLISH_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
    GITHUB_APP_CALLBACK_URL:
      "https://notes.example/api/site-publishing/github/callback",
  };

  const config = await loadGitHubAppConfig(baseEnv);
  assert.ok(config);
  assert.equal(config.appId, 12345);
  assert.equal(config.slug, "notes-publisher");
  assert.equal(config.clientId, "Iv1.test-client");
  assert.equal(config.tokenKey.length, 32);
  assert.ok(config.privateKey.startsWith("-----BEGIN PRIVATE KEY-----"));
  assert.equal(
    config.callbackUrl,
    "https://notes.example/api/site-publishing/github/callback",
  );

  const derived = await loadGitHubAppConfig({
    ...baseEnv,
    GITHUB_APP_CALLBACK_URL: undefined,
    NOTES_PUBLIC_BASE_URL: "https://notes.example/",
  });
  assert.equal(
    derived?.callbackUrl,
    "https://notes.example/api/site-publishing/github/callback",
  );

  const local = await loadGitHubAppConfig({
    ...baseEnv,
    GITHUB_APP_CALLBACK_URL: "http://127.0.0.1:3000/callback",
  });
  assert.equal(local?.callbackUrl, "http://127.0.0.1:3000/callback");

  const directory = await temporaryDirectory(context, "notes-github-config-");
  const keyPath = path.join(directory, "app-private-key.pem");
  await writeFile(keyPath, testGitHubPrivateKey(), { mode: 0o600 });
  const fromFile = await loadGitHubAppConfig({
    ...baseEnv,
    GITHUB_APP_PRIVATE_KEY: undefined,
    GITHUB_APP_PRIVATE_KEY_PATH: keyPath,
  });
  assert.ok(fromFile?.privateKey.startsWith("-----BEGIN PRIVATE KEY-----"));

  assert.equal(
    await loadGitHubAppConfig({
      ...baseEnv,
      GITHUB_APP_CLIENT_SECRET: undefined,
    }),
    null,
  );
  assert.equal(
    await loadGitHubAppConfig({
      ...baseEnv,
      GITHUB_APP_PRIVATE_KEY: undefined,
    }),
    null,
  );

  await assert.rejects(
    loadGitHubAppConfig({
      ...baseEnv,
      GITHUB_APP_CALLBACK_URL: "http://notes.example/callback",
    }),
    /HTTPS/,
  );
  await assert.rejects(
    loadGitHubAppConfig({
      ...baseEnv,
      GITHUB_APP_CALLBACK_URL:
        "https://notes.example/callback?next=https://evil.test",
    }),
    /回调地址/,
  );
  await assert.rejects(
    loadGitHubAppConfig({
      ...baseEnv,
      GITHUB_PUBLISH_TOKEN_KEY: Buffer.alloc(31, 1).toString("base64"),
    }),
    /加密密钥配置/,
  );
  await assert.rejects(
    loadGitHubAppConfig({ ...baseEnv, GITHUB_APP_ID: "0" }),
    /App ID、Slug/,
  );

  const ecKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  await assert.rejects(
    loadGitHubAppConfig({
      ...baseEnv,
      GITHUB_APP_PRIVATE_KEY: ecKey,
    }),
    /RSA/,
  );
});

test("exchangeToken 使用 GitHub OAuth 端点并返回过期信息", async () => {
  const fixture = createFakeGitHub({ repository: REPOSITORY });
  const before = Date.now();
  const tokens = await fixture.api.exchangeToken({
    code: "oauth-code",
    redirect_uri: "https://notes.example/callback",
  });

  assert.equal(tokens.accessToken, "gho_fake_user_token");
  assert.equal(tokens.refreshToken, "ghr_fake_refresh_token");
  assert.ok(
    (tokens.expiresAt ?? 0) >= before + 28_800_000 - 1_000,
  );
  assert.ok(
    (tokens.refreshExpiresAt ?? 0) >= before + 15_897_600_000 - 1_000,
  );

  const call = fixture.fake.calls[0];
  assert.equal(call.host, "github.com");
  assert.equal(call.path, "/login/oauth/access_token");
  assert.equal(call.method, "POST");
  const body = call.body as Record<string, string>;
  assert.equal(body.client_id, fixture.config.clientId);
  assert.equal(body.client_secret, fixture.config.clientSecret);
  assert.equal(body.code, "oauth-code");

  fixture.fake.oauthTokens = { expires_in: 600 };
  await assert.rejects(
    fixture.api.exchangeToken({ code: "expired" }),
    (error: unknown) =>
      error instanceof GitHubPublishingError && error.status === 401,
  );
});

test("repositories 按 App、安装状态和 push 权限取交集并校验返回 ID", async () => {
  const config = createFakeGitHubConfig({ appId: 777 });
  const fixture = createFakeGitHub({
    repository: REPOSITORY,
    config,
    installations: [
      {
        id: 10,
        appId: 777,
        suspended_at: null,
        repositories: [
          {
            id: 42,
            name: "notes-site",
            owner: { login: "octo" },
            default_branch: "main",
            permissions: { push: true },
          },
          {
            id: 43,
            name: "docs",
            owner: { login: "octo" },
            default_branch: "trunk",
            permissions: { push: true, admin: true },
          },
          {
            id: 46,
            name: "read-only",
            owner: { login: "octo" },
            permissions: { push: false },
          },
          {
            id: 47,
            name: "archived",
            owner: { login: "octo" },
            archived: true,
            permissions: { push: true },
          },
          {
            id: 48,
            name: "disabled",
            owner: { login: "octo" },
            disabled: true,
            permissions: { push: true },
          },
          {
            id: 49,
            name: "bad/name",
            owner: { login: "octo" },
            permissions: { push: true },
          },
          {
            id: 50,
            name: "owner-check",
            owner: { login: "bad owner" },
            permissions: { push: true },
          },
        ],
      },
      {
        id: 11,
        appId: 999,
        suspended_at: null,
        repositories: [
          {
            id: 44,
            name: "other-app",
            owner: { login: "octo" },
            permissions: { push: true },
          },
        ],
      },
      {
        id: 12,
        appId: 777,
        suspended_at: "2024-01-01T00:00:00Z",
        repositories: [
          {
            id: 45,
            name: "suspended",
            owner: { login: "octo" },
            permissions: { push: true },
          },
        ],
      },
    ],
  });

  const repositories = await fixture.api.repositories("user-token");
  assert.deepEqual(
    repositories.map((repository) => repository.id),
    [42, 43],
  );
  assert.ok(
    repositories.every(
      (repository) =>
        repository.installationId === 10 &&
        Number.isSafeInteger(repository.id) &&
        repository.id > 0,
    ),
  );
  assert.equal(repositories[1].defaultBranch, "trunk");
  assert.equal(repositories[1].fullName, "octo/docs");

  const installationCalls = fixture.fake.calls.filter(
    (call) => call.method === "GET" && call.path === "/user/installations",
  );
  assert.equal(installationCalls.length, 1);
  assert.match(installationCalls[0].search, /per_page=100/);
  assert.match(installationCalls[0].search, /page=1/);
  assert.ok(
    fixture.fake.calls.some(
      (call) =>
        call.method === "GET" &&
        call.path === "/user/installations/10/repositories",
    ),
  );
});

test("installationToken 只授权目标仓库并要求 contents/pages 写权限", async () => {
  const fixture = createFakeGitHub({
    repository: REPOSITORY,
    installationAccessToken: "ghs_fake_scoped_token",
  });
  const token = await fixture.api.installationToken(REPOSITORY);

  assert.equal(token, "ghs_fake_scoped_token");
  const call = fixture.fake.calls.find(
    (candidate) =>
      candidate.method === "POST" &&
      candidate.path === `/app/installations/${REPOSITORY.installationId}/access_tokens`,
  );
  assert.ok(call);
  assert.deepEqual(call.body, {
    repository_ids: [REPOSITORY.id],
    permissions: { contents: "write", pages: "write" },
  });

  const authorization = call.headers.get("authorization");
  assert.ok(authorization);
  assert.ok(authorization.startsWith("Bearer "));
  const jwt = authorization.slice("Bearer ".length);
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  const header = JSON.parse(
    Buffer.from(parts[0], "base64url").toString("utf8"),
  ) as { alg: string; typ: string };
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  ) as { iss: string; iat: number; exp: number };
  assert.equal(header.alg, "RS256");
  assert.equal(header.typ, "JWT");
  assert.equal(payload.iss, fixture.config.clientId);
  assert.ok(payload.exp > payload.iat);
  assert.ok(payload.exp - payload.iat <= 600);
  assert.ok(parts[2].length > 0);
});

test("Store 用 AES-GCM 封装 token，密文不含明文且错误账号或密钥失败", async (context) => {
  const directory = await temporaryDirectory(context, "notes-github-store-");
  const key = Buffer.alloc(32, 1);
  const otherKey = Buffer.alloc(32, 2);
  const store = new GitHubPublishingStore(directory, key);
  const tokens = {
    accessToken: "gho_fake_store_token",
    refreshToken: "ghr_fake_store_refresh",
    expiresAt: Date.now() + 3_600_000,
  };

  const sealed = store.seal("account-a", tokens);
  assert.equal(sealed.includes(tokens.accessToken), false);
  assert.equal(sealed.includes(tokens.refreshToken), false);
  assert.equal(
    Buffer.from(sealed, "base64").includes(Buffer.from(tokens.accessToken)),
    false,
  );
  assert.deepEqual(store.unseal("account-a", sealed), tokens);
  assert.throws(() => store.unseal("account-b", sealed));
  assert.throws(
    () => new GitHubPublishingStore(directory, otherKey).unseal("account-a", sealed),
  );
  assert.throws(
    () => new GitHubPublishingStore(directory).seal("account-a", tokens),
    /not configured/,
  );
});

test("Store 原子持久化、重启恢复和并发更新串行写入", async (context) => {
  const directory = await temporaryDirectory(context, "notes-github-store-");
  const key = Buffer.alloc(32, 3);
  const store = new GitHubPublishingStore(directory, key);
  const tokens = {
    accessToken: "gho_fake_persisted_token",
    refreshToken: "ghr_fake_persisted_refresh",
    expiresAt: Date.now() + 3_600_000,
  };
  await store.update("owner", () => ({
    connection: {
      user: { id: 1001, login: "octo" },
      tokens: store.seal("owner", tokens),
    },
  }));

  const restarted = new GitHubPublishingStore(directory, key);
  const account = await restarted.get("owner");
  assert.equal(account.connection?.user.login, "octo");
  assert.ok(account.connection);
  assert.deepEqual(restarted.unseal("owner", account.connection.tokens), tokens);

  const raw = await readFile(
    path.join(directory, "github-site-publishing.json"),
    "utf8",
  );
  assert.equal(raw.includes(tokens.accessToken), false);
  assert.equal(raw.includes(tokens.refreshToken), false);
  assert.deepEqual(await readdir(directory), ["github-site-publishing.json"]);

  const baseJob: GitHubPublishJob = {
    id: "serialized-job",
    phase: "queued",
    message: "",
    startedAt: 1,
    updatedAt: 0,
  };
  await Promise.all(
    Array.from({ length: 20 }, () =>
      restarted.update("owner", (current) => ({
        ...current,
        job: {
          ...(current.job ?? baseJob),
          updatedAt: (current.job?.updatedAt ?? 0) + 1,
        },
      })),
    ),
  );
  assert.equal((await restarted.get("owner")).job?.updatedAt, 20);
  assert.deepEqual(await readdir(directory), ["github-site-publishing.json"]);
});

test("recoverInterruptedJobs 把活动任务标为 interrupted 并保留提交信息", async (context) => {
  const directory = await temporaryDirectory(context, "notes-github-store-");
  const key = Buffer.alloc(32, 4);
  const store = new GitHubPublishingStore(directory, key);
  await store.update("committed", () => ({
    job: {
      id: "job-committed",
      phase: "deploying",
      message: "部署中",
      startedAt: 10,
      updatedAt: 10,
      commitSha: "abc123",
    },
  }));
  await store.update("pending", () => ({
    job: {
      id: "job-pending",
      phase: "uploading",
      message: "上传中",
      startedAt: 20,
      updatedAt: 20,
    },
  }));
  await store.update("published", () => ({
    job: {
      id: "job-published",
      phase: "published",
      message: "已发布",
      startedAt: 30,
      updatedAt: 30,
      commitSha: "def456",
    },
  }));

  await store.recoverInterruptedJobs();

  const restarted = new GitHubPublishingStore(directory, key);
  const committed = await restarted.get("committed");
  assert.equal(committed.job?.phase, "interrupted");
  assert.equal(committed.job?.commitSha, "abc123");
  assert.match(committed.job?.message ?? "", /已提交/);

  const pending = await restarted.get("pending");
  assert.equal(pending.job?.phase, "interrupted");
  assert.match(pending.job?.message ?? "", /发布中断/);

  const published = await restarted.get("published");
  assert.equal(published.job?.phase, "published");
  assert.equal(published.job?.message, "已发布");
});
