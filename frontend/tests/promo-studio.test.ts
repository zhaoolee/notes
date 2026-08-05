import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PromoStudioPage } from "../../src/components/PromoStudioPage.js";
import {
  getPromoCoverCrop,
  getPromoDownloadName,
  getPromoFitWidthPlacement,
  getPromoPageAspectHeightScale,
  getPromoTransformedImagePlacement,
  movePromoItem,
  normalizePromoHexColor,
  PROMO_CANVAS_HEIGHT,
  PROMO_CANVAS_WIDTH,
  scalePromoPageGeometry,
} from "../../src/lib/promo-image.js";

test("宣传图固定使用 2048 × 920 的高清画布", () => {
  assert.equal(PROMO_CANVAS_WIDTH, 2048);
  assert.equal(PROMO_CANVAS_HEIGHT, 920);
  assert.equal(
    getPromoDownloadName("editor"),
    "notes-promo-editor-2048x920.png",
  );
  assert.equal(
    getPromoDownloadName("pages"),
    "notes-promo-pages-2048x920.png",
  );
});

test("宣传图背景支持输入六位十六进制颜色", () => {
  assert.equal(normalizePromoHexColor("#debd85"), "#debd85");
  assert.equal(normalizePromoHexColor("DEBD85"), "#debd85");
  assert.equal(normalizePromoHexColor("  #4B4335  "), "#4b4335");
  assert.equal(normalizePromoHexColor("#fff"), null);
  assert.equal(normalizePromoHexColor("#xyzxyz"), null);
});

test("铺满页面的封面裁切保持比例并支持缩放与偏移", () => {
  assert.deepEqual(getPromoCoverCrop(2000, 1000, 1000, 1000), {
    height: 1000,
    width: 1000,
    x: 500,
    y: 0,
  });
  assert.deepEqual(getPromoCoverCrop(1000, 2000, 1000, 500), {
    height: 500,
    width: 1000,
    x: 0,
    y: 750,
  });
  assert.deepEqual(getPromoCoverCrop(2000, 1000, 1000, 1000, 2, -1, 0), {
    height: 500,
    width: 500,
    x: 0,
    y: 250,
  });
});

test("单图模板完整显示宽度并允许从顶部移动到长图底部", () => {
  const topPlacement = getPromoFitWidthPlacement(1000, 3000, 1000, 500, 0);
  const middlePlacement = getPromoFitWidthPlacement(
    1000,
    3000,
    1000,
    500,
    0.5,
  );
  const bottomPlacement = getPromoFitWidthPlacement(
    1000,
    3000,
    1000,
    500,
    1,
  );

  assert.deepEqual(topPlacement.source, {
    height: 500,
    width: 1000,
    x: 0,
    y: 0,
  });
  assert.equal(middlePlacement.source.y, 1250);
  assert.equal(bottomPlacement.source.y, 2500);
  assert.deepEqual(bottomPlacement.destination, {
    height: 500,
    width: 1000,
    x: 0,
    y: 0,
  });

  assert.deepEqual(getPromoFitWidthPlacement(2000, 1000, 1000, 800, 1), {
    destination: { height: 500, width: 1000, x: 0, y: 0 },
    source: { height: 1000, width: 2000, x: 0, y: 0 },
  });
});

test("单图宣传图使用正式手写文字纹理而不是临时曲线占位", () => {
  const texture = readFileSync("public/promo-script-texture.png");
  const componentSource = readFileSync(
    "src/components/PromoStudioPage.tsx",
    "utf8",
  );

  assert.deepEqual(Array.from(texture.subarray(0, 8)), [
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  assert.ok(texture.length > 10_000);
  assert.match(componentSource, /PROMO_SCRIPT_TEXTURE = "\/promo-script-texture\.png"/);
  assert.match(componentSource, /context\.drawImage\(texture/);
  assert.match(componentSource, /drawScriptDecoration\(context, scriptTexture\)/);
});

test("多页层叠可统一缩放三张纸的宽度和高度", () => {
  assert.deepEqual(
    scalePromoPageGeometry(
      { x: 100, y: 200 },
      { x: 500, y: 240 },
      { x: 120, y: 800 },
      1.25,
      0.8,
    ),
    {
      topLeft: { x: 100, y: 200 },
      topRight: { x: 600, y: 250 },
      bottomLeft: { x: 116, y: 680 },
    },
  );
  assert.equal(
    getPromoPageAspectHeightScale(
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 0, y: 800 },
      1.5,
    ),
    0.5,
  );
});

test("多页图片使用变换后的真实纸张比例计算取景", () => {
  const coverPlacement = getPromoTransformedImagePlacement(
    3000,
    2000,
    600,
    400,
    520,
    878,
    "cover",
  );

  assert.deepEqual(coverPlacement.source, {
    height: 2000,
    width: 3000,
    x: 0,
    y: 0,
  });
  assert.deepEqual(coverPlacement.destination, {
    height: 878,
    width: 520,
    x: 0,
    y: 0,
  });

  const containPlacement = getPromoTransformedImagePlacement(
    3000,
    2000,
    600,
    300,
    520,
    878,
    "contain",
  );

  assert.deepEqual(containPlacement.source, {
    height: 2000,
    width: 3000,
    x: 0,
    y: 0,
  });
  assert.equal(containPlacement.destination.width, 390);
  assert.equal(containPlacement.destination.x, 65);
});

test("多页铺满模式默认从顶部取景并允许每张图使用不同位置", () => {
  const topPlacement = getPromoTransformedImagePlacement(
    1000,
    3000,
    1000,
    500,
    520,
    878,
    "cover",
    -1,
  );
  const middlePlacement = getPromoTransformedImagePlacement(
    1000,
    3000,
    1000,
    500,
    520,
    878,
    "cover",
    0,
  );
  const bottomPlacement = getPromoTransformedImagePlacement(
    1000,
    3000,
    1000,
    500,
    520,
    878,
    "cover",
    1,
  );

  assert.equal(topPlacement.source.y, 0);
  assert.equal(middlePlacement.source.y, 1250);
  assert.equal(bottomPlacement.source.y, 2500);
  assert.equal(topPlacement.source.height, 500);
  assert.equal(bottomPlacement.source.height, 500);
});

test("多页图片可调整前后顺序且取景参数可随图片一起移动", () => {
  const originalNames = ["第一张", "第二张", "第三张"];
  const originalPositions = [12, 48, 86];

  assert.deepEqual(movePromoItem(originalNames, 0, 1), [
    "第二张",
    "第一张",
    "第三张",
  ]);
  assert.deepEqual(movePromoItem(originalPositions, 0, 1), [48, 12, 86]);
  assert.deepEqual(originalNames, ["第一张", "第二张", "第三张"]);
  assert.deepEqual(movePromoItem(originalNames, 2, 1), [
    "第一张",
    "第三张",
    "第二张",
  ]);
});

test("两个宣传图页面提供独立路由、上传控件和下载入口", () => {
  const mainSource = readFileSync("src/main.tsx", "utf8");
  const viteConfig = readFileSync("vite.config.ts", "utf8");
  const componentSource = readFileSync(
    "src/components/PromoStudioPage.tsx",
    "utf8",
  );
  const styles = readFileSync("src/styles.css", "utf8");
  const editorMarkup = renderToStaticMarkup(
    createElement(PromoStudioPage, { mode: "editor" }),
  );
  const pagesMarkup = renderToStaticMarkup(
    createElement(PromoStudioPage, { mode: "pages" }),
  );

  assert.match(mainSource, /pathname === "\/promo\/editor"/);
  assert.match(mainSource, /pathname === "\/promo\/pages"/);
  assert.match(viteConfig, /base:\s*"\/"/);
  assert.doesNotMatch(viteConfig, /base:\s*"\.\/"/);
  assert.match(editorMarkup, /单图聚焦/);
  assert.match(editorMarkup, /选择产品截图/);
  assert.match(editorMarkup, /上下取景/);
  assert.match(editorMarkup, /调整单图的上下取景/);
  assert.match(editorMarkup, /图片始终完整显示宽度，从顶部向下取景/);
  assert.doesNotMatch(editorMarkup, />缩放</);
  assert.doesNotMatch(editorMarkup, />水平</);
  assert.match(editorMarkup, /输入十六进制背景颜色/);
  assert.match(pagesMarkup, /输入十六进制背景颜色/);
  assert.doesNotMatch(editorMarkup, /multiple=""/);
  assert.match(pagesMarkup, /多页层叠/);
  assert.match(pagesMarkup, /可能是史上最漂亮的/);
  assert.match(pagesMarkup, /便签应用/);
  assert.match(
    pagesMarkup,
    /你或许会因它重新喜欢上记录和表达。它不仅可以输入文字，还支持插入图片，进行图文混排/,
  );
  assert.doesNotMatch(pagesMarkup, /最多上传三张图片/);
  assert.match(pagesMarkup, /选择最多三张页面图片/);
  assert.match(pagesMarkup, /multiple=""/);
  assert.match(pagesMarkup, /铺满页面/);
  assert.match(pagesMarkup, /自动裁切空白，适合横向截图/);
  assert.match(pagesMarkup, /完整显示/);
  assert.match(pagesMarkup, /每张图单独取景/);
  assert.match(pagesMarkup, /图片 1 · 前层/);
  assert.match(pagesMarkup, /图片 2 · 中层/);
  assert.match(pagesMarkup, /图片 3 · 后层/);
  assert.match(pagesMarkup, /调节图片 1（前层）的上下取景/);
  assert.match(pagesMarkup, /调节图片 2（中层）的上下取景/);
  assert.match(pagesMarkup, /调节图片 3（后层）的上下取景/);
  assert.doesNotMatch(pagesMarkup, /三张图上下取景/);
  assert.match(componentSource, /<legend>图片顺序<\/legend>/);
  assert.match(componentSource, /第一张显示在最前层/);
  assert.match(componentSource, /移到前一层/);
  assert.match(componentSource, /移到后一层/);
  assert.match(componentSource, /movePromoItem\(positions/);
  assert.match(pagesMarkup, /切换到“铺满页面”后可调节/);
  assert.match(pagesMarkup, /checked="" value="contain"/);
  assert.match(pagesMarkup, /纸张尺寸/);
  assert.match(pagesMarkup, /跟随第一张图比例/);
  assert.match(pagesMarkup, /上传后自动/);
  assert.match(pagesMarkup, /统一调节三张纸的宽度/);
  assert.match(pagesMarkup, /统一调节三张纸的高度/);
  assert.match(editorMarkup, /下载高清 PNG/);
  assert.match(editorMarkup, /图片仅在本机浏览器中处理/);
  assert.match(
    styles,
    /\.promo-canvas-frame canvas\s*\{[\s\S]*width: 100%;[\s\S]*height: auto;/,
  );
  assert.match(styles, /@media \(max-width: 640px\)/);
});
