import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = path.join(rootDir, ".env");

if (existsSync(environmentPath)) {
  loadEnvFile(environmentPath);
}

const binaryExtension = process.platform === "win32" ? ".cmd" : "";
const frontendPort = process.env.VITE_PORT || "15173";
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const extraFrontendArgs = process.argv.slice(2);

const commands = [
  {
    label: "backend",
    command: path.join(rootDir, "node_modules", ".bin", `tsx${binaryExtension}`),
    args: ["watch", "server/index.ts"],
    env: {
      ...process.env,
      EXPORT_APP_URL: process.env.EXPORT_APP_URL || frontendUrl,
    },
  },
  {
    label: "frontend",
    command: path.join(rootDir, "node_modules", ".bin", `vite${binaryExtension}`),
    args: [
      "--host",
      "127.0.0.1",
      "--port",
      frontendPort,
      "--strictPort",
      ...extraFrontendArgs,
    ],
    env: process.env,
  },
];

const children = [];
let shuttingDown = false;
let exitCode = 0;

function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill(signal);
    }
  }
}

for (const entry of commands) {
  const child = spawn(entry.command, entry.args, {
    cwd: rootDir,
    env: entry.env,
    stdio: "inherit",
  });

  children.push(child);

  child.on("error", (error) => {
    console.error(`[dev:${entry.label}] 启动失败`, error);
    exitCode = 1;
    stopChildren();
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      exitCode = code || (signal ? 1 : 0);
      console.error(
        `[dev:${entry.label}] 已退出${signal ? `（${signal}）` : `（code ${code ?? 0}）`}`,
      );
      stopChildren();
    }

    if (children.every((candidate) => candidate.exitCode != null || candidate.signalCode != null)) {
      process.exit(exitCode);
    }
  });
}

process.on("SIGINT", () => {
  exitCode = 130;
  stopChildren("SIGINT");
});

process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
});
