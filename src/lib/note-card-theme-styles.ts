import type { NoteCardThemeId } from "../types/app.js";

export type NoteCardThemeLayout =
  | "smartisan"
  | "apple"
  | "bear"
  | "bazhahei"
  | "telegraph";

export interface NoteCardThemeColors {
  accent: string;
  border: string;
  code: string;
  codeText: string;
  footer: string;
  footerVia: string;
  frame: string;
  heading: string;
  imageFrame: string;
  imageMat: string;
  imageShadow: string;
  paper: string;
  pre: string;
  preText: string;
  quote: string;
  quoteMark: string;
  tableHead: string;
  text: string;
}

export interface NoteCardThemeStyle {
  colors: NoteCardThemeColors;
  fontFamily: string;
  headingFontFamily: string;
  footerLogoFilter: string;
  footerLogoOpacity: number;
  id: NoteCardThemeId;
  layout: NoteCardThemeLayout;
  paperShadow: string;
  wechatPaperShadow: string;
}

const smartisanFont =
  '"OPPOSans","Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Arial,sans-serif';
const appleFont =
  '-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro SC","PingFang SC","Helvetica Neue",Arial,sans-serif';
const bearFont =
  '"Avenir Next","AvenirNext-Regular",Avenir,-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif';
const telegraphSerifFont =
  'Georgia,Cambria,"Times New Roman","Noto Serif SC","Songti SC",serif';
const telegraphSansFont =
  '"Lucida Grande",-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif';

export const NOTE_CARD_THEME_STYLES: Record<
  NoteCardThemeId,
  NoteCardThemeStyle
> = {
  default: {
    id: "default",
    layout: "smartisan",
    fontFamily: smartisanFont,
    headingFontFamily: smartisanFont,
    paperShadow: "0 24px 42px rgba(89,65,34,0.12)",
    wechatPaperShadow: "0 16.8px 29.4px rgba(89,65,34,0.12)",
    footerLogoFilter: "none",
    footerLogoOpacity: 1,
    colors: {
      accent: "#ac9070",
      border: "rgba(220,209,191,0.88)",
      code: "rgba(125,78,32,0.08)",
      codeText: "#8a6548",
      footer: "#d7cec1",
      footerVia: "#ded6cb",
      frame: "#e8e4dc",
      heading: "rgba(70,53,38,0.96)",
      imageFrame: "#ebe8e3",
      imageMat: "#ffffff",
      imageShadow: "rgba(88,70,52,0.07)",
      paper: "#fffcf7",
      pre: "rgba(243,236,225,0.9)",
      preText: "rgba(97,79,61,0.94)",
      quote: "#c0b5a7",
      quoteMark: "#ded4c8",
      tableHead: "rgba(243,236,225,0.65)",
      text: "#665749",
    },
  },
  "smartisan-dark": {
    id: "smartisan-dark",
    layout: "smartisan",
    fontFamily: smartisanFont,
    headingFontFamily: smartisanFont,
    paperShadow: "0 32px 72px rgba(0,0,0,0.42)",
    wechatPaperShadow: "0 22.4px 50.4px rgba(0,0,0,0.42)",
    footerLogoFilter: "grayscale(1) brightness(0.56) contrast(2.4)",
    footerLogoOpacity: 0.72,
    colors: {
      accent: "#d5ab36",
      border: "#343134",
      code: "#242224",
      codeText: "#c5c3c5",
      footer: "#777477",
      footerVia: "#656265",
      frame: "#343134",
      heading: "#dedcde",
      imageFrame: "#3b383b",
      imageMat: "#242224",
      imageShadow: "rgba(0,0,0,0.24)",
      paper: "#1c1a1c",
      pre: "#242224",
      preText: "#c5c3c5",
      quote: "#9f9c9f",
      quoteMark: "#5c585c",
      tableHead: "#242224",
      text: "#cecece",
    },
  },
  "apple-notes": {
    id: "apple-notes",
    layout: "apple",
    fontFamily: appleFont,
    headingFontFamily: appleFont,
    paperShadow: "0 28px 64px rgba(0,0,0,0.34)",
    wechatPaperShadow: "0 19.6px 44.8px rgba(0,0,0,0.34)",
    footerLogoFilter: "grayscale(1) brightness(0.7) contrast(1.3)",
    footerLogoOpacity: 0.72,
    colors: {
      accent: "#ebb800",
      border: "#3a3a3c",
      code: "#2c2c2e",
      codeText: "#dedede",
      footer: "#8e8e93",
      footerVia: "#6e6e73",
      frame: "transparent",
      heading: "#e8e8e8",
      imageFrame: "#3a3a3c",
      imageMat: "#242426",
      imageShadow: "rgba(0,0,0,0.3)",
      paper: "#181818",
      pre: "#242426",
      preText: "#dedede",
      quote: "#a8a8ad",
      quoteMark: "#ebb800",
      tableHead: "#2c2c2e",
      text: "#dcdcdc",
    },
  },
  "apple-notes-light": {
    id: "apple-notes-light",
    layout: "apple",
    fontFamily: appleFont,
    headingFontFamily: appleFont,
    paperShadow: "0 28px 64px rgba(64,52,28,0.16)",
    wechatPaperShadow: "0 19.6px 44.8px rgba(64,52,28,0.16)",
    footerLogoFilter: "none",
    footerLogoOpacity: 1,
    colors: {
      accent: "#ebb800",
      border: "#d1d1d6",
      code: "#f2f2f7",
      codeText: "#2c2c2e",
      footer: "#8e8e93",
      footerVia: "#aeaeb2",
      frame: "transparent",
      heading: "#1c1c1e",
      imageFrame: "#d1d1d6",
      imageMat: "#f2f2f7",
      imageShadow: "rgba(60,60,67,0.12)",
      paper: "#ffffff",
      pre: "#f2f2f7",
      preText: "#2c2c2e",
      quote: "#636366",
      quoteMark: "#ebb800",
      tableHead: "#f2f2f7",
      text: "#2c2c2e",
    },
  },
  bear: {
    id: "bear",
    layout: "bear",
    fontFamily: bearFont,
    headingFontFamily: bearFont,
    paperShadow: "0 24px 54px rgba(68,68,68,0.12)",
    wechatPaperShadow: "0 16.8px 37.8px rgba(68,68,68,0.12)",
    footerLogoFilter: "grayscale(1)",
    footerLogoOpacity: 0.58,
    colors: {
      accent: "#dd4c4f",
      border: "#d9d9d9",
      code: "#f3f5f7",
      codeText: "#444444",
      footer: "#888888",
      footerVia: "#b0b0b0",
      frame: "transparent",
      heading: "#444444",
      imageFrame: "transparent",
      imageMat: "transparent",
      imageShadow: "transparent",
      paper: "#ffffff",
      pre: "#f3f5f7",
      preText: "#444444",
      quote: "#444444",
      quoteMark: "#dd4c4f",
      tableHead: "#f3f5f7",
      text: "#444444",
    },
  },
  bazhahei: {
    id: "bazhahei",
    layout: "bazhahei",
    fontFamily: smartisanFont,
    headingFontFamily: smartisanFont,
    paperShadow: "0 24px 54px rgba(61,54,43,0.14)",
    wechatPaperShadow: "0 16.8px 37.8px rgba(61,54,43,0.14)",
    footerLogoFilter: "grayscale(1)",
    footerLogoOpacity: 0.56,
    colors: {
      accent: "#d4734b",
      border: "#e6dfd8",
      code: "#efe9de",
      codeText: "#3d3d3a",
      footer: "#8e8b82",
      footerVia: "#aaa69d",
      frame: "transparent",
      heading: "#141413",
      imageFrame: "#e6dfd8",
      imageMat: "#ffffff",
      imageShadow: "rgba(61,54,43,0.1)",
      paper: "#faf9f5",
      pre: "#efe9de",
      preText: "#3d3d3a",
      quote: "#6c6a64",
      quoteMark: "#d4734b",
      tableHead: "#efe9de",
      text: "#3d3d3a",
    },
  },
  telegraph: {
    id: "telegraph",
    layout: "telegraph",
    fontFamily: telegraphSerifFont,
    headingFontFamily: telegraphSansFont,
    paperShadow: "0 18px 48px rgba(0,0,0,0.1)",
    wechatPaperShadow: "0 12.6px 33.6px rgba(0,0,0,0.1)",
    footerLogoFilter: "grayscale(1)",
    footerLogoOpacity: 0.5,
    colors: {
      accent: "rgba(0,0,0,0.8)",
      border: "#c9cdd1",
      code: "#f5f8fc",
      codeText: "rgba(0,0,0,0.8)",
      footer: "#79828b",
      footerVia: "#a0a7ae",
      frame: "transparent",
      heading: "rgba(0,0,0,0.8)",
      imageFrame: "transparent",
      imageMat: "transparent",
      imageShadow: "transparent",
      paper: "#ffffff",
      pre: "#f5f8fc",
      preText: "rgba(0,0,0,0.8)",
      quote: "rgba(0,0,0,0.8)",
      quoteMark: "#000000",
      tableHead: "#f5f8fc",
      text: "rgba(0,0,0,0.8)",
    },
  },
};

export function getNoteCardThemeStyle(
  theme: NoteCardThemeId,
): NoteCardThemeStyle {
  return NOTE_CARD_THEME_STYLES[theme];
}

export function buildNoteCardThemeCssVariables(
  theme: NoteCardThemeId,
): string {
  const style = getNoteCardThemeStyle(theme);
  const { colors } = style;

  return [
    `--paper: ${colors.paper}`,
    `--sheet-surface: ${colors.paper}`,
    `--sheet-shadow: ${style.paperShadow}`,
    `--note-frame: ${colors.frame}`,
    `--note-image-frame: ${colors.imageFrame}`,
    `--note-image-mat: ${colors.imageMat}`,
    `--note-image-shadow: ${colors.imageShadow}`,
    `--note-heading: ${colors.heading}`,
    `--note-copy: ${colors.text}`,
    `--note-link: ${colors.accent}`,
    `--note-code-bg: ${colors.code}`,
    `--note-pre-bg: ${colors.pre}`,
    `--note-pre-text: ${colors.preText}`,
    `--note-quote: ${colors.quote}`,
    `--note-quote-mark: ${colors.quoteMark}`,
    `--note-table-border: ${colors.border}`,
    `--note-table-head-bg: ${colors.tableHead}`,
    `--note-hr: ${colors.border}`,
    `--footer-copy: ${colors.footer}`,
    `--footer-via: ${colors.footerVia}`,
    `--footer-icon: ${colors.footer}`,
    `--default-footer-logo-filter: ${style.footerLogoFilter}`,
    `--default-footer-logo-opacity: ${style.footerLogoOpacity}`,
    `--note-font: ${style.fontFamily}`,
    `--note-heading-font: ${style.headingFontFamily}`,
  ].join(";\n        ") + ";";
}
