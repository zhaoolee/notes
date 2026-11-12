import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GITHUB_PUBLISH_POLL_INTERVAL_MS,
  GitHubPublishControls,
  describeGitHubPublishJob,
  formatGitHubPublishCounts,
  getGitHubPublishAvailability,
  isGitHubPublishJobActive,
} from "../../src/features/site-publishing/GitHubPublishControls.js";
import {
  GITHUB_PUBLISHING_CONNECT_ENDPOINT,
  GITHUB_PUBLISHING_CONNECTION_ENDPOINT,
  GITHUB_PUBLISHING_PUBLISH_ENDPOINT,
  GITHUB_PUBLISHING_REPOSITORIES_ENDPOINT,
  GITHUB_PUBLISHING_REPOSITORY_ENDPOINT,
  GITHUB_PUBLISHING_STATUS_ENDPOINT,
  GitHubPublishError,
  createGitHubConnectUrl,
  disconnectGitHub,
  fetchGitHubPublishingStatus,
  fetchGitHubRepositories,
  getUrlAfterConsumingGitHubPublishRedirect,
  publishSiteToGitHub,
  readGitHubPublishRedirectFromUrl,
  sanitizeGitHubCommitUrl,
  sanitizeGitHubSiteUrl,
  selectGitHubRepository,
} from "../../src/features/site-publishing/github-client.js";
import type {
  GitHubPublishJob,
  GitHubPublishingStatus,
  GitHubSiteRepository,
} from "../../src/features/site-publishing/github-model.js";
import {
  buildSiteExportRequest,
  createSitePublishDraft,
} from "../../src/features/site-publishing/model.js";
import { SitePublishPanel } from "../../src/features/site-publishing/SitePublishPanel.js";
import type { NoteDocument } from "../../src/types/app.js";

const noop = () => undefined;

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchStub(
  respond: (call: FetchCall) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = {
      url: typeof input === "string" ? input : String(input),
      init: init ?? {},
    };
    calls.push(call);
    return respond(call);
  };

  return { fetchImpl, calls };
}

const REPOSITORY: GitHubSiteRepository = {
  id: 42,
  installationId: 7,
  owner: "octo",
  name: "notes-site",
  fullName: "octo/notes-site",
  defaultBranch: "main",
};

function makeNote(id: string, title: string): NoteDocument {
  return {
    id,
    markdown: `# ${title}\n\n${title}的正文。`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    normalOrder: 0,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  };
}

function makeStatus(
  overrides: Partial<GitHubPublishingStatus> = {},
): GitHubPublishingStatus {
  return {
    enabled: true,
    connected: true,
    repository: REPOSITORY,
    job: null,
    ...overrides,
  };
}

test("GitHub 状态请求使用同源 Cookie、no-store，并解析仓库与任务", async () => {
  const signal = new AbortController().signal;
  const job: GitHubPublishJob = {
    id: "job-1",
    phase: "uploading",
    message: "正在上传 3 个文件",
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    counts: { added: 1, modified: 2, deleted: 3, unchanged: 4, uploaded: 5 },
  };
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse({
      enabled: true,
      connected: true,
      githubLogin: "octo",
      repository: REPOSITORY,
      job,
    }),
  );

  const status = await fetchGitHubPublishingStatus({ fetchImpl, signal });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GITHUB_PUBLISHING_STATUS_ENDPOINT);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.signal.aborted, false);
  assert.equal(
    new Headers(calls[0].init.headers).get("accept"),
    "application/json",
  );
  assert.equal(status.enabled, true);
  assert.equal(status.connected, true);
  assert.equal(status.githubLogin, "octo");
  assert.deepEqual(status.repository, REPOSITORY);
  assert.equal(status.job?.phase, "uploading");
  assert.deepEqual(status.job?.counts, {
    added: 1,
    modified: 2,
    deleted: 3,
    unchanged: 4,
    uploaded: 5,
  });
});

test("GitHub 状态接口把 JSON error 转成可读错误，非法响应不会误报成功", async () => {
  const { fetchImpl } = createFetchStub(() =>
    jsonResponse({ error: "请先登录账号。" }, 401),
  );

  await assert.rejects(
    fetchGitHubPublishingStatus({ fetchImpl }),
    (error: unknown) =>
      error instanceof GitHubPublishError &&
      error.status === 401 &&
      error.message === "请先登录账号。",
  );

  const invalid = createFetchStub(() => jsonResponse({ enabled: "yes" }));
  await assert.rejects(
    fetchGitHubPublishingStatus({ fetchImpl: invalid.fetchImpl }),
    /GitHub 发布状态响应格式不正确/,
  );
});

test("仓库列表按 {repositories} 解析，异常响应会被拒绝", async () => {
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse({ repositories: [REPOSITORY] }),
  );

  assert.deepEqual(await fetchGitHubRepositories({ fetchImpl }), [REPOSITORY]);
  assert.equal(calls[0].url, GITHUB_PUBLISHING_REPOSITORIES_ENDPOINT);

  const invalid = createFetchStub(() => jsonResponse({ items: [] }));
  await assert.rejects(
    fetchGitHubRepositories({ fetchImpl: invalid.fetchImpl }),
    /GitHub 仓库列表响应格式不正确/,
  );
});

test("授权只返回 GitHub 域名地址，拒绝非 GitHub 或非 HTTPS 地址", async () => {
  const trusted = createFetchStub(() =>
    jsonResponse({
      url: "https://github.com/apps/notes-publisher/installations/new?state=abc",
    }),
  );
  const url = await createGitHubConnectUrl({ fetchImpl: trusted.fetchImpl });

  assert.equal(
    url,
    "https://github.com/apps/notes-publisher/installations/new?state=abc",
  );
  assert.equal(trusted.calls[0].url, GITHUB_PUBLISHING_CONNECT_ENDPOINT);
  assert.equal(trusted.calls[0].init.method, "POST");

  for (const unsafe of [
    "https://evil.example.com/oauth",
    "http://github.com/apps/x/installations/new",
    "javascript:alert(1)",
    "https://user:pass@github.com/apps/x",
  ]) {
    const stub = createFetchStub(() => jsonResponse({ url: unsafe }));
    await assert.rejects(
      createGitHubConnectUrl({ fetchImpl: stub.fetchImpl }),
      /GitHub 授权地址不正确/,
    );
  }
});

test("选择仓库只提交 repositoryId 与 installationId，断开连接返回账号范围状态", async () => {
  const put = createFetchStub(() => jsonResponse(makeStatus()));
  const status = await selectGitHubRepository(REPOSITORY, {
    fetchImpl: put.fetchImpl,
  });

  assert.equal(put.calls[0].url, GITHUB_PUBLISHING_REPOSITORY_ENDPOINT);
  assert.equal(put.calls[0].init.method, "PUT");
  assert.equal(put.calls[0].init.credentials, "same-origin");
  assert.equal(put.calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(String(put.calls[0].init.body)), {
    repositoryId: 42,
    installationId: 7,
  });
  assert.equal(status.repository?.fullName, "octo/notes-site");

  const remove = createFetchStub(() =>
    jsonResponse(makeStatus({ connected: false, repository: null })),
  );
  const disconnected = await disconnectGitHub({ fetchImpl: remove.fetchImpl });

  assert.equal(remove.calls[0].url, GITHUB_PUBLISHING_CONNECTION_ENDPOINT);
  assert.equal(remove.calls[0].init.method, "DELETE");
  assert.equal(disconnected.connected, false);
});

test("轮询间隔在 3–5 秒内，终态任务停止轮询", () => {
  assert.ok(GITHUB_PUBLISH_POLL_INTERVAL_MS >= 3_000);
  assert.ok(GITHUB_PUBLISH_POLL_INTERVAL_MS <= 5_000);

  for (const phase of ["queued", "building", "uploading", "committing", "deploying"] as const) {
    assert.equal(
      isGitHubPublishJobActive({
        id: "job-1",
        phase,
        message: "",
        startedAt: 1,
        updatedAt: 2,
      }),
      true,
    );
  }

  for (const phase of ["published", "failed", "interrupted"] as const) {
    assert.equal(
      isGitHubPublishJobActive({
        id: "job-1",
        phase,
        message: "",
        startedAt: 1,
        updatedAt: 2,
      }),
      false,
    );
  }
});

test("发布前复用 ZIP 导出的请求校验，空选择不会发出网络请求", async () => {
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse({ job: { id: "job-1", phase: "queued", startedAt: 1, updatedAt: 1 } }, 202),
  );

  await assert.rejects(
    publishSiteToGitHub(createSitePublishDraft(), [], { fetchImpl }),
    /请选择至少一张便签/,
  );
  assert.equal(calls.length, 0);
});

test("发布请求使用与 ZIP 导出相同的 payload，并解析 202 任务", async () => {
  const note = makeNote("note-a", "甲便签");
  const draft = createSitePublishDraft();
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  const expected = buildSiteExportRequest(draft, [note]);
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse(
      {
        job: {
          id: "job-9",
          phase: "queued",
          message: "",
          startedAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      },
      202,
    ),
  );

  const job = await publishSiteToGitHub(draft, [note], { fetchImpl, repositoryId: REPOSITORY.id });
  assert.equal(new Headers(calls[0].init.headers).get("X-Notes-GitHub-Repository-Id"), String(REPOSITORY.id));

  assert.equal(job.id, "job-9");
  assert.equal(job.phase, "queued");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GITHUB_PUBLISHING_PUBLISH_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), expected);
  // 发布请求只包含与 ZIP 导出一致的便签快照，不含账号或凭据字段。
  assert.doesNotMatch(String(calls[0].init.body), /token|password|secret/i);
});

test("发布按钮只在已授权、有仓库、有便签且无活动任务时可用", () => {
  const base = {
    selectedCount: 1,
    disabled: false,
    status: makeStatus(),
    savingRepository: false,
    publishing: false,
    connecting: false,
    disconnecting: false,
  };

  assert.equal(getGitHubPublishAvailability(base).canPublish, true);

  const empty = getGitHubPublishAvailability({ ...base, selectedCount: 0 });
  assert.equal(empty.canPublish, false);
  assert.match(empty.reason, /至少选择一张便签/);

  const noRepository = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({ repository: null }),
  });
  assert.equal(noRepository.canPublish, false);
  assert.match(noRepository.reason, /选择要发布到的 GitHub 仓库/);

  const active = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({
      job: {
        id: "job-1",
        phase: "uploading",
        message: "",
        startedAt: 1,
        updatedAt: 2,
      },
    }),
  });
  assert.equal(active.canPublish, false);
  assert.match(active.reason, /已有发布任务进行中/);

  const busy = getGitHubPublishAvailability({ ...base, disabled: true });
  assert.equal(busy.canPublish, false);

  const unconfigured = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({ enabled: false }),
  });
  assert.equal(unconfigured.canPublish, false);

  const disconnected = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({ connected: false, repository: null }),
  });
  assert.equal(disconnected.canPublish, false);
  assert.match(disconnected.reason, /授权 GitHub 仓库/);
});

test("提交成功与已发布分开：只有 published 才算站点上线", () => {
  const deploying = describeGitHubPublishJob({
    id: "job-1",
    phase: "deploying",
    message: "",
    startedAt: 1,
    updatedAt: 2,
    commitSha: "abc123",
    commitUrl: "https://github.com/octo/notes-site/commit/abc123",
  });
  assert.equal(deploying.active, true);
  assert.equal(deploying.terminal, false);
  assert.equal(deploying.live, false);
  assert.equal(deploying.committed, true);
  assert.match(deploying.label, /已提交成功/);
  assert.doesNotMatch(deploying.label, /已发布/);

  const published = describeGitHubPublishJob({
    id: "job-1",
    phase: "published",
    message: "",
    startedAt: 1,
    updatedAt: 3,
    siteUrl: "https://octo.example.com/",
  });
  assert.equal(published.active, false);
  assert.equal(published.terminal, true);
  assert.equal(published.live, true);
  assert.match(published.label, /已发布/);

  const failed = describeGitHubPublishJob({
    id: "job-2",
    phase: "failed",
    message: "GitHub 拒绝了这次提交。",
    startedAt: 1,
    updatedAt: 3,
  });
  assert.equal(failed.active, false);
  assert.equal(failed.terminal, true);
  assert.equal(failed.live, false);
});

test("发布数量与链接只展示后端给出的有效值", () => {
  assert.equal(
    formatGitHubPublishCounts({
      added: 1,
      modified: 2,
      deleted: 3,
      unchanged: 4,
      uploaded: 5,
    }),
    "新增 1 · 修改 2 · 删除 3 · 未变 4 · 上传文件 5",
  );
  assert.equal(formatGitHubPublishCounts(undefined), "");

  assert.equal(
    sanitizeGitHubSiteUrl("https://blog.example.com/posts/"),
    "https://blog.example.com/posts/",
  );
  assert.equal(sanitizeGitHubSiteUrl("http://blog.example.com/"), null);
  assert.equal(sanitizeGitHubSiteUrl("javascript:alert(1)"), null);
  assert.equal(
    sanitizeGitHubSiteUrl("https://user:pass@blog.example.com/"),
    null,
  );
  assert.equal(
    sanitizeGitHubCommitUrl(
      "https://github.com/octo/notes-site/commit/abc123",
    ),
    "https://github.com/octo/notes-site/commit/abc123",
  );
  assert.equal(
    sanitizeGitHubCommitUrl("https://blog.example.com/commit/abc123"),
    null,
  );
});

test("OAuth 回调只消费 githubPublish，保留其他查询参数与编辑器 hash", () => {
  const href =
    "https://notes.example.com/path?theme=dark&githubPublish=connected#note=abc&view=editor";

  assert.equal(readGitHubPublishRedirectFromUrl(href), "connected");
  assert.equal(
    readGitHubPublishRedirectFromUrl(
      "https://notes.example.com/path?githubPublish=error",
    ),
    "error",
  );
  assert.equal(
    readGitHubPublishRedirectFromUrl(
      "https://notes.example.com/path?githubPublish=other",
    ),
    null,
  );
  assert.equal(readGitHubPublishRedirectFromUrl("not a url"), null);
  assert.equal(
    getUrlAfterConsumingGitHubPublishRedirect(href),
    "/path?theme=dark#note=abc&view=editor",
  );
});

test("SSR 首屏不触碰 window，GitHub 卡片只显示初始加载状态", () => {
  assert.equal(typeof window, "undefined");

  const draft = createSitePublishDraft();
  draft.selections = [{ noteId: "note-a", categoryId: "guides" }];
  const notes = [makeNote("note-a", "甲便签")];

  const controlsHtml = renderToStaticMarkup(
    createElement(GitHubPublishControls, {
      draft,
      notes,
      disabled: false,
      storageScope: "user-a",
    }),
  );

  assert.match(controlsHtml, /data-site-publish-github="loading"/);
  assert.match(controlsHtml, /正在读取 GitHub 发布状态/);
  assert.match(controlsHtml, /GitHub Pages/);
  assert.doesNotMatch(controlsHtml, /发布到 GitHub Pages/);
  assert.doesNotMatch(controlsHtml, /type="password"/);
  assert.doesNotMatch(controlsHtml, /token/i);

  const panelHtml = renderToStaticMarkup(
    createElement(SitePublishPanel, {
      notes,
      storageScope: "user-a",
      onClose: noop,
    }),
  );

  assert.match(panelHtml, /data-site-publish-github="loading"/);
  assert.match(panelHtml, /生成网站 ZIP/);
  assert.doesNotMatch(panelHtml, /type="password"/);
  // GitHub 状态未就绪时 ZIP 仍是主要动作。
  assert.match(
    panelHtml,
    /class="site-publish-primary"[^>]*>生成网站 ZIP/,
  );
});
