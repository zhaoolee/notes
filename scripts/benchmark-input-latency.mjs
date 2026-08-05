import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultBaseUrl = "http://127.0.0.1:15173";
const defaultBenchmarkUrl = `${defaultBaseUrl}/?testData=smartisan-web-20&resetTestData=1`;

function printHelp() {
  console.log(`锤子便签正文输入延迟 benchmark

用法：
  npm run benchmark:input
  npm run benchmark:input -- [选项]

选项：
  --url <url>          测试已经运行的页面；指定后不会自动启动前端
  --characters <n>    计入统计的输入字符数（默认：200）
  --warmup <n>        预热字符数（默认：20）
  --interval <ms>     两次按键之间的间隔（默认：10）
  --seed-length <n>   测试前填入的正文长度（默认：2000）
  --max-p95 <ms>      p95 超过阈值时以非零状态退出
  --mobile             使用 390 × 844 的移动端视口
  --no-start           默认网址不可用时也不自动启动前端
  --json               只输出机器可读的 JSON
  --help               显示帮助

测量口径：每个可打印按键的 keydown 到浏览器下一次绘制机会
（requestAnimationFrame）的耗时。结果同时包含 keydown 到 input 事件的耗时。`);
}

function readNumber(value, option, { integer = false, min = 0 } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${option} 必须是${integer ? "整数" : "数字"}且不小于 ${min}`);
  }

  return parsed;
}

function parseArgs(argv) {
  const options = {
    url: defaultBenchmarkUrl,
    characters: 200,
    warmup: 20,
    interval: 10,
    seedLength: 2_000,
    maxP95: null,
    mobile: false,
    autoStart: true,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      index += 1;
      const value = argv[index];
      if (value === undefined) {
        throw new Error(`${argument} 缺少参数`);
      }
      return value;
    };

    switch (argument) {
      case "--url":
        options.url = nextValue();
        options.autoStart = false;
        break;
      case "--characters":
        options.characters = readNumber(nextValue(), argument, { integer: true, min: 1 });
        break;
      case "--warmup":
        options.warmup = readNumber(nextValue(), argument, { integer: true });
        break;
      case "--interval":
        options.interval = readNumber(nextValue(), argument);
        break;
      case "--seed-length":
        options.seedLength = readNumber(nextValue(), argument, { integer: true });
        break;
      case "--max-p95":
        options.maxP95 = readNumber(nextValue(), argument);
        break;
      case "--mobile":
        options.mobile = true;
        break;
      case "--no-start":
        options.autoStart = false;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`未知选项：${argument}`);
    }
  }

  return options;
}

function getOrigin(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

async function isPageAvailable(url, timeoutMs = 800) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

function startFrontend(baseUrl) {
  const parsedUrl = new URL(baseUrl);
  const viteBinary = path.join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vite.cmd" : "vite",
  );
  const child = spawn(
    viteBinary,
    [
      "--host",
      parsedUrl.hostname,
      "--port",
      parsedUrl.port || "80",
      "--strictPort",
    ],
    {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let recentOutput = "";
  const collectOutput = (chunk) => {
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-4_000);
  };
  child.stdout.on("data", collectOutput);
  child.stderr.on("data", collectOutput);

  return { child, getRecentOutput: () => recentOutput };
}

async function waitForPage(url, server, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `前端启动失败（code ${server.child.exitCode}）\n${server.getRecentOutput()}`,
      );
    }

    if (await isPageAvailable(url)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`等待前端启动超时：${url}\n${server.getRecentOutput()}`);
}

function stopFrontend(server) {
  if (server?.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill("SIGTERM");
  }
}

function makeSeedText(length) {
  const heading = "# 输入延迟基准\n\n";
  const paragraph = "这是一段用于模拟真实便签长度的文本，包含中文、标点和普通段落。\n";
  return `${heading}${paragraph.repeat(Math.ceil(length / paragraph.length))}`.slice(0, length);
}

function makeInputText(length) {
  const sequence = "benchmark input 0123456789 ";
  return sequence.repeat(Math.ceil(length / sequence.length)).slice(0, length);
}

function round(value) {
  return Number(value.toFixed(2));
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (percent) => {
    const index = Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1);
    return sorted[index];
  };
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / sorted.length;

  return {
    min: round(sorted[0]),
    p50: round(percentile(50)),
    p95: round(percentile(95)),
    p99: round(percentile(99)),
    max: round(sorted.at(-1)),
    mean: round(mean),
    standardDeviation: round(Math.sqrt(variance)),
  };
}

async function installBrowserProbe(page) {
  await page.evaluate(() => {
    const state = {
      nextId: 1,
      pending: [],
      samples: [],
    };

    window.__notesInputLatencyBenchmark = state;

    document.addEventListener(
      "keydown",
      (event) => {
        const target = event.target;
        if (
          !(target instanceof HTMLTextAreaElement) ||
          !target.matches("textarea.markdown-editor") ||
          event.key.length !== 1 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.repeat
        ) {
          return;
        }

        state.pending.push({
          id: state.nextId,
          key: event.key,
          keydownAt: performance.now(),
        });
        state.nextId += 1;
      },
      true,
    );

    document.addEventListener(
      "input",
      (event) => {
        const target = event.target;
        if (
          !(target instanceof HTMLTextAreaElement) ||
          !target.matches("textarea.markdown-editor")
        ) {
          return;
        }

        const pending = state.pending.shift();
        if (!pending) {
          return;
        }

        const inputAt = performance.now();
        requestAnimationFrame((paintAt) => {
          state.samples.push({
            id: pending.id,
            key: pending.key,
            keydownToInputMs: inputAt - pending.keydownAt,
            keydownToPaintMs: Math.max(0, paintAt - pending.keydownAt),
            renderedValueLength: target.value.length,
          });
        });
      },
      true,
    );
  });
}

async function resetBrowserProbe(page) {
  await page.evaluate(() => {
    const state = window.__notesInputLatencyBenchmark;
    state.pending.length = 0;
    state.samples.length = 0;
  });
}

async function waitForSamples(page, count) {
  await page.waitForFunction(
    (expectedCount) =>
      window.__notesInputLatencyBenchmark.samples.length >= expectedCount,
    count,
    { timeout: Math.max(10_000, count * 250) },
  );
}

async function runBenchmark(options) {
  const viewport = options.mobile
    ? { width: 390, height: 844 }
    : { width: 1_440, height: 900 };
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: "networkidle" });

    const editor = page.locator("textarea.markdown-editor").first();
    if (options.mobile && !(await editor.isVisible())) {
      const firstNote = page.locator(".note-list-select").first();
      await firstNote.waitFor({ state: "visible" });
      await firstNote.click();
    }
    await editor.waitFor({ state: "visible" });
    await editor.fill(makeSeedText(options.seedLength));
    await editor.focus();
    await editor.press("End");

    await installBrowserProbe(page);

    const warmupText = makeInputText(options.warmup);
    if (warmupText.length > 0) {
      await page.keyboard.type(warmupText, { delay: options.interval });
      await waitForSamples(page, warmupText.length);
    }

    await resetBrowserProbe(page);

    const inputText = makeInputText(options.characters);
    await page.keyboard.type(inputText, { delay: options.interval });
    await waitForSamples(page, inputText.length);

    const samples = await page.evaluate(
      () => window.__notesInputLatencyBenchmark.samples,
    );
    const editorValue = await editor.inputValue();

    if (samples.length !== inputText.length) {
      throw new Error(`预期 ${inputText.length} 个样本，实际得到 ${samples.length} 个`);
    }

    if (!editorValue.endsWith(inputText)) {
      throw new Error("benchmark 输入后正文内容不完整，结果无效");
    }

    const paint = summarize(samples.map((sample) => sample.keydownToPaintMs));
    const input = summarize(samples.map((sample) => sample.keydownToInputMs));
    const thresholdPassed = options.maxP95 === null || paint.p95 <= options.maxP95;

    return {
      benchmark: "notes-editor-input-latency",
      url: options.url,
      browser: `Chromium ${browser.version()}`,
      viewport,
      workload: {
        characters: options.characters,
        warmupCharacters: options.warmup,
        intervalMs: options.interval,
        initialNoteLength: options.seedLength,
      },
      metrics: {
        keydownToNextPaintMs: paint,
        keydownToInputEventMs: input,
      },
      threshold: options.maxP95 === null
        ? null
        : {
            maxP95Ms: options.maxP95,
            actualP95Ms: paint.p95,
            passed: thresholdPassed,
          },
    };
  } finally {
    await browser.close();
  }
}

function printHumanResult(result) {
  const paint = result.metrics.keydownToNextPaintMs;
  const input = result.metrics.keydownToInputEventMs;
  const mode = result.viewport.width <= 640 ? "移动端" : "桌面端";

  console.log("锤子便签正文输入延迟 benchmark");
  console.log(`页面：${result.url}`);
  console.log(`环境：${result.browser}，${mode} ${result.viewport.width} × ${result.viewport.height}`);
  console.log(
    `负载：初始正文 ${result.workload.initialNoteLength} 字符，预热 ${result.workload.warmupCharacters} 次，统计 ${result.workload.characters} 次，按键间隔 ${result.workload.intervalMs}ms`,
  );
  console.log("");
  console.log("keydown → 下一次绘制机会（主要指标）");
  console.log(
    `  p50 ${paint.p50}ms  p95 ${paint.p95}ms  p99 ${paint.p99}ms  max ${paint.max}ms  mean ${paint.mean}ms`,
  );
  console.log("keydown → input 事件");
  console.log(
    `  p50 ${input.p50}ms  p95 ${input.p95}ms  p99 ${input.p99}ms  max ${input.max}ms  mean ${input.mean}ms`,
  );

  if (result.threshold) {
    console.log("");
    console.log(
      `p95 阈值：${result.threshold.actualP95Ms}ms / ${result.threshold.maxP95Ms}ms（${result.threshold.passed ? "通过" : "失败"}）`,
    );
  }
}

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error("使用 --help 查看可用选项。");
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  let server = null;
  const origin = getOrigin(options.url);

  try {
    const isAvailable = await isPageAvailable(origin);
    if (!isAvailable) {
      if (!options.autoStart) {
        throw new Error(`页面不可访问：${origin}`);
      }

      server = startFrontend(origin);
      await waitForPage(origin, server);
    }

    const result = await runBenchmark(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanResult(result);
    }

    if (result.threshold && !result.threshold.passed) {
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  } finally {
    stopFrontend(server);
  }
}

await main();
