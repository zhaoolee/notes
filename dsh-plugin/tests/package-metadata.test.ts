// DSH profile 使用 hoisted node_modules，并关闭 peer 自动安装。宿主运行时包必须声明为
// peerDependencies；若放进 dependencies，插件副本会遮蔽 DSH 自带副本，使内部 Symbol
// 不一致并在第一次工具调用时触发 scheduler.prepare 崩溃。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: {
    "."?: {
      default?: string;
      types?: string;
    };
  };
  files?: string[];
  main?: string;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  types?: string;
}

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);

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

test("GitHub 市场安装无需运行构建脚本也有完整入口产物", async () => {
  const manifest = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as PackageManifest;

  assert.equal(manifest.main, "lib/index.js");
  assert.equal(manifest.types, "lib/types/index.d.ts");
  assert.equal(manifest.exports?.["."]?.default, "./lib/index.js");
  assert.equal(manifest.exports?.["."]?.types, "./lib/types/index.d.ts");
  assert.ok(manifest.files?.includes("lib"), "npm 包必须继续携带 lib 目录");
  assert.equal(manifest.scripts?.prepack, "npm run build");

  const requiredArtifacts = [
    "lib/index.js",
    "lib/notes-client.js",
    "lib/types.js",
    "lib/types/index.d.ts",
    "lib/types/notes-client.d.ts",
    "lib/types/types.d.ts",
  ];
  await Promise.all(
    requiredArtifacts.map((relativePath) => access(`${packageDirectory}${relativePath}`)),
  );
});

test("仓库内的预编译产物与当前 TypeScript 源码一致", async () => {
  const scratchDirectory = await mkdtemp(path.join(tmpdir(), "dsh-notes-prebuilt-"));
  const scratchLib = path.join(scratchDirectory, "lib");
  const compiler = fileURLToPath(
    new URL("../node_modules/typescript/bin/tsc", import.meta.url),
  );
  const artifacts = [
    "index.js",
    "notes-client.js",
    "types.js",
    "types/index.d.ts",
    "types/notes-client.d.ts",
    "types/types.d.ts",
  ];

  try {
    await execFileAsync(process.execPath, [
      compiler,
      "-p",
      path.join(packageDirectory, "tsconfig.json"),
      "--outDir",
      scratchLib,
      "--declarationDir",
      path.join(scratchLib, "types"),
    ], { cwd: packageDirectory });

    for (const artifact of artifacts) {
      assert.deepEqual(
        await readFile(path.join(packageDirectory, "lib", artifact)),
        await readFile(path.join(scratchLib, artifact)),
        `${artifact} 需要重新构建并随源码一起提交`,
      );
    }
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true });
  }
});
