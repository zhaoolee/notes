import assert from "node:assert/strict";
import test from "node:test";
import { SiteBuildGate } from "../../server/site-publishing/build-gate.js";

test("ZIP 和 GitHub 构建共用容量，同账号串行且释放操作可重复调用", async () => {
  const gate = new SiteBuildGate(2); const signal = new AbortController().signal;
  const first = gate.tryAcquire("alice")!; const second = gate.tryAcquire("bob")!;
  assert.equal(gate.tryAcquire("alice"), null); assert.equal(gate.tryAcquire("carol"), null);
  let entered = false;
  const pending = gate.acquire("alice", signal).then((release) => { entered = true; return release; });
  second(); await Promise.resolve(); assert.equal(entered, false);
  first(); const release = await pending; assert.equal(entered, true);
  first(); assert.equal(gate.tryAcquire("alice"), null);
  release(); gate.tryAcquire("alice")!();
});

test("取消排队构建会释放监听器和队列位置，不占用后续容量", async () => {
  const gate = new SiteBuildGate(1); const release = gate.tryAcquire("alice")!;
  const controller = new AbortController(); const queued = gate.acquire("bob", controller.signal);
  controller.abort(new Error("cancelled")); await assert.rejects(queued, /cancelled/);
  release(); const next = gate.tryAcquire("bob"); assert.ok(next); next();
});
