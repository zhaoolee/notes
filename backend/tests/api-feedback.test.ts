import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

interface ImportedImage {
  hash: string;
  extension: string;
  path: string;
  url: string;
}

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");

  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配 feedback 测试端口");
  }

  const port = address.port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`后端在健康检查前退出，退出码：${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // 服务仍在启动，继续轮询。
    }

    await delay(100);
  }

  throw new Error("等待后端健康检查超时");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    once(child, "exit"),
    delay(5_000, undefined, { ref: false }).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

test("Express 提供健康检查和内容寻址图片存储", async (context) => {
  const port = await getUnusedPort();
  const storageDir = await mkdtemp(path.join(tmpdir(), "notes-feedback-images-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EXPORT_APP_URL: baseUrl,
        IMAGE_STORAGE_DIR: storageDir,
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  context.after(async () => {
    await stopChild(child);
    await rm(storageDir, { force: true, recursive: true });
  });

  try {
    await waitForHealth(baseUrl, child);

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { ok: true });

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "pixel.png");

    const importResponse = await fetch(`${baseUrl}/api/images/import`, {
      method: "POST",
      body: form,
    });
    assert.equal(importResponse.status, 200);

    const imported = (await importResponse.json()) as ImportedImage;
    assert.match(imported.hash, /^[a-f0-9]{64}$/);
    assert.equal(imported.extension, "png");
    assert.equal(imported.path, `/images/${imported.hash}.png`);
    assert.equal(imported.url, `${baseUrl}${imported.path}`);

    const stored = await readFile(path.join(storageDir, `${imported.hash}.png`));
    assert.deepEqual(stored, png);

    const imageResponse = await fetch(`${baseUrl}${imported.path}`);
    assert.equal(imageResponse.status, 200);
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
});
