export interface WechatConfiguration {
  appId: string;
  appSecret: string;
  updatedAt: number | null;
}

export interface WechatConnectionStatus {
  configured: boolean;
  connected: boolean;
  connectionError: string | null;
  checkedAt: number | null;
}

export interface SavedWechatConfiguration
  extends WechatConfiguration,
    WechatConnectionStatus {}

interface ErrorPayload {
  error?: string;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
  return payload?.error || fallback;
}

export async function getWechatConfiguration(): Promise<WechatConfiguration> {
  const response = await fetch("/api/wechat/config", {
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "读取公众号配置失败。"));
  }

  return (await response.json()) as WechatConfiguration;
}

export async function saveWechatConfiguration(
  appId: string,
  appSecret: string,
): Promise<SavedWechatConfiguration> {
  const response = await fetch("/api/wechat/config", {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ appId, appSecret }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "保存公众号配置失败。"));
  }

  return (await response.json()) as SavedWechatConfiguration;
}

export async function getWechatConnectionStatus(): Promise<WechatConnectionStatus> {
  const response = await fetch("/api/wechat/status", {
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "检查公众号连接失败。"));
  }

  return (await response.json()) as WechatConnectionStatus;
}
