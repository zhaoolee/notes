import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { NoteDocument } from "../../types/app.js";
import {
  activeGitHubPublishPhases,
  type GitHubPublishCounts,
  type GitHubPublishJob,
  type GitHubPublishPhase,
  type GitHubPublishingStatus,
  type GitHubSiteRepository,
} from "./github-model.js";
import {
  createGitHubConnectUrl,
  disconnectGitHub,
  fetchGitHubPublishingStatus,
  fetchGitHubRepositories,
  publishSiteToGitHub,
  sanitizeGitHubCommitUrl,
  sanitizeGitHubSiteUrl,
  selectGitHubRepository,
  type GitHubPublishRedirect,
} from "./github-client.js";
import type { SitePublishDraft } from "./model.js";

/** 状态轮询间隔落在需求要求的 3–5 秒内，变更动作会先暂停在途轮询。 */
export const GITHUB_PUBLISH_POLL_INTERVAL_MS = 4_000;

const ACTIVE_PHASES = new Set<GitHubPublishPhase>(activeGitHubPublishPhases);
const TERMINAL_PHASES = new Set<GitHubPublishPhase>([
  "published",
  "failed",
  "interrupted",
]);

const PHASE_LABELS: Record<GitHubPublishPhase, string> = {
  queued: "已排队，等待生成站点",
  building: "正在生成站点",
  uploading: "正在上传站点文件",
  committing: "正在提交到 GitHub",
  deploying: "已提交成功，等待 GitHub Pages 部署",
  published: "已发布，站点已上线",
  failed: "发布失败",
  interrupted: "发布已中断",
};

export interface GitHubPublishJobView {
  active: boolean;
  terminal: boolean;
  /** 只有 published 才是真正上线；deploying 仅代表内容已提交。 */
  live: boolean;
  committed: boolean;
  label: string;
}

export function isGitHubPublishJobActive(
  job: GitHubPublishJob | null | undefined,
): boolean {
  return Boolean(job && ACTIVE_PHASES.has(job.phase));
}

export function describeGitHubPublishJob(
  job: GitHubPublishJob,
): GitHubPublishJobView {
  return {
    active: ACTIVE_PHASES.has(job.phase),
    terminal: TERMINAL_PHASES.has(job.phase),
    live: job.phase === "published",
    committed: Boolean(job.commitSha || job.commitUrl),
    label: PHASE_LABELS[job.phase],
  };
}

export function formatGitHubPublishCounts(
  counts: GitHubPublishCounts | undefined,
): string {
  if (!counts) {
    return "";
  }

  return [
    `新增 ${counts.added}`,
    `修改 ${counts.modified}`,
    `删除 ${counts.deleted}`,
    `未变 ${counts.unchanged}`,
    `上传文件 ${counts.uploaded}`,
  ].join(" · ");
}

export interface GitHubPublishAvailabilityInput {
  selectedCount: number;
  disabled: boolean;
  status: GitHubPublishingStatus | null;
  savingRepository: boolean;
  publishing: boolean;
  connecting: boolean;
  disconnecting: boolean;
}

export interface GitHubPublishAvailability {
  canPublish: boolean;
  reason: string;
}

/**
 * 发布按钮的唯一判定入口：必须已配置、已授权、已选定仓库、有便签，
 * 且没有其他进行中的操作或发布任务，避免误发到旧仓库。
 */
export function getGitHubPublishAvailability(
  input: GitHubPublishAvailabilityInput,
): GitHubPublishAvailability {
  const deny = (reason: string): GitHubPublishAvailability => ({
    canPublish: false,
    reason,
  });

  if (!input.status) {
    return deny("正在读取 GitHub 发布状态。");
  }

  if (!input.status.enabled) {
    return deny("GitHub 发布未配置。");
  }

  if (input.disabled) {
    return deny("面板正在处理其他操作，请稍后重试。");
  }

  if (!input.status.connected) {
    return deny("请先授权 GitHub 仓库。");
  }

  if (input.connecting) {
    return deny("正在打开 GitHub 授权页面。");
  }

  if (input.disconnecting) {
    return deny("正在断开 GitHub 连接。");
  }

  if (input.selectedCount < 1) {
    return deny("请至少选择一张便签再发布。");
  }

  if (!input.status.repository) {
    return deny("请选择要发布到的 GitHub 仓库。");
  }

  if (input.savingRepository) {
    return deny("正在保存发布仓库。");
  }

  if (input.publishing) {
    return deny("正在提交发布请求。");
  }

  if (isGitHubPublishJobActive(input.status.job)) {
    return deny("已有发布任务进行中，请等待完成。");
  }

  return { canPublish: true, reason: "" };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}

export interface GitHubPublishControlsProps {
  draft: SitePublishDraft;
  notes: NoteDocument[];
  disabled: boolean;
  storageScope: string;
  redirectNotice?: GitHubPublishRedirect | null;
  onConfiguredChange?: (configured: boolean) => void;
  /**
   * 可选的面板页脚动作挂载点。传入目标（含尚未挂载时的 null）时，
   * 唯一发布按钮通过 portal 渲染到页脚；不传则保持组件内联的独立用法。
   */
  actionTarget?: HTMLElement | null;
}

export function GitHubPublishControls({
  draft,
  notes,
  disabled,
  storageScope,
  redirectNotice = null,
  onConfiguredChange,
  actionTarget,
}: GitHubPublishControlsProps) {
  const headingId = useId();
  const repositorySelectId = useId();

  const mountedRef = useRef(true);
  const scopeRef = useRef(storageScope);
  const statusRef = useRef<GitHubPublishingStatus | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusControllerRef = useRef<AbortController | null>(null);
  const statusRequestRef = useRef(false);
  const repositoriesControllerRef = useRef<AbortController | null>(null);
  const repositoriesTokenRef = useRef(0);
  const repositoriesScopeRef = useRef<string | null>(null);
  const actionControllersRef = useRef(new Set<AbortController>());
  const selectionTokenRef = useRef(0);
  const selectionInFlightRef = useRef(false);
  const publishInFlightRef = useRef(false);
  const connectInFlightRef = useRef(false);
  const disconnectInFlightRef = useRef(false);

  const [status, setStatus] = useState<GitHubPublishingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() =>
    redirectNotice === "connected"
      ? "GitHub 授权已完成。"
      : redirectNotice === "error"
        ? "GitHub 授权未完成，请重新授权。"
        : "",
  );
  const [repositories, setRepositories] = useState<GitHubSiteRepository[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [repositoriesError, setRepositoriesError] = useState("");
  const [pendingRepositoryId, setPendingRepositoryId] = useState<number | null>(
    null,
  );
  const [savingRepository, setSavingRepository] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const job = status?.job ?? null;
  const jobView = job ? describeGitHubPublishJob(job) : null;
  const countsText = job ? formatGitHubPublishCounts(job.counts) : "";
  const siteUrl = job ? sanitizeGitHubSiteUrl(job.siteUrl) : null;
  const commitUrl = job ? sanitizeGitHubCommitUrl(job.commitUrl) : null;
  const availability = getGitHubPublishAvailability({
    selectedCount: draft.selections.length,
    disabled,
    status,
    savingRepository,
    publishing,
    connecting,
    disconnecting,
  });
  const activeJob = Boolean(status && isGitHubPublishJobActive(status.job));
  const selectedRepositoryValue = pendingRepositoryId ?? status?.repository?.id ?? null;
  const hasSelectedOption = repositories.some(
    (repository) => repository.id === selectedRepositoryValue,
  );
  const configured = status?.enabled === true;

  useEffect(() => {
    onConfiguredChange?.(configured);
  }, [configured, onConfiguredChange]);

  function clearPoll() {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function cancelStatusRequest() {
    statusControllerRef.current?.abort();
    statusControllerRef.current = null;
    statusRequestRef.current = false;
  }

  function applyStatus(next: GitHubPublishingStatus) {
    statusRef.current = next;
    setStatus(next);
  }

  function schedulePoll() {
    clearPoll();

    if (
      typeof setTimeout !== "function" ||
      !mountedRef.current ||
      !isGitHubPublishJobActive(statusRef.current?.job)
    ) {
      return;
    }

    const scope = scopeRef.current;
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      void refreshStatus({ silent: true, scope });
    }, GITHUB_PUBLISH_POLL_INTERVAL_MS);
  }

  async function refreshStatus(
    options: { silent?: boolean; scope?: string } = {},
  ): Promise<void> {
    const scope = options.scope ?? scopeRef.current;

    // 同一时间只允许一个状态请求；选择仓库等变更动作优先。
    if (statusRequestRef.current || selectionInFlightRef.current) {
      if (selectionInFlightRef.current) {
        schedulePoll();
      }
      return;
    }

    statusRequestRef.current = true;
    const controller = new AbortController();
    statusControllerRef.current = controller;

    if (!options.silent) {
      setLoading(true);
    }

    try {
      const next = await fetchGitHubPublishingStatus({
        signal: controller.signal,
      });

      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        controller.signal.aborted
      ) {
        return;
      }

      // 选择仓库的在途响应不能被较慢的轮询结果覆盖。
      const stable =
        selectionInFlightRef.current && statusRef.current
          ? { ...next, repository: statusRef.current.repository }
          : next;

      applyStatus(stable);
      setError("");

      if (stable.connected) {
        void loadRepositories(scope);
      } else {
        // 重新授权后需要重新读取仓库列表，不能沿用旧 scope 的已加载标记。
        repositoriesScopeRef.current = null;
      }

      schedulePoll();
    } catch (caught) {
      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        controller.signal.aborted ||
        isAbortError(caught)
      ) {
        return;
      }

      clearPoll();
      setError(
        options.silent
          ? "读取 GitHub 发布状态失败，请稍后重试。"
          : errorMessage(caught, "读取 GitHub 发布状态失败，请稍后重试。"),
      );
    } finally {
      if (statusControllerRef.current === controller) {
        statusControllerRef.current = null;
        statusRequestRef.current = false;
      }

      if (!options.silent && mountedRef.current && scopeRef.current === scope) {
        setLoading(false);
      }
    }
  }

  async function loadRepositories(
    scope: string,
    force = false,
  ): Promise<void> {
    if (!force && repositoriesScopeRef.current === scope) {
      return;
    }

    repositoriesScopeRef.current = scope;
    const token = repositoriesTokenRef.current + 1;
    repositoriesTokenRef.current = token;
    repositoriesControllerRef.current?.abort();
    const controller = new AbortController();
    repositoriesControllerRef.current = controller;
    setRepositoriesLoading(true);
    setRepositoriesError("");

    try {
      const list = await fetchGitHubRepositories({
        signal: controller.signal,
      });

      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        token !== repositoriesTokenRef.current ||
        controller.signal.aborted
      ) {
        return;
      }

      setRepositories(list);
    } catch (caught) {
      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        token !== repositoriesTokenRef.current ||
        controller.signal.aborted ||
        isAbortError(caught)
      ) {
        return;
      }

      repositoriesScopeRef.current = null;
      setRepositoriesError(
        errorMessage(caught, "读取 GitHub 仓库列表失败，请稍后重试。"),
      );
    } finally {
      if (token === repositoriesTokenRef.current) {
        if (mountedRef.current && scopeRef.current === scope) {
          setRepositoriesLoading(false);
        }
        if (repositoriesControllerRef.current === controller) {
          repositoriesControllerRef.current = null;
        }
      }
    }
  }

  function trackAction(controller: AbortController): AbortController {
    actionControllersRef.current.add(controller);
    return controller;
  }

  function releaseAction(controller: AbortController) {
    actionControllersRef.current.delete(controller);
  }

  useEffect(() => {
    mountedRef.current = true;
    scopeRef.current = storageScope;
    selectionTokenRef.current += 1;
    selectionInFlightRef.current = false;
    publishInFlightRef.current = false;
    connectInFlightRef.current = false;
    disconnectInFlightRef.current = false;
    statusRef.current = null;
    repositoriesScopeRef.current = null;
    setStatus(null);
    setLoading(true);
    setError("");
    setNotice("");
    setRepositories([]);
    setRepositoriesLoading(false);
    setRepositoriesError("");
    setPendingRepositoryId(null);
    setSavingRepository(false);
    setConnecting(false);
    setPublishing(false);
    setDisconnecting(false);
    void refreshStatus({ scope: storageScope });

    return () => {
      mountedRef.current = false;
      clearPoll();
      cancelStatusRequest();
      repositoriesTokenRef.current += 1;
      repositoriesControllerRef.current?.abort();
      repositoriesControllerRef.current = null;

      for (const controller of actionControllersRef.current) {
        controller.abort();
      }

      actionControllersRef.current.clear();
    };
    // redirectNotice 只影响提示文案，不应因它重启状态请求。
  }, [storageScope]);

  // OAuth 回调只带来一次提示；面板重新打开时才由 App 重新传入。
  useEffect(() => {
    if (!redirectNotice) {
      return;
    }

    setNotice(
      redirectNotice === "connected"
        ? "GitHub 授权已完成。"
        : "GitHub 授权未完成，请重新授权。",
    );
  }, [redirectNotice]);

  async function handleConnect() {
    if (connectInFlightRef.current || disabled) {
      return;
    }

    connectInFlightRef.current = true;
    setConnecting(true);
    setError("");
    setNotice("");
    cancelStatusRequest();
    const scope = scopeRef.current;
    const controller = trackAction(new AbortController());

    try {
      const url = await createGitHubConnectUrl({ signal: controller.signal });

      if (!mountedRef.current || scopeRef.current !== scope) {
        return;
      }

      if (typeof window === "undefined") {
        throw new Error("当前环境无法打开 GitHub 授权页面。");
      }

      // 地址已由客户端校验为后端生成的 GitHub HTTPS 地址。
      window.location.assign(url);
    } catch (caught) {
      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        isAbortError(caught)
      ) {
        return;
      }

      setError(errorMessage(caught, "打开 GitHub 授权页面失败，请稍后重试。"));
    } finally {
      releaseAction(controller);
      connectInFlightRef.current = false;

      if (mountedRef.current && scopeRef.current === scope) {
        setConnecting(false);
      }
    }
  }

  async function handleRepositoryChange(
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    const repositoryId = Number.parseInt(event.target.value, 10);
    const repository = repositories.find((item) => item.id === repositoryId);

    if (
      !repository ||
      savingRepository ||
      publishing ||
      activeJob ||
      disabled
    ) {
      return;
    }

    const scope = scopeRef.current;
    const token = selectionTokenRef.current + 1;
    selectionTokenRef.current = token;
    selectionInFlightRef.current = true;
    setPendingRepositoryId(repository.id);
    setSavingRepository(true);
    setError("");
    setNotice("");
    cancelStatusRequest();
    const controller = trackAction(new AbortController());

    try {
      const next = await selectGitHubRepository(repository, {
        signal: controller.signal,
      });

      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        token !== selectionTokenRef.current ||
        controller.signal.aborted
      ) {
        return;
      }

      applyStatus(next);
      setNotice(`已选择发布仓库：${next.repository?.fullName ?? repository.fullName}`);
    } catch (caught) {
      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        token !== selectionTokenRef.current ||
        controller.signal.aborted ||
        isAbortError(caught)
      ) {
        return;
      }

      // 请求失败也可能已经在服务端保存；先清除旧目标，重新确认前禁止发布。
      if (statusRef.current) applyStatus({ ...statusRef.current, repository: null });
      setError(errorMessage(caught, "保存发布仓库失败，请稍后重试。"));
    } finally {
      releaseAction(controller);

      if (token === selectionTokenRef.current) {
        selectionInFlightRef.current = false;

        if (mountedRef.current && scopeRef.current === scope) {
          setSavingRepository(false);
          setPendingRepositoryId(null);
          if (!statusRef.current?.repository) void refreshStatus({ scope });
          else schedulePoll();
        }
      }
    }
  }

  async function handleDisconnect() {
    if (disconnecting || disabled || activeJob) {
      return;
    }

    const scope = scopeRef.current;
    disconnectInFlightRef.current = true;
    setDisconnecting(true);
    setError("");
    setNotice("");
    cancelStatusRequest();
    clearPoll();
    const controller = trackAction(new AbortController());

    try {
      const next = await disconnectGitHub({ signal: controller.signal });

      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        controller.signal.aborted
      ) {
        return;
      }

      applyStatus(next);
      repositoriesTokenRef.current += 1;
      repositoriesScopeRef.current = null;
      setRepositories([]);
      setRepositoriesError("");
      setPendingRepositoryId(null);
      setNotice("已断开 GitHub 连接，可随时重新授权。");
    } catch (caught) {
      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        controller.signal.aborted ||
        isAbortError(caught)
      ) {
        return;
      }

      setError(errorMessage(caught, "断开 GitHub 连接失败，请稍后重试。"));
    } finally {
      releaseAction(controller);
      disconnectInFlightRef.current = false;

      if (mountedRef.current && scopeRef.current === scope) {
        setDisconnecting(false);
      }
    }
  }

  async function handlePublish() {
    const current = getGitHubPublishAvailability({
      selectedCount: draft.selections.length,
      disabled,
      status: statusRef.current,
      savingRepository,
      publishing,
      connecting,
      disconnecting,
    });

    if (!current.canPublish) {
      setError(current.reason);
      return;
    }

    if (publishInFlightRef.current) {
      return;
    }

    const scope = scopeRef.current;
    publishInFlightRef.current = true;
    setPublishing(true);
    setError("");
    setNotice("");
    cancelStatusRequest();
    clearPoll();
    const controller = trackAction(new AbortController());

    try {
      // 只在用户明确点击后提交；回调、挂载与轮询都不会触发发布。
      const nextJob = await publishSiteToGitHub(draft, notes, {
        signal: controller.signal,
        repositoryId: statusRef.current?.repository?.id,
      });

      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        controller.signal.aborted
      ) {
        return;
      }

      const base = statusRef.current;

      if (!base) {
        setError("GitHub 发布状态已失效，请刷新后重试。");
        return;
      }

      applyStatus({ ...base, job: nextJob });
      setNotice("");
      schedulePoll();
    } catch (caught) {
      if (
        !mountedRef.current ||
        scopeRef.current !== scope ||
        controller.signal.aborted ||
        isAbortError(caught)
      ) {
        return;
      }

      setError(errorMessage(caught, "发布到 GitHub 失败，请稍后重试。"));
    } finally {
      releaseAction(controller);
      publishInFlightRef.current = false;

      if (mountedRef.current && scopeRef.current === scope) {
        setPublishing(false);
      }
    }
  }

  // 同一个按钮节点只在页脚或卡片出现一次；页脚目标尚未挂载时不渲染临时副本。
  const publishButton = (
    <button
      type="button"
      className="site-publish-primary"
      disabled={!availability.canPublish}
      title={availability.canPublish ? undefined : availability.reason}
      onClick={() => void handlePublish()}
    >
      {activeJob
        ? "正在发布…"
        : publishing
          ? "正在提交…"
          : "发布到 GitHub Pages"}
    </button>
  );
  const portalPublishButton =
    actionTarget === undefined
      ? null
      : actionTarget && status?.enabled && status.connected
        ? createPortal(publishButton, actionTarget)
        : null;

  return (
    <section
      className="site-publish-card site-publish-github"
      aria-labelledby={headingId}
      data-site-publish-github={
        loading
          ? "loading"
          : !status
            ? "error"
            : !status.enabled
              ? "unconfigured"
              : status.connected
                ? "connected"
                : "disconnected"
      }
    >
      <header className="site-publish-card-head">
        <h3 id={headingId}>GitHub Pages</h3>
      </header>

      {loading ? (
        <p className="site-publish-github-hint" role="status">
          正在读取 GitHub 发布状态…
        </p>
      ) : null}

      {!loading && !status ? (
        <div className="site-publish-github-actions">
          <p className="site-publish-field-error" role="alert">
            {error || "GitHub 发布状态读取失败，请稍后重试。"}
          </p>
          <button
            type="button"
            className="site-publish-secondary"
            onClick={() => void refreshStatus({ scope: scopeRef.current })}
          >
            重新读取状态
          </button>
        </div>
      ) : null}

      {status && !status.enabled ? (
        <p className="site-publish-github-hint">
          GitHub 发布未配置
        </p>
      ) : null}

      {status && status.enabled && !status.connected ? (
        <div className="site-publish-github-actions">
          <button
            type="button"
            className="site-publish-primary"
            disabled={disabled || connecting || activeJob}
            onClick={() => void handleConnect()}
          >
            {connecting ? "正在打开授权页面…" : "授权 GitHub 仓库"}
          </button>
        </div>
      ) : null}

      {status && status.enabled && status.connected ? (
        <div className="site-publish-github-connected">
          <p className="site-publish-github-account">
            {status.githubLogin
              ? `已连接 GitHub：@${status.githubLogin}`
              : "已连接 GitHub 账号"}
          </p>

          <div className="site-publish-github-repository">
            <label className="site-publish-field" htmlFor={repositorySelectId}>
              <span>发布仓库</span>
              <select
                id={repositorySelectId}
                value={String(selectedRepositoryValue ?? "")}
                disabled={disabled || savingRepository || publishing || activeJob}
                onChange={(event) => void handleRepositoryChange(event)}
              >
                {selectedRepositoryValue === null || !hasSelectedOption ? (
                  <option value={String(selectedRepositoryValue ?? "")}>
                    {status.repository?.fullName ?? "请选择仓库"}
                  </option>
                ) : null}
                {repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.fullName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="site-publish-secondary"
              disabled={disabled || repositoriesLoading || publishing}
              onClick={() => void loadRepositories(scopeRef.current, true)}
            >
              {repositoriesLoading ? "正在读取…" : "刷新仓库"}
            </button>
          </div>

          {repositoriesError ? (
            <p className="site-publish-field-error" role="alert">
              {repositoriesError}
            </p>
          ) : null}

          {!repositoriesLoading && repositories.length === 0 && !repositoriesError ? (
            <p className="site-publish-github-hint">
              没有可发布的仓库，请先授权 GitHub 仓库或授予该仓库访问权限。
            </p>
          ) : null}

          <div className="site-publish-github-actions">
            {actionTarget === undefined ? publishButton : null}
            <button
              type="button"
              className="site-publish-secondary"
              disabled={disabled || connecting || activeJob}
              onClick={() => void handleConnect()}
            >
              {connecting ? "正在打开授权页面…" : "授权更多仓库"}
            </button>
            <button
              type="button"
              className="site-publish-secondary"
              disabled={disabled || disconnecting || activeJob}
              onClick={() => void handleDisconnect()}
            >
              {disconnecting ? "正在断开…" : "断开连接"}
            </button>
          </div>

          {!availability.canPublish && availability.reason ? (
            <p className="site-publish-github-hint">{availability.reason}</p>
          ) : null}
        </div>
      ) : null}

      {job && jobView ? (
        <div
          className="site-publish-github-job"
          role="status"
          aria-live="polite"
          data-github-publish-phase={job.phase}
          data-github-publish-live={jobView.live ? "true" : "false"}
        >
          <strong>{jobView.label}</strong>
          {job.message && job.message !== jobView.label ? (
            <p>{job.message}</p>
          ) : null}
          {countsText ? (
            <p className="site-publish-github-counts">{countsText}</p>
          ) : null}
          {siteUrl || commitUrl ? (
            <p className="site-publish-github-links">
              {siteUrl ? (
                <a href={siteUrl} target="_blank" rel="noreferrer noopener">
                  访问站点
                </a>
              ) : null}
              {commitUrl ? (
                <a href={commitUrl} target="_blank" rel="noreferrer noopener">
                  查看提交记录
                </a>
              ) : null}
            </p>
          ) : null}
          {job.phase === "failed" && !job.message ? (
            <p className="site-publish-field-error" role="alert">
              发布失败，请检查授权与仓库设置后重试。
            </p>
          ) : null}
        </div>
      ) : null}

      {error && status ? (
        <p className="site-publish-field-error" role="alert">
          {error}
          {activeJob ? <button type="button" className="site-publish-secondary" onClick={() => void refreshStatus({ scope: scopeRef.current })}>刷新发布状态</button> : null}
        </p>
      ) : null}
      {notice ? (
        <p className="site-publish-notice" role="status">
          {notice}
        </p>
      ) : null}
      {portalPublishButton}
    </section>
  );
}
