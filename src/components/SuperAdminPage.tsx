import { useEffect, useState, type FormEvent } from "react";
import {
  createManagedUser,
  getAuthSession,
  listManagedUsers,
  loginSuperAdmin,
  logoutUser,
  resetManagedUserPassword,
  type AccountSummary,
  type AuthUser,
  type CreatedAccount,
  type ResetAccountPassword,
} from "../lib/auth.js";
import { copyTextToClipboard } from "../lib/clipboard.js";
import { LoginDialog } from "./LoginDialog.js";

function formatCreatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(timestamp));
}

export function SuperAdminPage() {
  const [session, setSession] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AccountSummary[]>([]);
  const [username, setUsername] = useState("");
  const [createdAccount, setCreatedAccount] =
    useState<CreatedAccount | null>(null);
  const [resetAccount, setResetAccount] =
    useState<ResetAccountPassword | null>(null);
  const [error, setError] = useState("");
  const [resetError, setResetError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isPasswordCopied, setIsPasswordCopied] = useState(false);
  const [isResetPasswordCopied, setIsResetPasswordCopied] = useState(false);
  const [pendingResetUserId, setPendingResetUserId] = useState<string | null>(
    null,
  );
  const [isResettingUserId, setIsResettingUserId] = useState<string | null>(
    null,
  );

  async function loadUsers() {
    setUsers(await listManagedUsers());
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const currentSession = await getAuthSession();

        if (cancelled) {
          return;
        }

        if (currentSession?.role === "superadmin") {
          setSession(currentSession);
          await loadUsers();
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "管理员后台加载失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAuthenticated(user: AuthUser) {
    setSession(user);
    setError("");
    await loadUsers();
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreating || !username.trim()) {
      return;
    }

    try {
      setIsCreating(true);
      setError("");
      setIsPasswordCopied(false);
      const created = await createManagedUser(username);
      setCreatedAccount(created);
      setUsername("");
      await loadUsers();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "创建用户失败。",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleLogout() {
    try {
      await logoutUser();
    } finally {
      setSession(null);
      setUsers([]);
      setCreatedAccount(null);
      setResetAccount(null);
    }
  }

  async function handleResetPassword(user: AccountSummary) {
    if (isResettingUserId) {
      return;
    }

    if (pendingResetUserId !== user.id) {
      setPendingResetUserId(user.id);
      setResetAccount(null);
      setResetError("");
      return;
    }

    try {
      setIsResettingUserId(user.id);
      setResetError("");
      setIsResetPasswordCopied(false);
      setResetAccount(await resetManagedUserPassword(user.id));
      setPendingResetUserId(null);
    } catch (resetPasswordError) {
      setResetError(
        resetPasswordError instanceof Error
          ? resetPasswordError.message
          : "重置密码失败。",
      );
    } finally {
      setIsResettingUserId(null);
    }
  }

  if (isLoading) {
    return (
      <main className="superadmin-loading">
        <p>正在验证管理员身份...</p>
      </main>
    );
  }

  if (!session || session.role !== "superadmin") {
    return (
      <main className="superadmin-login-page">
        <LoginDialog
          isAdmin
          login={loginSuperAdmin}
          onAuthenticated={handleAuthenticated}
        />
      </main>
    );
  }

  return (
    <main className="superadmin-page">
      <header className="superadmin-header">
        <div>
          <span className="superadmin-eyebrow">SUPERADMIN</span>
          <h1>锤子便签用户管理</h1>
        </div>
        <div className="superadmin-session">
          <span>{session.username}</span>
          <a href="/">返回便签</a>
          <button type="button" onClick={() => void handleLogout()}>
            退出
          </button>
        </div>
      </header>

      <div className="superadmin-content">
        <section className="superadmin-card superadmin-create-card">
          <div>
            <h2>添加普通用户</h2>
            <p>支持用户名或邮箱，初始密码只在创建成功后显示一次。</p>
          </div>
          <form onSubmit={handleCreateUser}>
            <label>
              <span>用户名或邮箱</span>
              <input
                type="text"
                value={username}
                minLength={3}
                maxLength={254}
                placeholder="用户名或 name@example.com"
                autoComplete="off"
                required
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <button type="submit" disabled={isCreating || !username.trim()}>
              {isCreating ? "正在创建..." : "创建用户并生成密码"}
            </button>
          </form>

          {error ? (
            <p className="superadmin-error" role="alert">
              {error}
            </p>
          ) : null}

          {createdAccount ? (
            <div className="superadmin-credential" role="status">
              <div>
                <span>账号</span>
                <strong>{createdAccount.username}</strong>
              </div>
              <div>
                <span>初始密码</span>
                <code>{createdAccount.initialPassword}</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  void copyTextToClipboard(
                    `账号：${createdAccount.username}\n初始密码：${createdAccount.initialPassword}`,
                  ).then(() => setIsPasswordCopied(true));
                }}
              >
                {isPasswordCopied ? "已复制" : "复制账号密码"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="superadmin-card">
          <div className="superadmin-list-heading">
            <div>
              <h2>普通用户</h2>
              <p>
                每个账号拥有独立的云端便签工作区。管理员无法查看现有密码，只能重置。
              </p>
            </div>
            <strong>{users.length}</strong>
          </div>

          {resetError ? (
            <p className="superadmin-error" role="alert">
              {resetError}
            </p>
          ) : null}

          {resetAccount ? (
            <div
              className="superadmin-credential superadmin-reset-credential"
              role="status"
            >
              <div>
                <span>账号</span>
                <strong>{resetAccount.username}</strong>
              </div>
              <div>
                <span>新临时密码（仅显示一次）</span>
                <code>{resetAccount.temporaryPassword}</code>
              </div>
              <button
                type="button"
                onClick={() => {
                  void copyTextToClipboard(
                    `账号：${resetAccount.username}\n新临时密码：${resetAccount.temporaryPassword}`,
                  ).then(() => setIsResetPasswordCopied(true));
                }}
              >
                {isResetPasswordCopied ? "已复制" : "复制新密码"}
              </button>
            </div>
          ) : null}

          {users.length ? (
            <div className="superadmin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>用户名或邮箱</th>
                    <th>创建时间</th>
                    <th>用户 ID</th>
                    <th>密码操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{formatCreatedAt(user.createdAt)}</td>
                      <td>
                        <code>{user.id}</code>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="superadmin-reset-password"
                          disabled={
                            Boolean(isResettingUserId) &&
                            isResettingUserId !== user.id
                          }
                          aria-label={`重置密码：${user.username}`}
                          onClick={() => void handleResetPassword(user)}
                        >
                          {isResettingUserId === user.id
                            ? "正在重置..."
                            : pendingResetUserId === user.id
                              ? "确认重置"
                              : "重置密码"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="superadmin-empty">还没有普通用户。</p>
          )}
        </section>
      </div>
    </main>
  );
}
