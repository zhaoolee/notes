// DeepSeek Harness 工具插件：把用户对话导出为锤子便签。
// Host 面插件：通过 cordis.patch.yml 的 notes-export 行挂载，向 tools 注册
// notes_export_conversation 工具。分级模式：
//   1. 用户配置了自己的便签服务（NOTES_API_BASE_URL + 凭据）→ 把对话作为便签
//      写入当前账号的云端工作区（新建或按 note_id 更新）。
//   2. 未配置任何用户信息 → 回退到默认演示服务器 notes.fangyuanxiaozhan.com 的
//      匿名导出接口，把对话渲染成锤子便签长图 PNG 返回（开箱即用尝鲜，不写入
//      便签列表）。
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { extractNoteTitle, NotesApiError, NotesClient, readConfiguredBaseUrl, resolveDemoServer, resolveServiceConfig, savePngToTempFile, } from "./notes-client.js";
export const name = "notes-export";
export const inject = ["tools"];
// schemastery 的 z.object 默认所有键可选，与上面 Config 的可选语义一致。
export const Config = z.object({
    baseUrl: z.string(),
    token: z.string(),
    username: z.string(),
    password: z.string(),
    demoServer: z.string(),
});
const EXPORT_THEMES = [
    "default",
    "smartisan-dark",
    "apple-notes",
    "apple-notes-light",
    "bear",
    "telegraph",
];
const TOOL_DESCRIPTION = [
    "当用户要求把当前对话、聊天记录或一段内容导出为锤子便签时使用。",
    "把对话内容整理成 Markdown 传给 markdown（建议第一行用 # 写标题，便签标题取自正文第一行）。",
    "分级模式：配置了 NOTES_API_BASE_URL（+ NOTES_API_TOKEN 或用户名密码）时，把对话作为便签写入当前账号云端工作区（新建或按 note_id 更新），返回便签链接；",
    "未配置任何用户信息时，回退到默认演示服务器 notes.fangyuanxiaozhan.com 的匿名导出接口，把对话渲染成锤子便签长图 PNG 返回本地文件路径（尝鲜用，不能写入便签列表）。",
    "note_id/folder/starred/pinned 仅在写入模式生效；theme 仅在图片模式生效。",
].join(" ");
export function apply(ctx, config) {
    ctx.tools.register(defineTool({
        name: "notes_export_conversation",
        description: TOOL_DESCRIPTION,
        parameters: {
            markdown: {
                type: "string",
                required: true,
                description: "对话内容整理后的 Markdown 全文（建议首行 # 标题）。",
            },
            note_id: {
                type: "string",
                description: "（写入模式）更新已有便签时传它的 ID（来自上一次导出的 note_id）。",
            },
            folder: {
                type: "string",
                description: "（写入模式）文件夹 ID 或精确名称；none/null/未分类 表示清除分类。省略时新建便签归为未分类。",
            },
            starred: {
                type: "boolean",
                description: "（写入模式）是否加星。",
            },
            pinned: {
                type: "boolean",
                description: "（写入模式）是否置顶。",
            },
            theme: {
                type: "string",
                enum: [...EXPORT_THEMES],
                description: "（图片模式）便签主题，默认 default。",
            },
        },
        output: {
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    action: {
                        type: "string",
                        required: true,
                        enum: ["created", "updated", "exported-image"],
                    },
                    note_id: {
                        required: true,
                        oneOf: [{ type: "string" }, { type: "null" }],
                    },
                    title: { type: "string", required: true },
                    url: {
                        required: true,
                        oneOf: [{ type: "string" }, { type: "null" }],
                    },
                    file_path: {
                        required: true,
                        oneOf: [{ type: "string" }, { type: "null" }],
                    },
                    updated_at: {
                        required: true,
                        oneOf: [{ type: "integer" }, { type: "null" }],
                    },
                    server: { type: "string", required: true },
                },
            },
            render: (_args, value) => [
                {
                    type: "text",
                    text: value.action === "exported-image"
                        ? `对话已渲染为便签图片（默认演示服务器 ${value.server} 匿名导出）：${value.title}\n` +
                            `本地文件：${value.file_path}\n` +
                            (value.url ? `线上链接：${value.url}\n` : "") +
                            `提示：未配置便签服务时无法写入便签列表；配置 NOTES_API_BASE_URL 后可正常保存便签。`
                        : `对话已导出为便签（${value.action === "created" ? "新建" : "更新"}，服务 ${value.server}）：` +
                            `${value.title}（${value.note_id}）\n` +
                            `便签链接：${value.url}`,
                },
            ],
        },
        timeoutMs: 60_000,
        execute: async (args, exec) => {
            try {
                const configuredBaseUrl = readConfiguredBaseUrl(config);
                if (!configuredBaseUrl) {
                    // 分级模式 2：未配置 → 默认演示服务器匿名导出图片。
                    const demoServer = resolveDemoServer(config);
                    const client = new NotesClient({ baseUrl: demoServer });
                    const title = extractNoteTitle(args.markdown);
                    const image = await client.exportImage({
                        markdown: args.markdown,
                        theme: args.theme,
                        filename: `${toSafeFilename(title)}.png`,
                    }, exec.signal);
                    const filePath = await savePngToTempFile(image.png, title);
                    return {
                        action: "exported-image",
                        note_id: null,
                        title,
                        url: image.url,
                        file_path: filePath,
                        updated_at: null,
                        server: demoServer,
                    };
                }
                // 分级模式 1：已配置 → 写入便签列表。
                const serviceConfig = resolveServiceConfig(config);
                const client = new NotesClient(serviceConfig);
                const result = await client.exportNote({
                    markdown: args.markdown,
                    noteId: args.note_id,
                    folder: args.folder,
                    starred: args.starred,
                    pinned: args.pinned,
                }, exec.signal);
                return {
                    action: result.action,
                    note_id: result.noteId,
                    title: result.title,
                    url: result.url,
                    file_path: null,
                    updated_at: result.updatedAt,
                    server: result.server,
                };
            }
            catch (error) {
                if (error instanceof NotesApiError) {
                    throw new Error(`导出便签失败：${error.message}`);
                }
                throw error;
            }
        },
    }));
}
/** 把标题转换为安全文件名片段（不含扩展名）。 */
function toSafeFilename(title) {
    const safe = title.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/[`*_~#]/g, "").trim();
    return safe || "conversation";
}
