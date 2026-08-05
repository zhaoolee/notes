import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const benchmarkSource = readFileSync(
  "scripts/benchmark-input-latency.mjs",
  "utf8",
);
const toolsDocumentation = readFileSync("TOOLS/README.md", "utf8");

test("正文输入延迟 benchmark 提供稳定的项目命令和测量口径", () => {
  assert.equal(
    packageJson.scripts["benchmark:input"],
    "node scripts/benchmark-input-latency.mjs",
  );
  assert.match(benchmarkSource, /textarea\.markdown-editor/);
  assert.match(benchmarkSource, /requestAnimationFrame/);
  assert.match(benchmarkSource, /keydownToNextPaintMs/);
  assert.match(benchmarkSource, /--max-p95/);
  assert.match(benchmarkSource, /\.note-list-select/);
  assert.match(toolsDocumentation, /npm run benchmark:input/);
});

test("正文输入延迟 benchmark 的帮助命令无需启动浏览器和前端", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/benchmark-input-latency.mjs", "--help"],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /输入延迟 benchmark/);
  assert.match(result.stdout, /--characters <n>/);
  assert.match(result.stdout, /keydown.*requestAnimationFrame/s);
});
