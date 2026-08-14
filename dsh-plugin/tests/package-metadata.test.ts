// DSH profile 使用 hoisted node_modules，并关闭 peer 自动安装。宿主运行时包必须声明为
// peerDependencies；若放进 dependencies，插件副本会遮蔽 DSH 自带副本，使内部 Symbol
// 不一致并在第一次工具调用时触发 scheduler.prepare 崩溃。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

test("DSH 宿主运行时只作为 peer 依赖，不随插件安装第二份", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as PackageManifest;
  const runtimeDependencies = manifest.dependencies ?? {};
  const peerDependencies = manifest.peerDependencies ?? {};
  const devDependencies = manifest.devDependencies ?? {};
  const expectedPeers = {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.6",
  };

  assert.deepEqual(runtimeDependencies, {
    "@deepseek-ai/schemastery": "^3.18.1",
  });
  assert.deepEqual(peerDependencies, expectedPeers);

  for (const [name, range] of Object.entries(expectedPeers)) {
    assert.equal(name in runtimeDependencies, false, `${name} 不能作为普通依赖安装`);
    assert.equal(devDependencies[name], range, `${name} 仍需供本地构建和测试使用`);
  }
});
