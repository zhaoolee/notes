import assert from "node:assert/strict";
import test from "node:test";
import { SitePublishingAccountSync, SiteConfigurationConflict, type AccountSiteTransport, type AccountSyncState } from "../../src/features/site-publishing/account-sync.js";
import { createSitePublishDraft, buildSiteExportRequest, type SitePublishAccountConfiguration } from "../../src/features/site-publishing/model.js";
import { saveSitePublishDraft, loadSitePublishDraft, type SitePublishStorage } from "../../src/features/site-publishing/draft-storage.js";

function storage(): SitePublishStorage {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
function server(initial: SitePublishAccountConfiguration | null = null) {
  let value = initial;
  const writes: Array<number | null> = [];
  const transport: AccountSiteTransport = {
    read: async () => structuredClone(value),
    write: async (draft, revision) => {
      writes.push(revision);
      if (revision !== (value?.updatedAt ?? null)) throw new SiteConfigurationConflict();
      value = { draft: structuredClone(draft), updatedAt: (value?.updatedAt ?? 0) + 1 };
      return structuredClone(value);
    },
  };
  return { transport, writes, get: () => value };
}
function client(cache: SitePublishStorage, transport: AccountSiteTransport) {
  let draft = createSitePublishDraft();
  let state: AccountSyncState = { status: "loading", error: "" };
  const sync = new SitePublishingAccountSync({ scope: "alice", storage: cache, notes: [], transport, debounceMs: 60_000,
    onDraft: (next) => { draft = next; }, onState: (next) => { state = next; } });
  return { sync, draft: () => draft, state: () => state };
}

test("旧浏览器配置首次迁入账号，新浏览器没有本机缓存也能恢复 Logo 和分类", async () => {
  const cache = storage();
  const draft = createSitePublishDraft();
  draft.settings.title = "跨设备网站";
  draft.settings.logoPath = `/images/${"a".repeat(64)}.png`;
  draft.categories.push({ id: "custom", name: "随笔", slug: "essay" });
  saveSitePublishDraft(cache, "alice", draft);
  const remote = server();
  const first = client(cache, remote.transport);
  await first.sync.start();
  assert.deepEqual(remote.get()?.draft, draft);
  assert.equal(remote.get()?.draft.settings.basePath, "/notes/");
  first.sync.dispose();
  const second = client(storage(), remote.transport);
  await second.sync.start();
  assert.deepEqual(second.draft(), draft);
  assert.equal(second.draft().settings.basePath, "/notes/");
  assert.equal(second.state().status, "saved");
  assert.equal(remote.writes.length, 1);
  second.sync.dispose();
});

test("账号已有设置时优先恢复账号版本，不被旧的未迁移本机草稿覆盖", async () => {
  const cache = storage();
  const old = createSitePublishDraft(); old.settings.title = "旧浏览器";
  saveSitePublishDraft(cache, "alice", old);
  const cloud = createSitePublishDraft(); cloud.settings.title = "另一台电脑的新配置";
  const remote = server({ draft: cloud, updatedAt: 5 });
  const c = client(cache, remote.transport);
  await c.sync.start();
  assert.equal(c.draft().settings.title, cloud.settings.title);
  assert.equal(remote.writes.length, 0);
  c.sync.dispose();
});

test("读取账号完成前不写入默认值，慢读取不会清空账号设置", async () => {
  let resolve!: (value: SitePublishAccountConfiguration) => void;
  const pending = new Promise<SitePublishAccountConfiguration>((done) => { resolve = done; });
  let writes = 0;
  const c = client(storage(), { read: () => pending, write: async () => { writes += 1; throw new Error("unexpected"); } });
  const loading = c.sync.start();
  assert.equal(writes, 0);
  const draft = createSitePublishDraft(); draft.settings.title = "慢请求";
  resolve({ draft, updatedAt: 8 }); await loading;
  assert.equal(c.draft().settings.title, "慢请求");
  assert.equal(writes, 0);
  c.sync.dispose();
});

test("保存期间继续输入按顺序提交，后一次使用前一次的新版本", async () => {
  const remote = server({ draft: createSitePublishDraft(), updatedAt: 1 });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => { entered = done; });
  const gate = new Promise<void>((done) => { release = done; });
  let block = true;
  const c = client(storage(), { ...remote.transport, write: async (...args) => {
    if (block) { block = false; entered(); await gate; }
    return remote.transport.write(...args);
  } });
  await c.sync.start();
  const first = createSitePublishDraft(); first.settings.title = "第一个输入";
  c.sync.edit(first);
  const saving = c.sync.flush(); await started;
  const last = structuredClone(first); last.settings.title = "最终输入";
  c.sync.edit(last); release(); await saving;
  assert.equal(remote.get()?.draft.settings.title, "最终输入");
  assert.deepEqual(remote.writes, [1, 2]);
  assert.equal(c.state().status, "saved");
  c.sync.dispose();
});

test("离线修改保留在本机，新设备已更新时显示冲突且不自动覆盖", async () => {
  const cache = storage();
  const remote = server({ draft: createSitePublishDraft(), updatedAt: 1 });
  let fail = false;
  const transport = { ...remote.transport, write: async (...args: Parameters<AccountSiteTransport["write"]>) => {
    if (fail) throw new Error("offline");
    return remote.transport.write(...args);
  } };
  const a = client(cache, transport); await a.sync.start();
  const local = createSitePublishDraft(); local.settings.title = "本机尚未同步";
  fail = true; a.sync.edit(local); await a.sync.flush();
  assert.equal(a.state().status, "error"); a.sync.dispose();
  const newer = createSitePublishDraft(); newer.settings.title = "另一设备";
  await remote.transport.write(newer, 1, new AbortController().signal);
  const reopened = client(cache, remote.transport); await reopened.sync.start();
  assert.equal(reopened.state().status, "conflict");
  assert.equal(remote.get()?.draft.settings.title, "另一设备");
  reopened.sync.useAccount();
  assert.equal(reopened.draft().settings.title, "另一设备");
  reopened.sync.dispose();
});

test("两个设备冲突时只有明确保留当前配置才用最新版本重试", async () => {
  const remote = server({ draft: createSitePublishDraft(), updatedAt: 1 });
  const a = client(storage(), remote.transport), b = client(storage(), remote.transport);
  await a.sync.start(); await b.sync.start();
  const da = createSitePublishDraft(); da.settings.title = "设备 A";
  a.sync.edit(da); await a.sync.flush();
  const db = createSitePublishDraft(); db.settings.title = "设备 B";
  b.sync.edit(db); await b.sync.flush();
  assert.equal(b.state().status, "conflict");
  assert.equal(remote.get()?.draft.settings.title, "设备 A");
  await b.sync.keepCurrent();
  assert.equal(remote.get()?.draft.settings.title, "设备 B");
  assert.equal(b.state().status, "saved");
  a.sync.dispose(); b.sync.dispose();
});

test("销毁同步器后晚到的读取不会覆盖界面或触发后续写入", async () => {
  let resolve!: (value: SitePublishAccountConfiguration | null) => void;
  const pending = new Promise<SitePublishAccountConfiguration | null>((done) => { resolve = done; });
  let writes = 0;
  const c = client(storage(), { read: () => pending, write: async () => { writes += 1; throw new Error(); } });
  const loading = c.sync.start(); c.sync.dispose(); resolve(null); await loading;
  assert.equal(writes, 0);
  assert.equal(c.state().status, "loading");
});

test("选择与草稿恢复不再截断为200张", () => {
  const notes = Array.from({ length: 201 }, (_, i) => ({ id: `note-${i}`, markdown: `# 文章 ${i}`, createdAt: 1, updatedAt: 1, deletedAt: null, folderId: null, pinnedAt: null, isStarred: false, normalOrder: i }));
  const draft = createSitePublishDraft();
  draft.selections = notes.map((note) => ({ noteId: note.id, categoryId: "guides" }));
  const cache = storage(); saveSitePublishDraft(cache, "alice", draft);
  assert.equal(loadSitePublishDraft(cache, "alice", notes).selections.length, 201);
  assert.equal(buildSiteExportRequest(draft, notes).notes.length, 201);
});
