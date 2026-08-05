import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DOMAIN_PAGE_TITLE,
  getPageTitle,
  IP_PAGE_TITLE,
  isIpAddress,
} from "../../src/lib/page-title.js";

test("域名访问使用线上标题", () => {
  assert.equal(getPageTitle("notes.fangyuanxiaozhan.com"), DOMAIN_PAGE_TITLE);
  assert.equal(getPageTitle("localhost"), DOMAIN_PAGE_TITLE);
  assert.equal(DOMAIN_PAGE_TITLE, "开源版锤子便签");
});

test("IPv4 和 IPv6 地址访问使用本地化标题", () => {
  assert.equal(getPageTitle("127.0.0.1"), IP_PAGE_TITLE);
  assert.equal(getPageTitle("192.168.1.23"), IP_PAGE_TITLE);
  assert.equal(getPageTitle("[::1]"), IP_PAGE_TITLE);
  assert.equal(getPageTitle("2001:db8::1"), IP_PAGE_TITLE);
  assert.equal(IP_PAGE_TITLE, "本地化开源版锤子便签");
});

test("类似 IP 的无效域名不会被误判", () => {
  assert.equal(isIpAddress("256.1.1.1"), false);
  assert.equal(isIpAddress("192.168.1.example"), false);
});

test("页面入口统一设置标题，子页面不会覆盖", () => {
  const mainSource = readFileSync("src/main.tsx", "utf8");
  const changelogSource = readFileSync(
    "src/components/ChangelogPage.tsx",
    "utf8",
  );

  assert.match(
    mainSource,
    /document\.title = getPageTitle\(window\.location\.hostname\)/,
  );
  assert.doesNotMatch(changelogSource, /document\.title\s*=/);
});
