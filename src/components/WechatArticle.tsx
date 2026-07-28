import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  detachUnindentedImagesFromLists,
  splitSections,
} from "../lib/markdown.js";

interface WechatArticleProps {
  markdown: string;
  footerHammerUrl: string;
}

const colors = {
  accent: "#ac9070",
  border: "rgba(220,209,191,0.88)",
  code: "rgba(125,78,32,0.08)",
  footer: "#d7cec1",
  frame: "rgba(237,233,225,0.92)",
  heading: "rgba(70,53,38,0.96)",
  muted: "#c0b5a7",
  paper: "#fefcf6",
  text: "rgba(106,86,67,0.92)",
  wood: "rgba(239,230,216,0.95)",
};

const baseHeadingStyle: CSSProperties = {
  color: colors.heading,
  fontWeight: 600,
  letterSpacing: "0",
  lineHeight: 1.4,
};

const bodyParagraphStyle: CSSProperties = {
  margin: "0 0 12px",
  color: colors.text,
  fontFamily:
    '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif',
  fontSize: "15px",
  fontWeight: 400,
  lineHeight: 1.68,
  letterSpacing: "0",
  textAlign: "left",
  overflowWrap: "break-word",
};

const components: Components = {
  h1: ({ children }) => (
    <h1
      style={{
        ...baseHeadingStyle,
        margin: "18px 0 14px",
        fontSize: "20px",
        textAlign: "center",
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      style={{
        ...baseHeadingStyle,
        margin: "18px 0 10px",
        paddingBottom: "6px",
        borderBottom: `1px solid ${colors.border}`,
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
        margin: "16px 0 8px",
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
        margin: "15px 0 7px",
        fontSize: "15px",
      }}
    >
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 style={{ ...baseHeadingStyle, margin: "14px 0 7px", fontSize: "14px" }}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 style={{ ...baseHeadingStyle, margin: "14px 0 7px", fontSize: "13px" }}>
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p style={bodyParagraphStyle}>{children}</p>
  ),
  strong: ({ children }) => (
    <strong
      style={{
        display: "inline",
        color: colors.heading,
        fontWeight: 600,
        whiteSpace: "normal",
      }}
    >
      {children}
    </strong>
  ),
  em: ({ children }) => <em style={{ color: colors.muted }}>{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      style={{
        color: colors.accent,
        textDecoration: "none",
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "12px 0",
        padding: "8px 12px",
        borderLeft: `2px solid ${colors.border}`,
        backgroundColor: "rgba(243,236,225,0.65)",
        color: colors.muted,
        fontSize: "15px",
        fontWeight: 400,
        lineHeight: 1.64,
      }}
    >
      {children}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul
      style={{
        boxSizing: "border-box",
        width: "100% !important",
        maxWidth: "100% !important",
        margin: "6px 0 13px",
        paddingLeft: "1.35em !important",
        listStylePosition: "outside",
        color: colors.text,
        fontSize: "15px",
        fontWeight: 400,
        lineHeight: 1.68,
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
        margin: "6px 0 13px",
        paddingLeft: "1.5em !important",
        listStylePosition: "outside",
        color: colors.text,
        fontSize: "15px",
        fontWeight: 400,
        lineHeight: 1.68,
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
        margin: "3px 0",
        paddingLeft: "0.1em",
        color: colors.text,
        fontSize: "15px",
        fontWeight: 400,
        lineHeight: 1.68,
      }}
    >
      {children}
    </li>
  ),
  code: ({ children, className }) => (
    <code
      className={className}
      style={{
        padding: className ? "0" : "2px 5px",
        borderRadius: "0",
        background: className ? "transparent" : colors.code,
        color: className ? colors.text : "#8a6548",
        fontFamily:
          '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: className ? "12px" : "0.88em",
        fontWeight: 400,
      }}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        margin: "12px 0",
        padding: "10px 12px",
        overflowX: "auto",
        border: `1px solid ${colors.border}`,
        borderRadius: "0",
        background: "rgba(243,236,225,0.9)",
        color: "rgba(97,79,61,0.94)",
        fontSize: "12px",
        fontWeight: 400,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
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
        margin: "14px auto",
        padding: "4px",
        border: "1px solid #ebe8e3",
        borderRadius: "0",
        backgroundColor: "#ffffff",
        boxShadow: "0 1px 4px rgba(88,70,52,0.07)",
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
    <section style={{ margin: "12px 0", overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          color: colors.text,
          fontSize: "13px",
          fontWeight: 400,
          lineHeight: 1.55,
        }}
      >
        {children}
      </table>
    </section>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: "8px 10px",
        border: `1px solid ${colors.border}`,
        background: "rgba(243,236,225,0.65)",
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
        padding: "8px 10px",
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
        margin: "18px auto",
        width: "38%",
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

function SectionHeading({ children }: { children: string }) {
  const titleComponents: Components = {
    ...components,
    p: ({ children: titleChildren }) => (
      <header
        style={{
          ...baseHeadingStyle,
          margin: "2px 0 10px",
          paddingBottom: "6px",
          borderBottom: `1px solid ${colors.border}`,
          color: colors.heading,
          fontSize: "16px",
          textAlign: "start",
        }}
      >
        {titleChildren as ReactNode}
      </header>
    ),
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={titleComponents}>
      {children}
    </ReactMarkdown>
  );
}

function CenteredBodyLine({ children }: { children: string }) {
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
  position,
}: {
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
  markdown,
  footerHammerUrl,
}: WechatArticleProps) {
  const sections = splitSections(markdown);

  return (
    <section
      data-tool="锤子便签Skill"
      data-smartisan-theme="warm-paper"
      style={{
        boxSizing: "border-box",
        margin: "0 auto",
        padding: "7px",
        width: "100%",
        maxWidth: "100%",
        backgroundColor: colors.wood,
        color: colors.text,
        fontFamily:
          '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif',
        fontWeight: 400,
        wordBreak: "break-word",
      }}
    >
      <section
        data-smartisan-paper="true"
        style={{
          boxSizing: "border-box",
          margin: "0 auto",
          padding: "6px",
          paddingBottom: "12%",
          width: "100%",
          maxWidth: "677px",
          border: "0",
          backgroundColor: colors.paper,
          boxShadow: "0 2px 8px rgba(89,65,34,0.08)",
        }}
      >
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
              <FrameCornerCell position="top-left" />
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
              <FrameCornerCell position="top-right" />
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
              <td style={{ padding: "3px", border: "0" }}>
                <section
                  data-smartisan-frame="inner"
                  style={{
                    boxSizing: "border-box",
                    padding: "20px 18px 14px",
                    border: `1px solid ${colors.frame}`,
                    backgroundColor: colors.paper,
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
                                ? "18px 0 0"
                                : "12px 0 0",
                        }}
                      >
                        {section.heading ? (
                          section.headingAlignment === "center" ? (
                            <CenteredBodyLine>
                              {section.heading}
                            </CenteredBodyLine>
                          ) : (
                            <SectionHeading>{section.heading}</SectionHeading>
                          )
                        ) : null}
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={components}
                        >
                          {protectWechatInlineBoundaries(
                            detachUnindentedImagesFromLists(
                              removeTrailingEmptyListItems(section.content),
                            ),
                          )}
                        </ReactMarkdown>
                      </section>
                    ))
                  ) : (
                    <p
                      style={{
                        margin: "18px 0",
                        color: colors.muted,
                        fontSize: "14px",
                        fontWeight: 400,
                        lineHeight: 1.68,
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
              <FrameCornerCell position="bottom-left" />
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
              <FrameCornerCell position="bottom-right" />
            </tr>
          </tbody>
        </table>

        <section
          data-smartisan-footer="true"
          style={{
            boxSizing: "border-box",
            margin: "11px 18px 0",
            padding: "0",
            border: "0",
            color: colors.footer,
            fontSize: "0",
            fontWeight: 400,
            lineHeight: "16px",
            textAlign: "left",
            whiteSpace: "nowrap",
          }}
        >
          <img
            data-smartisan-hammer="true"
            src={footerHammerUrl}
            alt="锤子"
            width="16"
            height="16"
            style={{
              display: "inline-block",
              width: "16px",
              height: "16px",
              margin: "0 5px 0 0",
              border: "0",
              borderRadius: "50%",
              backgroundColor: "transparent",
              objectFit: "contain",
              verticalAlign: "middle",
            }}
          />
          <span
            style={{
              display: "inline-block",
              margin: "0",
              color: colors.footer,
              fontSize: "10px",
              fontWeight: 400,
              lineHeight: "16px",
              verticalAlign: "middle",
              whiteSpace: "nowrap",
            }}
          >
            <strong style={{ fontWeight: 400 }}>由锤子便签发送</strong>
            <span
              style={{ marginLeft: "4px", fontSize: "8px", fontWeight: 400 }}
            >
              via Smartisan Notes
            </span>
          </span>
        </section>
      </section>
    </section>
  );
}
