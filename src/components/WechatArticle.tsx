import {
  Children,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  detachUnindentedImagesFromLists,
  MARKDOWN_BLANK_LINE,
  preserveMarkdownBlankLines,
  splitSections,
} from "../lib/markdown.js";
import {
  getNoteCardThemeStyle,
  type NoteCardThemeColors,
  type NoteCardThemeStyle,
} from "../lib/note-card-theme-styles.js";
import type { NoteCardThemeId } from "../types/app.js";
import { remarkManualLineParagraphs } from "./MarkdownText.js";

interface WechatArticleProps {
  footerBrand: string;
  markdown: string;
  footerHammerUrl: string;
  footerVia: string;
  theme: NoteCardThemeId;
}

// 微信使用紧凑正文尺寸；1.4× 只负责便签框体与留白，不再放大字体。
const LAYOUT_SCALE = 1.4;

function scaledPx(value: number): string {
  return `${Number((value * LAYOUT_SCALE).toFixed(4))}px`;
}

function scaledRem(value: number): string {
  return scaledPx(value * 16);
}

const bodyFontSize = "15px";
const quoteIndent = "18px";

interface WechatRenderContext {
  baseHeadingStyle: CSSProperties;
  bodyLineHeight: number;
  bodyParagraphStyle: CSSProperties;
  colors: NoteCardThemeColors;
  letterSpacing: string;
  themeStyle: NoteCardThemeStyle;
}

function createWechatRenderContext(
  theme: NoteCardThemeId,
): WechatRenderContext {
  const themeStyle = getNoteCardThemeStyle(theme);
  const { colors } = themeStyle;
  const bodyLineHeight = themeStyle.layout === "bear" ? 1.755 : 1.75;
  const letterSpacing =
    themeStyle.layout === "bear"
      ? "0"
      : themeStyle.layout === "apple"
        ? "0.01em"
        : "0.03em";
  const headingWeight = themeStyle.layout === "bear" ? 400 : 600;

  return {
    colors,
    themeStyle,
    bodyLineHeight,
    letterSpacing,
    baseHeadingStyle: {
      color: colors.heading,
      fontFamily: themeStyle.fontFamily,
      fontWeight: headingWeight,
      letterSpacing,
      lineHeight: themeStyle.layout === "bear" ? 1.521 : 1.32,
    },
    bodyParagraphStyle: {
      margin: "0",
      color: colors.text,
      fontFamily: themeStyle.fontFamily,
      fontSize: bodyFontSize,
      fontWeight: 400,
      lineHeight: bodyLineHeight,
      letterSpacing,
      textAlign: "left",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
    },
  };
}

function renderBlockquoteChildren(
  children: ReactNode,
  context: WechatRenderContext,
): ReactNode {
  const { colors, themeStyle } = context;
  const isBear = themeStyle.layout === "bear";
  let hasQuoteMark = false;

  return Children.map(children, (child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        style?: CSSProperties;
      }>(child)
    ) {
      return child;
    }

    const isFirstTextBlock = !hasQuoteMark;
    hasQuoteMark = true;

    return cloneElement(
      child,
      {
        style: {
          ...child.props.style,
          margin: "0",
          color: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
          ...(isFirstTextBlock
            ? {
                paddingLeft: quoteIndent,
                textIndent: `-${quoteIndent}`,
              }
            : {}),
        },
      },
      isFirstTextBlock ? (
        <>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: quoteIndent,
              color: colors.quoteMark,
              fontFamily: isBear
                ? themeStyle.fontFamily
                : 'Georgia,"Times New Roman",serif',
              fontSize: isBear ? "18px" : "26px",
              fontWeight: 400,
              lineHeight: isBear ? 1 : 0.82,
              textIndent: "0",
              verticalAlign: isBear ? "-0.04em" : "-0.12em",
            }}
          >
            {isBear ? "▎" : "“"}
          </span>
          {child.props.children}
        </>
      ) : (
        child.props.children
      ),
    );
  });
}

function createMarkdownComponents(
  context: WechatRenderContext,
): Components {
  const {
    baseHeadingStyle,
    bodyLineHeight,
    bodyParagraphStyle,
    colors,
    themeStyle,
  } = context;
  const isBear = themeStyle.layout === "bear";

  return {
  h1: ({ children }) => (
    <h1
      style={{
        ...baseHeadingStyle,
        margin: "0",
        fontSize: "22px",
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      style={{
        ...baseHeadingStyle,
        margin: "0",
        fontSize: "17px",
      }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      style={{
        ...baseHeadingStyle,
        margin: "0",
        fontSize: "16px",
      }}
    >
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4
      style={{
        ...baseHeadingStyle,
        margin: "0",
        fontSize: "15px",
      }}
    >
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 style={{ ...baseHeadingStyle, margin: "0", fontSize: "14px" }}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 style={{ ...baseHeadingStyle, margin: "0", fontSize: "13px" }}>
      {children}
    </h6>
  ),
  p: ({ children, style }) => {
    const isBlankLine = Array.isArray(children)
      ? children.length === 1 && children[0] === MARKDOWN_BLANK_LINE
      : children === MARKDOWN_BLANK_LINE;

    return (
      <p
        style={{
          ...(isBlankLine
            ? {
                ...bodyParagraphStyle,
                display: "block",
                height: "0.704em",
                minHeight: "0",
                color: "transparent",
                lineHeight: "0",
                overflow: "hidden",
              }
            : bodyParagraphStyle),
          ...style,
        }}
      >
        {children}
      </p>
    );
  },
  strong: ({ children }) => (
    <strong
      style={{
        display: "inline",
        color: "inherit",
        fontWeight: isBear ? 700 : 600,
        whiteSpace: "normal",
      }}
    >
      {children}
    </strong>
  ),
  em: ({ children }) => <em style={{ color: "inherit" }}>{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      style={{
        color: colors.accent,
        textDecoration: "none",
      }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: `${scaledPx(8)} 0`,
        padding: "0",
        border: "0",
        backgroundColor: "transparent",
        color: colors.quote,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: 1.64,
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {renderBlockquoteChildren(children, context)}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul
      style={{
        boxSizing: "border-box",
        width: "100% !important",
        maxWidth: "100% !important",
        margin: `${scaledPx(8)} 0 0`,
        paddingLeft: "1.3em !important",
        listStylePosition: "outside",
        color: colors.text,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: bodyLineHeight,
      }}
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol
      start={start}
      style={{
        boxSizing: "border-box",
        width: "100% !important",
        maxWidth: "100% !important",
        margin: `${scaledPx(8)} 0 0`,
        paddingLeft: "1.3em !important",
        listStylePosition: "outside",
        color: colors.text,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: bodyLineHeight,
      }}
    >
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li
      style={{
        boxSizing: "border-box",
        minWidth: "0",
        maxWidth: "100% !important",
        margin: "0",
        paddingLeft: "0",
        color: colors.text,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: bodyLineHeight,
      }}
    >
      {children}
    </li>
  ),
  code: ({ children, className }) => (
    <code
      className={className}
      style={{
        padding: className ? "0" : "0.08em 0.32em",
        borderRadius: "0",
        background: className ? "transparent" : colors.code,
        color: className ? colors.text : colors.codeText,
        fontFamily:
          '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: className ? "13px" : "0.9em",
        fontWeight: 400,
      }}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        margin: `${scaledPx(10)} 0 0`,
        padding: `${scaledPx(9)} ${scaledPx(11)}`,
        overflow: "hidden",
        border: "0",
        borderRadius: "0",
        background: colors.pre,
        color: colors.preText,
        fontSize: "13px",
        fontWeight: 400,
        lineHeight: 1.62,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {children}
    </pre>
  ),
  img: ({ src, alt }) => (
    <span
      data-smartisan-image="true"
      data-smartisan-image-frame="android"
      style={{
        display: "block",
        boxSizing: "border-box",
        minWidth: "0",
        width: "100% !important",
        maxWidth: "100% !important",
        margin: `${scaledPx(12)} auto ${scaledPx(2)}`,
        padding: isBear ? "0" : scaledPx(3),
        border: isBear ? "0" : `1px solid ${colors.imageFrame}`,
        borderRadius: "0",
        backgroundColor: colors.imageMat,
        boxShadow: isBear
          ? "none"
          : `0 ${scaledPx(1)} ${scaledPx(3)} ${colors.imageShadow}`,
        clear: "both",
        overflow: "hidden !important",
      }}
    >
      <img
        src={src}
        alt={alt ?? ""}
        width="100%"
        style={{
          display: "block",
          boxSizing: "border-box",
          minWidth: "0",
          width: "100% !important",
          maxWidth: "100% !important",
          height: "auto !important",
          margin: "0",
          border: "0",
          objectFit: "contain",
          verticalAlign: "top",
        }}
      />
    </span>
  ),
  table: ({ children }) => (
    <section style={{ margin: `${scaledPx(8)} 0 0`, overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          color: colors.text,
          fontSize: "14px",
          fontWeight: 400,
          lineHeight: 1.52,
        }}
      >
        {children}
      </table>
    </section>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: `${scaledRem(0.35)} ${scaledRem(0.45)}`,
        border: `1px solid ${colors.border}`,
        background: colors.tableHead,
        color: colors.heading,
        fontWeight: 600,
        textAlign: "left",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        padding: `${scaledRem(0.35)} ${scaledRem(0.45)}`,
        border: `1px solid ${colors.border}`,
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  ),
  hr: () => (
    <hr
      style={{
        margin: `${scaledPx(12)} 0`,
        width: "100%",
        border: "0",
        borderTop: `1px solid ${colors.border}`,
      }}
    />
  ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled
      style={{ marginRight: "6px", accentColor: colors.accent }}
    />
  ),
  };
}

function SectionHeading({
  children,
  components,
  context,
}: {
  children: string;
  components: Components;
  context: WechatRenderContext;
}) {
  const { baseHeadingStyle, colors, themeStyle } = context;
  const titleComponents: Components = {
    ...components,
    p: ({ children: titleChildren }) => (
      <header
        style={{
          margin: `0 0 ${scaledPx(6)}`,
          padding: "0",
          border: "0",
        }}
      >
        <h2
          style={{
            ...baseHeadingStyle,
            margin: "0",
            color: colors.heading,
            fontSize: "17px",
            lineHeight: themeStyle.layout === "bear" ? 1.521 : 1.4,
            textAlign: "start",
          }}
        >
          {titleChildren as ReactNode}
        </h2>
      </header>
    ),
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={titleComponents}>
      {children}
    </ReactMarkdown>
  );
}

function CenteredBodyLine({
  children,
  components,
  context,
}: {
  children: string;
  components: Components;
  context: WechatRenderContext;
}) {
  const { bodyParagraphStyle } = context;
  const centeredComponents: Components = {
    ...components,
    p: ({ children: lineChildren }) => (
      <p style={{ ...bodyParagraphStyle, textAlign: "center" }}>
        {lineChildren}
      </p>
    ),
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={centeredComponents}>
      {children}
    </ReactMarkdown>
  );
}

function removeTrailingEmptyListItems(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  while (
    lines.length > 0 &&
    /^\s*(?:[-+*]|\d+[.)])\s*$/.test(lines[lines.length - 1])
  ) {
    lines.pop();
  }

  return lines.join("\n").trimEnd();
}

function protectWechatInlineBoundaries(markdown: string): string {
  let inCodeFence = false;
  const wordJoiner = "\u2060";

  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      if (inCodeFence) {
        return line;
      }

      return line
        .split(/(`+[^`]*`+)/g)
        .map((segment) => {
          if (/^`/.test(segment)) {
            return segment;
          }

          return segment
            .replace(
              /(\*\*[^*\n]+)(\*\*)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            )
            .replace(
              /(__[^_\n]+)(__)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            )
            .replace(
              /(\*[^*\n]+)(\*)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            )
            .replace(
              /(_[^_\n]+)(_)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            );
        })
        .join("");
    })
    .join("\n");
}

const cornerPositions = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

function FrameCornerCell({
  colors,
  position,
}: {
  colors: NoteCardThemeColors;
  position: (typeof cornerPositions)[number];
}) {
  return (
    <td
      data-smartisan-corner={position}
      aria-hidden="true"
      width="6"
      height="6"
      style={{
        boxSizing: "border-box",
        width: "6px",
        height: "6px",
        padding: "0",
        overflow: "hidden",
        border: `1px solid ${colors.frame}`,
        backgroundColor: colors.paper,
        color: "transparent",
        fontSize: "0",
        lineHeight: "0",
      }}
    >
      {"\u00a0"}
    </td>
  );
}

export function WechatArticle({
  footerBrand,
  markdown,
  footerHammerUrl,
  footerVia,
  theme,
}: WechatArticleProps) {
  const context = createWechatRenderContext(theme);
  const {
    bodyLineHeight,
    colors,
    letterSpacing,
    themeStyle,
  } = context;
  const components = createMarkdownComponents(context);
  const sections = splitSections(markdown);
  const isSmartisan = themeStyle.layout === "smartisan";
  const isApple = themeStyle.layout === "apple";

  return (
    <section
      data-tool="开源版锤子便签"
      data-note-card-theme={theme}
      data-smartisan-theme={theme}
      style={{
        boxSizing: "border-box",
        margin: "0 auto",
        padding: "0",
        width: "100%",
        maxWidth: "100%",
        backgroundColor: "transparent",
        color: colors.text,
        fontFamily: themeStyle.fontFamily,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: bodyLineHeight,
        letterSpacing,
        wordBreak: "break-word",
      }}
    >
      <section
        data-smartisan-paper="true"
        style={{
          boxSizing: "border-box",
          margin: "0 auto",
          padding:
            themeStyle.layout === "bear"
              ? `${scaledPx(20)} ${scaledPx(18)} 0`
              : `${scaledPx(15)} ${scaledPx(6.6667)} 0`,
          paddingBottom: "12%",
          width: "100%",
          maxWidth: scaledPx(330),
          border: "0",
          backgroundColor: colors.paper,
          boxShadow: themeStyle.wechatPaperShadow,
        }}
      >
        {isApple ? (
          <section
            data-note-apple-toolbar="true"
            style={{
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              margin: `0 ${scaledPx(6)} ${scaledPx(14)}`,
              color: colors.accent,
              fontFamily: themeStyle.fontFamily,
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: 1.2,
            }}
          >
            <span>‹ 备忘录</span>
            <span style={{ letterSpacing: "0.55em" }}>⇧ ✎</span>
          </section>
        ) : null}
        <table
          data-smartisan-frame="outer"
          role="presentation"
          cellPadding="0"
          cellSpacing="0"
          style={{
            boxSizing: "border-box",
            width: "100%",
            maxWidth: "100%",
            borderCollapse: "collapse",
            borderSpacing: "0",
            border: "0",
            tableLayout: "fixed",
            backgroundColor: colors.paper,
          }}
        >
          <colgroup>
            <col width="6" style={{ width: "6px" }} />
            <col />
            <col width="6" style={{ width: "6px" }} />
          </colgroup>
          <tbody>
            <tr>
              <FrameCornerCell colors={colors} position="top-left" />
              <td
                aria-hidden="true"
                height="6"
                style={{
                  height: "6px",
                  padding: "0",
                  border: "0",
                  borderBottom: `1px solid ${colors.frame}`,
                  fontSize: "0",
                  lineHeight: "0",
                }}
              >
                {"\u00a0"}
              </td>
              <FrameCornerCell colors={colors} position="top-right" />
            </tr>
            <tr>
              <td
                aria-hidden="true"
                width="6"
                style={{
                  boxSizing: "border-box",
                  width: "6px",
                  padding: "0",
                  border: "0",
                  borderRight: `1px solid ${colors.frame}`,
                  fontSize: "0",
                  lineHeight: "0",
                }}
              >
                {"\u00a0"}
              </td>
              <td style={{ padding: isSmartisan ? scaledPx(2) : "0", border: "0" }}>
                <section
                  data-smartisan-frame="inner"
                  style={{
                    boxSizing: "border-box",
                    padding:
                      themeStyle.layout === "bear"
                        ? `0 0 ${scaledPx(14)}`
                        : isApple
                          ? `${scaledPx(10)} ${scaledPx(16)} ${scaledPx(14)}`
                          : `${scaledPx(31.5)} ${scaledPx(19.8333)} ${scaledPx(14)}`,
                    border: isSmartisan ? `1px solid ${colors.frame}` : "0",
                    backgroundColor: colors.paper,
                    color: colors.text,
                    fontSize: bodyFontSize,
                    fontWeight: 400,
                    lineHeight: bodyLineHeight,
                    letterSpacing,
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {sections.length ? (
                    sections.map((section, index) => (
                      <section
                        key={`${section.heading}-${index}`}
                        style={{
                          margin:
                            index === 0
                              ? "0"
                              : section.heading
                                ? `${scaledPx(18)} 0 0`
                                : "0",
                        }}
                      >
                        {section.heading ? (
                          section.headingAlignment === "center" ? (
                            <CenteredBodyLine
                              components={components}
                              context={context}
                            >
                              {section.heading}
                            </CenteredBodyLine>
                          ) : (
                            <SectionHeading
                              components={components}
                              context={context}
                            >
                              {section.heading}
                            </SectionHeading>
                          )
                        ) : null}
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkManualLineParagraphs]}
                          components={components}
                        >
                          {preserveMarkdownBlankLines(
                            protectWechatInlineBoundaries(
                              detachUnindentedImagesFromLists(
                                removeTrailingEmptyListItems(section.content),
                              ),
                            ),
                          )}
                        </ReactMarkdown>
                      </section>
                    ))
                  ) : (
                    <p
                      style={{
                        margin: `${scaledPx(18)} 0`,
                        color: colors.quote,
                        fontSize: bodyFontSize,
                        fontWeight: 400,
                        lineHeight: bodyLineHeight,
                        textAlign: "center",
                      }}
                    >
                      不要因为走得太远，就忘了当初为什么出发。
                    </p>
                  )}
                </section>
              </td>
              <td
                aria-hidden="true"
                width="6"
                style={{
                  boxSizing: "border-box",
                  width: "6px",
                  padding: "0",
                  border: "0",
                  borderLeft: `1px solid ${colors.frame}`,
                  fontSize: "0",
                  lineHeight: "0",
                }}
              >
                {"\u00a0"}
              </td>
            </tr>
            <tr>
              <FrameCornerCell colors={colors} position="bottom-left" />
              <td
                aria-hidden="true"
                height="6"
                style={{
                  height: "6px",
                  padding: "0",
                  border: "0",
                  borderTop: `1px solid ${colors.frame}`,
                  fontSize: "0",
                  lineHeight: "0",
                }}
              >
                {"\u00a0"}
              </td>
              <FrameCornerCell colors={colors} position="bottom-right" />
            </tr>
          </tbody>
        </table>

        <section
          data-smartisan-footer="true"
          style={{
            boxSizing: "border-box",
            margin: `${scaledPx(30)} ${scaledPx(10)} 0`,
            padding: "0",
            border: "0",
            color: colors.footer,
            fontSize: "0",
            fontWeight: 400,
            lineHeight: scaledRem(0.64),
            textAlign: "left",
            whiteSpace: "nowrap",
          }}
        >
          <img
            data-smartisan-hammer="true"
            src={footerHammerUrl}
            alt="锤子"
            width="20"
            height="20"
            style={{
              display: "inline-block",
              width: scaledRem(0.64),
              height: scaledRem(0.64),
              margin: `0 ${scaledPx(6)} 0 0`,
              border: "0",
              borderRadius: "50%",
              backgroundColor: "transparent",
              objectFit: "contain",
              filter: themeStyle.footerLogoFilter,
              opacity: themeStyle.footerLogoOpacity,
              verticalAlign: "middle",
            }}
          />
          <span
            style={{
              display: "inline-block",
              margin: "0",
              color: colors.footer,
              fontSize: scaledRem(0.5),
              fontWeight: 400,
              lineHeight: scaledRem(0.64),
              verticalAlign: "middle",
              whiteSpace: "nowrap",
            }}
          >
            <strong style={{ fontWeight: 400 }}>{footerBrand}</strong>
            <span
              style={{
                marginLeft: scaledPx(5),
                color: colors.footerVia,
                fontSize: scaledRem(0.42),
                fontWeight: 400,
              }}
            >
              {footerVia}
            </span>
          </span>
        </section>
      </section>
    </section>
  );
}
