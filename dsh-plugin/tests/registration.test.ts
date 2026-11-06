// 运行时验证：在真实的 cordis + dsh-tools 运行时里加载插件，确认工具确实注册成功。
// 版本门槛（engines/peer）只保证能装上；defineTool、ctx.tools.register 或输出 schema
// 的形态一旦变化，只有真正挂载才能发现，所以这条独立于版本断言。
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Context } from "@deepseek-ai/cordis";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolsService from "@deepseek-ai/dsh-tools";
import * as notesPlugin from "../src/index.js";

/** host 面服务异步挂载，等 ctx.tools 真正可用。 */
async function waitForTools(ctx: Context): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (ctx.get("tools")) return;
    await delay(10);
  }
  throw new Error("dsh-tools 服务未在 3 秒内就绪");
}

test("插件可在当前 DSH 运行时注册 notes_export_conversation 工具", async () => {
  const ctx = new Context();

  ctx.plugin(SystemPrompt, {});
  ctx.plugin(ToolsService, {});
  await waitForTools(ctx);

  notesPlugin.apply(ctx, {});

  const definition = ctx.tools.get("notes_export_conversation");
  assert.ok(definition, "工具应已注册到 tools 服务");
  assert.equal(typeof definition.execute, "function");
  assert.equal(definition.timeoutMs, 60_000);

  const schema = ctx.tools
    .schemas()
    .find((candidate) => candidate.name === "notes_export_conversation");
  assert.ok(schema, "工具 schema 应可被模型看到");
  assert.ok(schema.description.length > 0);

  const parameters = schema.parameters as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  assert.deepEqual(parameters.required, ["markdown"], "只有 markdown 是必填参数");
  assert.deepEqual(Object.keys(parameters.properties ?? {}).sort(), [
    "folder",
    "markdown",
    "note_id",
    "pinned",
    "starred",
    "theme",
  ]);

  const rendered = definition.output.render({}, {
    action: "exported-image",
    note_id: null,
    title: "对话记录",
    url: null,
    file_path: "/tmp/notes.png",
    updated_at: null,
    server: "https://notes.fangyuanxiaozhan.com",
  });
  assert.equal(rendered[0]?.type, "text");
});