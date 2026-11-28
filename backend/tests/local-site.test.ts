import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { LocalSitePublisher } from "../../server/site-publishing/local-site.js";
import { siteEntries } from "./fixtures/github-publishing.js";

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-local-site-"));
  const publisher = new LocalSitePublisher(directory, "alice");
  const app = express(); app.use("/notes", publisher.router());
  app.get("/{*any}", (_request, response) => response.send("EDITOR_FALLBACK"));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/notes/`;
  return { directory, publisher, url, async close() {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  } };
}
const signal = () => new AbortController().signal;

test("public local site serves only an activated release, with HEAD and real 404s", async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.url)).status, 404);
    await f.publisher.publish("alice", siteEntries({ "index.html": "<h1>PUBLIC</h1>", "assets/style.css": "body{color:black}", ".nojekyll": "" }), signal());
    const response = await fetch(f.url);
    assert.equal(await response.text(), "<h1>PUBLIC</h1>");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(response.headers.get("cache-control")?.includes("no-cache"));
    assert.match(response.headers.get("content-security-policy")!, /script-src 'self';/);
    assert.equal((await fetch(f.url, { method: "HEAD" })).status, 200);
    assert.equal(await (await fetch(f.url + "assets/style.css")).text(), "body{color:black}");
    for (const file of ["missing.html", "missing.js", "current.json", ".nojekyll", ".env", "releases/"]) {
      const result = await fetch(f.url + file);
      assert.equal(result.status, 404, file);
      assert.doesNotMatch(await result.text(), /EDITOR_FALLBACK|ownerHash/);
    }
    assert.equal((await fetch(f.url, { method: "POST" })).status, 405);
    const restarted = new LocalSitePublisher(f.directory, "alice");
    assert.equal(restarted.canPublish("alice"), true);
    // A second publisher instance reads the same durable pointer.
    await restarted.publish("alice", siteEntries({ "index.html": "RESTARTED" }), signal());
    assert.equal(await (await fetch(f.url)).text(), "RESTARTED");
  } finally { await f.close(); }
});

test("replacement removes old public files; invalid, aborted and foreign-owner publishes preserve the current release", async () => {
  const f = await fixture();
  try {
    await f.publisher.publish("alice", siteEntries({ "index.html": "OLD", "removed/index.html": "OLD ARTICLE" }), signal());
    const before = await fs.readFile(path.join(f.directory, "current.json"), "utf8");
    await assert.rejects(() => f.publisher.publish("bob", siteEntries({ "index.html": "FOREIGN" }), signal()), /cannot update/);
    for (const name of ["../escape", "/absolute", "nested/../../escape", "hidden/.env", "x\\y", "index.html"]) {
      const entries = siteEntries({ "index.html": "NEW" });
      entries.push({ path: `notes-hugo-site/public/${name}`, data: Buffer.from("INVALID") });
      await assert.rejects(() => f.publisher.publish("alice", entries, signal()), /output path/);
    }
    await assert.rejects(() => f.publisher.publish("alice", siteEntries({ "no-index.txt": "EMPTY" }), signal()), /no homepage/);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(() => f.publisher.publish("alice", siteEntries({ "index.html": "ABORTED" }), cancelled.signal));
    assert.equal(await fs.readFile(path.join(f.directory, "current.json"), "utf8"), before);
    assert.equal(await (await fetch(f.url)).text(), "OLD");
    const foreign = new LocalSitePublisher(f.directory, "bob");
    await assert.rejects(() => foreign.publish("bob", siteEntries({ "index.html": "FOREIGN" }), signal()), /belongs to another/);
    await f.publisher.publish("alice", siteEntries({ "index.html": "NEW", "added.txt": "NEW ASSET" }), signal());
    assert.equal(await (await fetch(f.url)).text(), "NEW");
    assert.equal((await fetch(f.url + "removed/")).status, 404);
    assert.equal(await (await fetch(f.url + "added.txt")).text(), "NEW ASSET");
    await f.publisher.publish("alice", siteEntries({ "index.html": "THIRD" }), signal());
    assert.equal((await fs.readdir(path.join(f.directory, "releases"))).length, 2);
  } finally { await f.close(); }
});

test("public readers observe complete old or new releases during activation", async () => {
  const f = await fixture();
  try {
    await f.publisher.publish("alice", siteEntries({ "index.html": "OLD" }), signal());
    const entries = siteEntries({ "index.html": "NEW" });
    for (let index = 0; index < 30; index++) entries.push({ path: `notes-hugo-site/public/assets/${index}.txt`, data: Buffer.alloc(4096, index) });
    const publishing = f.publisher.publish("alice", entries, signal());
    const reads = await Promise.all(Array.from({ length: 20 }, async () => {
      const response = await fetch(f.url); assert.equal(response.status, 200); return response.text();
    }));
    await publishing;
    assert.ok(reads.every((value) => value === "OLD" || value === "NEW"));
    assert.equal(await (await fetch(f.url)).text(), "NEW");
  } finally { await f.close(); }
});
