import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "notes-export";
export declare const inject: string[];
/** 插件配置：均可选；未提供时回退到进程环境变量 NOTES_API_*。 */
export interface Config {
    baseUrl?: string;
    token?: string;
    username?: string;
    password?: string;
    demoServer?: string;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
