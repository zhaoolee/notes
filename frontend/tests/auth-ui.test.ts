import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangePasswordDialog } from "../../src/components/ChangePasswordDialog.js";
import { LoginDialog } from "../../src/components/LoginDialog.js";
import { canUseCloudWorkspace } from "../../src/lib/auth.js";

test("首页账号密码弹窗支持浏览器密码管理与记住登录", () => {
  const html = renderToStaticMarkup(
    createElement(LoginDialog, {
      login: async () => ({
        id: "feedback-user",
        role: "user" as const,
        username: "feedback",
      }),
      onAuthenticated: () => undefined,
      onClose: () => undefined,
    }),
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /锤子便签/);
  assert.match(html, /账号密码登录/);
  assert.doesNotMatch(html, /短信验证码登录/);
  assert.match(html, /placeholder="用户名或邮箱"/);
  assert.match(html, /type="text"[^>]*autoComplete="username"[^>]*name="username"/);
  assert.match(
    html,
    /type="password"[^>]*autoComplete="current-password"[^>]*name="password"/,
  );
  assert.match(html, /class="login-dialog-password-toggle"/);
  assert.match(html, /aria-label="显示密码"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /type="checkbox" checked=""/);
  assert.match(html, /记住密码/);
  assert.match(html, /登录后便签自动保存到云端/);
});

test("普通用户修改密码表单使用当前密码与新密码语义", () => {
  const html = renderToStaticMarkup(
    createElement(ChangePasswordDialog, {
      changePassword: async () => undefined,
      onClose: () => undefined,
    }),
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, />修改密码</);
  assert.match(html, />当前密码</);
  assert.match(html, />新密码</);
  assert.match(html, />确认新密码</);
  assert.match(
    html,
    /<input[^>]*autoComplete="current-password"[^>]*name="currentPassword"/,
  );
  assert.match(
    html,
    /<input[^>]*autoComplete="new-password"[^>]*name="newPassword"/,
  );
  assert.match(
    html,
    /<input[^>]*autoComplete="new-password"[^>]*name="confirmPassword"/,
  );
  assert.match(html, /minLength="8"/);
  assert.match(html, /其他设备需要使用新密码重新登录/);
});

test("普通用户和 superadmin 都拥有云便签能力", () => {
  assert.equal(canUseCloudWorkspace(null), false);
  assert.equal(
    canUseCloudWorkspace({
      id: "feedback-user",
      role: "user",
      username: "feedback",
    }),
    true,
  );
  assert.equal(
    canUseCloudWorkspace({
      id: "superadmin",
      role: "superadmin",
      username: "admin",
    }),
    true,
  );
});

test("superadmin 路由、用户管理和首页云同步入口保持连通", () => {
  const mainSource = readFileSync("src/main.tsx", "utf8");
  const appSource = readFileSync("src/App.tsx", "utf8");
  const adminSource = readFileSync(
    "src/components/SuperAdminPage.tsx",
    "utf8",
  );
  const authSource = readFileSync("src/lib/auth.ts", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(mainSource, /pathname === "\/superadmin"/);
  assert.match(mainSource, /<SuperAdminPage \/>/);
  assert.match(mainSource, /pathname === "\/changelog"/);
  assert.match(mainSource, /<ChangelogPage markdown=\{changelogMarkdown\} \/>/);
  assert.match(appSource, /className="auth-trigger"/);
  assert.match(appSource, /className="auth-trigger-label"/);
  assert.match(appSource, /desktopFooter=\{desktopSidebarFooter\}/);
  assert.match(appSource, /登录锤子便签/);
  assert.match(appSource, /账号：\$\{authUser\.username\}/);
  assert.match(appSource, /className="account-menu-summary"/);
  assert.match(appSource, /className="account-menu-item"/);
  assert.match(
    appSource,
    /className="account-menu-item account-menu-logout"/,
  );
  assert.match(appSource, /<LoginDialog/);
  assert.match(appSource, /<ChangePasswordDialog/);
  assert.match(appSource, /changePassword=\{changeUserPassword\}/);
  assert.match(appSource, /getCloudWorkspace\(\)/);
  assert.match(appSource, /saveCloudWorkspace\(workspace\)/);
  assert.match(appSource, /CLOUD_POLL_INTERVAL_MS = 15_000/);
  assert.match(appSource, /persistNoteWorkspace\(workspace\)/);
  assert.match(appSource, /canUseCloudWorkspace\(session\)/);
  assert.doesNotMatch(
    appSource,
    /user\.role === "superadmin"\)\s*\{\s*window\.location\.assign\("\/superadmin"\)/,
  );
  assert.match(adminSource, /创建用户并生成密码/);
  assert.match(adminSource, /支持用户名或邮箱/);
  assert.match(adminSource, /maxLength=\{254\}/);
  assert.match(adminSource, /复制账号密码/);
  assert.match(adminSource, /管理员无法查看现有密码，只能重置/);
  assert.match(adminSource, /确认重置/);
  assert.match(adminSource, /新临时密码（仅显示一次）/);
  assert.match(adminSource, /resetManagedUserPassword\(user\.id\)/);
  assert.match(authSource, /"\/api\/superadmin\/users"/);
  assert.match(authSource, /"\/api\/auth\/password"/);
  assert.match(authSource, /reset-password/);
  assert.match(authSource, /"\/api\/workspace"/);
  assert.match(authSource, /登录服务暂不可用，请确认后端服务已启动/);
  assert.match(styles, /\.login-dialog-backdrop\s*\{/);
  assert.match(styles, /\.login-dialog-password-toggle\s*\{/);
  assert.match(
    styles,
    /\.auth-trigger\s*\{[^}]*width:\s*100%;[^}]*height:\s*49px;[^}]*justify-content:\s*flex-start;/s,
  );
  assert.match(
    styles,
    /\.auth-trigger:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*inset 0 0 0 1px/s,
  );
  assert.match(
    styles,
    /\.account-menu\s*\{[^}]*bottom:\s*calc\(100% \+ 6px\);[^}]*left:\s*8px;[^}]*width:\s*auto;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.account-menu-summary strong\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(styles, /\.account-menu \.account-menu-logout\s*\{/);
  assert.doesNotMatch(styles, /right: calc\(100% - var\(--category-sidebar-width\)/);
  assert.match(styles, /\.superadmin-page\s*\{/);
});
