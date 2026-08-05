import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("滚动条在交互时显示并在空闲后自动隐藏", () => {
  const mainSource = readFileSync("src/main.tsx", "utf8");
  const behaviorSource = readFileSync(
    "src/lib/auto-hide-scrollbars.ts",
    "utf8",
  );
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(mainSource, /installAutoHideScrollbars\(\);/);
  assert.match(behaviorSource, /SCROLLBAR_HIDE_DELAY_MS = 900/);
  assert.match(
    behaviorSource,
    /doc\.addEventListener\("scroll", handleScroll, \{[\s\S]*capture: true,[\s\S]*passive: true,/,
  );
  assert.match(
    behaviorSource,
    /element\.setAttribute\("data-scrollbar-active", "true"\);[\s\S]*view\.setTimeout\(\(\) => hideScrollbar\(element\), SCROLLBAR_HIDE_DELAY_MS\)/,
  );
  assert.match(
    behaviorSource,
    /element\.removeAttribute\("data-scrollbar-active"\)/,
  );

  assert.match(
    styles,
    /\*\s*\{[^}]*scrollbar-color:\s*transparent transparent;/s,
  );
  assert.match(
    styles,
    /\*\[data-scrollbar-active="true"\]\s*\{[^}]*scrollbar-color:\s*var\(--scrollbar-thumb\) transparent;/s,
  );
  assert.match(
    styles,
    /\*:not\(html\):not\(body\):not\(#root\):hover::\-webkit-scrollbar-thumb,[\s\S]*\*\[data-scrollbar-active="true"\]::\-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*var\(--scrollbar-thumb\);/s,
  );
});
