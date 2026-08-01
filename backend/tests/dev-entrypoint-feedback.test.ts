import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("本地开发入口同时启动前端和导出后端", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const [devEntrypoint, gitignore, dockerignore, environmentExample] =
    await Promise.all([
      readFile("scripts/dev.mjs", "utf8"),
      readFile(".gitignore", "utf8"),
      readFile(".dockerignore", "utf8"),
      readFile(".env.example", "utf8"),
    ]);

  assert.equal(packageJson.scripts?.dev, "node scripts/dev.mjs");
  assert.match(devEntrypoint, /loadEnvFile\(environmentPath\)/);
  assert.match(devEntrypoint, /tsx[^]*watch[^]*server\/index\.ts/);
  assert.match(devEntrypoint, /VITE_PORT \|\| "15173"/);
  assert.match(devEntrypoint, /vite[^]*"--port"[^]*frontendPort/);
  assert.match(devEntrypoint, /EXPORT_APP_URL/);
  assert.match(gitignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(environmentExample, /^QINIU_ACCESS_KEY=$/m);
  assert.match(environmentExample, /^QINIU_SECRET_KEY=$/m);
  assert.match(
    environmentExample,
    /^# NOTES_PUBLIC_BASE_URL=https:\/\/notes\.example\.com$/m,
  );
});

test("生产反向代理保留外层 HTTPS 协议", async () => {
  const nginxConfig = await readFile("docker/nginx/default.conf", "utf8");

  assert.match(
    nginxConfig,
    /map \$http_x_forwarded_proto \$notes_forwarded_proto \{[^}]*default \$scheme;[^}]*https https;[^}]*\}/,
  );
  assert.equal(
    nginxConfig.match(
      /proxy_set_header X-Forwarded-Proto \$notes_forwarded_proto;/g,
    )?.length,
    2,
  );
  assert.doesNotMatch(
    nginxConfig,
    /proxy_set_header X-Forwarded-Proto \$scheme;/,
  );
});

test("生产反向代理为 20MB 单图保留请求封装空间", async () => {
  const nginxConfig = await readFile("docker/nginx/default.conf", "utf8");

  assert.match(nginxConfig, /client_max_body_size 25m;/);
});

test("生产镜像包含归档资源和 Hermes Skill 下载模板", async () => {
  const [backendDockerfile, appDockerfile] = await Promise.all([
    readFile("Dockerfile.backend", "utf8"),
    readFile("Dockerfile.app", "utf8"),
  ]);

  for (const dockerfile of [backendDockerfile, appDockerfile]) {
    assert.match(
      dockerfile,
      /COPY public\/bg\.jpg \.\/public\/bg\.jpg/,
    );
    assert.match(
      dockerfile,
      /COPY public\/smartisan\/web\/smartisan_hammer_footer\.png \.\/public\/smartisan\/web\/smartisan_hammer_footer\.png/,
    );
    assert.match(
      dockerfile,
      /COPY skills\/notes-workspace-api \.\/skills\/notes-workspace-api/,
    );
  }
});

test("生产站点通过 HTTPS 路径代理七牛图片", async () => {
  const nginxConfig = await readFile("docker/nginx/default.conf", "utf8");

  assert.match(
    nginxConfig,
    /location \/qiniu\/ \{[^}]*proxy_pass http:\/\/tmp-blog\.fangyuanxiaozhan\.com\/;[^}]*proxy_set_header Host tmp-blog\.fangyuanxiaozhan\.com;/,
  );
});
