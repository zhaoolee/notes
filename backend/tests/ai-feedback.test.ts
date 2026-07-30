import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function getUnusedPort(): Promise<number> {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配 AI feedback 端口");
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
      throw new Error(`后端在 AI 测试前退出，退出码：${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // 服务仍在启动。
    }

    await delay(100);
  }

  throw new Error("等待 AI feedback 后端超时");
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

function getCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";")[0];
}

test("启动探测成功后只向登录用户返回逐条 AI 建议且不写工作区", async (context) => {
  const appPort = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-ai-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-ai-images-"));
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const upstreamRequests: Array<{
    authorization: string;
    body: Record<string, unknown> | null;
    path: string;
  }> = [];
  const upstream = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      upstreamRequests.push({
        authorization: request.headers.authorization || "",
        body: rawBody
          ? (JSON.parse(rawBody) as Record<string, unknown>)
          : null,
        path: request.url || "",
      });

      response.setHeader("Content-Type", "application/json");

      if (request.method === "GET" && request.url === "/v1/models") {
        response.end(
          JSON.stringify({
            data: [
              { id: "deepseek-v4-flash", object: "model" },
              { id: "deepseek-v4-pro", object: "model" },
            ],
            object: "list",
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        request.url === "/v1/chat/completions"
      ) {
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    suggestions: [
                      {
                        original: "这里有错字",
                        replacement: "这里有别字",
                        reason: "修正错别字",
                      },
                      {
                        original: "重复",
                        replacement: "不重复",
                        reason: "这个片段不唯一，应被服务端丢弃",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        );
        return;
      }

      response.statusCode = 404;
      response.end('{"error":"not found"}');
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();

  if (!upstreamAddress || typeof upstreamAddress === "string") {
    throw new Error("无法分配 AI mock 端口");
  }

  const testKey = "feedback-ai-key-do-not-leak";
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_STORAGE_DIR: dataDir,
        IMAGE_STORAGE_DIR: imageDir,
        OPENAI_API_KEY: testKey,
        OPENAI_BASE_URL: `http://127.0.0.1:${upstreamAddress.port}/v1`,
        PORT: String(appPort),
        SESSION_SECRET: "ai-feedback-session-secret-with-sufficient-entropy",
        SUPERADMIN: "ai-feedback-admin",
        SUPERADMINPASSWORD: "ai-feedback-password",
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
    upstream.close();
    await once(upstream, "close");
    await rm(dataDir, { force: true, recursive: true });
    await rm(imageDir, { force: true, recursive: true });
  });

  await waitForHealth(baseUrl, child);

  const statusResponse = await fetch(`${baseUrl}/api/ai/status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { available: true });

  const anonymousResponse = await fetch(`${baseUrl}/api/ai/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: "检查错别字",
      markdown: "这里有错字",
    }),
  });
  assert.equal(anonymousResponse.status, 401);
  assert.equal(
    upstreamRequests.filter((request) => request.path === "/v1/chat/completions")
      .length,
    0,
  );

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: "ai-feedback-password",
      username: "ai-feedback-admin",
    }),
  });
  assert.equal(loginResponse.status, 200);
  const cookie = getCookie(loginResponse);
  const markdown = "# 测试\n\n这里有错字。重复。重复。";
  const instruction = "请检查文章的错别字和标点";
  const reviewResponse = await fetch(`${baseUrl}/api/ai/suggestions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: baseUrl,
    },
    body: JSON.stringify({ instruction, markdown }),
  });
  assert.equal(reviewResponse.status, 200);
  const result = (await reviewResponse.json()) as {
    sourceHash: string;
    suggestions: Array<{
      end: number;
      id: string;
      original: string;
      reason: string;
      replacement: string;
      start: number;
    }>;
  };

  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].original, "这里有错字");
  assert.equal(
    markdown.slice(result.suggestions[0].start, result.suggestions[0].end),
    result.suggestions[0].original,
  );

  const completionRequest = upstreamRequests.find(
    (request) => request.path === "/v1/chat/completions",
  );
  assert.ok(completionRequest);
  assert.equal(completionRequest.authorization, `Bearer ${testKey}`);
  assert.equal(completionRequest.body?.model, "deepseek-v4-flash");
  assert.deepEqual(completionRequest.body?.response_format, {
    type: "json_object",
  });
  assert.match(JSON.stringify(completionRequest.body), new RegExp(instruction));
  assert.match(JSON.stringify(completionRequest.body), /这里有错字/);

  const workspaceResponse = await fetch(`${baseUrl}/api/workspace`, {
    headers: { Cookie: cookie },
  });
  assert.equal(workspaceResponse.status, 200);
  assert.deepEqual(await workspaceResponse.json(), {
    updatedAt: null,
    workspace: null,
  });
  assert.doesNotMatch(stdout, new RegExp(testKey));
  assert.doesNotMatch(stderr, new RegExp(testKey));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(testKey));
});
