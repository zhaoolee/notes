import type { ThemeId, ThemeOption } from "../types/app.js";

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "default",
    label: "默认主题",
    description: "暖白纸感",
  },
  {
    id: "smartisan-dark",
    label: "锤子暗黑",
    description: "深夜便签",
  },
];

export const DEFAULT_THEME_ID: ThemeId = THEME_OPTIONS[0].id;

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEME_OPTIONS.some((option) => option.id === value);
}
