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
  engines?: Record<string, string>;
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
    // 0.2.0-rc.2 起 DSH 依次捆绑 cordis ~4.0.4 / ~4.0.5 / ~4.1.0，
    // 所以 peer 必须同时容纳 4.0.x 与 4.1.x，否则最新 DSH 会判定为 IncompatiblePlugin。
    "@deepseek-ai/cordis": "^4.0.4 || >=4.0.6-alpha.2 <5.0.0",
    "@deepseek-ai/dsh-tools": ">=0.2.0-rc.2 <0.3.0-0",
  };

  // 本地构建固定在 peer 范围内的最新一版 DSH 上；peer 再放宽到整条 0.2 线，
  // 这样用户侧 0.2.0/0.2.1 的运行时不会被版本门槛挡掉。
  const expectedDevPins = {
    "@deepseek-ai/cordis": "4.1.0",
    "@deepseek-ai/dsh-tools": "0.2.2-rc.1",
  };

  assert.deepEqual(runtimeDependencies, {
    "@deepseek-ai/schemastery": "^3.19.0",
  });
  assert.deepEqual(peerDependencies, expectedPeers);

  // DSH 用 engines.dsh 判定插件是否适配当前运行时，缺失或过窄都会被拒装。
  assert.equal(manifest.engines?.dsh, ">=0.2.0-rc.2 <0.3.0-0");

  for (const name of Object.keys(expectedPeers)) {
    assert.equal(name in runtimeDependencies, false, `${name} 不能作为普通依赖安装`);
    assert.equal(
      devDependencies[name],
      expectedDevPins[name as keyof typeof expectedDevPins],
      `${name} 仍需在 devDependencies 固定一份供本地构建和测试使用`,
    );
    assert.match(devDependencies[name] ?? "", /^\d/, `${name} 的构建副本必须是具体版本而不是范围`);
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
