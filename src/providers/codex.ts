import type { Provider, ProbeResult, MetricLine } from "./types";
import { readJsonFile, writeJsonFile } from "../lib/credentials";
import { refreshTokenForm } from "../lib/oauth";
import { formatPlanLabel } from "../lib/formatting";

const AUTH_PATHS = ["~/.config/codex/auth.json", "~/.codex/auth.json"];
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_URL = "https://auth.openai.com/oauth/token";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_AGE_MS = 8 * 24 * 60 * 60 * 1000; // 8 days

const PERIOD_SESSION_MS = 5 * 60 * 60 * 1000; // 5 hours
const PERIOD_WEEKLY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CodexTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  account_id?: string;
}

interface CodexAuth {
  tokens?: CodexTokens;
  last_refresh?: string;
  OPENAI_API_KEY?: string;
  [key: string]: unknown;
}

interface RateWindow {
  used_percent?: number;
  reset_at?: number;
  reset_after_seconds?: number;
}

interface UsageResponse {
  rate_limit?: {
    primary_window?: RateWindow;
    secondary_window?: RateWindow;
  };
  code_review_rate_limit?: {
    primary_window?: RateWindow;
  };
  credits?: {
    balance?: number;
  };
  plan_type?: string;
}

function loadAuth(): { auth: CodexAuth; authPath: string | null } | null {
  for (const authPath of AUTH_PATHS) {
    const auth = readJsonFile<CodexAuth>(authPath);
    if (auth && auth.tokens?.access_token) {
      return { auth, authPath };
    }
  }

  // Check CODEX_HOME env
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) {
    const customPath = `${codexHome}/auth.json`;
    const auth = readJsonFile<CodexAuth>(customPath);
    if (auth && auth.tokens?.access_token) {
      return { auth, authPath: customPath };
    }
  }

  return null;
}

function needsRefresh(auth: CodexAuth): boolean {
  if (!auth.last_refresh) return true;
  const lastMs = new Date(auth.last_refresh).getTime();
  if (isNaN(lastMs)) return true;
  return Date.now() - lastMs > REFRESH_AGE_MS;
}

async function doRefresh(
  auth: CodexAuth,
  authPath: string | null
): Promise<string | null> {
  if (!auth.tokens?.refresh_token) return null;

  const result = await refreshTokenForm({
    url: REFRESH_URL,
    clientId: CLIENT_ID,
    refreshToken: auth.tokens.refresh_token,
  });

  if (!result) return null;

  auth.tokens.access_token = result.accessToken;
  if (result.refreshToken) auth.tokens.refresh_token = result.refreshToken;
  if (result.idToken) auth.tokens.id_token = result.idToken;
  auth.last_refresh = new Date().toISOString();

  if (authPath) {
    writeJsonFile(authPath, auth);
  }

  return result.accessToken;
}

function readPercent(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "number") {
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

function getResetsAtIso(nowSec: number, window?: RateWindow): string | undefined {
  if (!window) return undefined;
  if (typeof window.reset_at === "number") {
    return toIso(window.reset_at);
  }
  if (typeof window.reset_after_seconds === "number") {
    return toIso(nowSec + window.reset_after_seconds);
  }
  return undefined;
}

async function probe(): Promise<ProbeResult> {
  const authState = loadAuth();
  if (!authState) {
    return { lines: [], error: "Not logged in. Run `codex` to authenticate." };
  }

  const { auth, authPath } = authState;

  if (!auth.tokens?.access_token) {
    if (auth.OPENAI_API_KEY) {
      return { lines: [], error: "Usage not available for API key." };
    }
    return { lines: [], error: "Not logged in. Run `codex` to authenticate." };
  }

  let accessToken = auth.tokens.access_token;
  const accountId = auth.tokens.account_id;

  // Proactively refresh if needed
  if (needsRefresh(auth)) {
    try {
      const refreshed = await doRefresh(auth, authPath);
      if (refreshed) accessToken = refreshed;
    } catch {
      // Try with existing token
    }
  }

  // Fetch usage
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "OpenUsage-Raycast",
  };
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  let resp: Response;
  try {
    resp = await fetch(USAGE_URL, { method: "GET", headers });
  } catch {
    return { lines: [], error: "Usage request failed. Check your connection." };
  }

  // Retry once on 401
  if (resp.status === 401 && auth.tokens.refresh_token) {
    try {
      const refreshed = await doRefresh(auth, authPath);
      if (refreshed) {
        accessToken = refreshed;
        headers.Authorization = `Bearer ${accessToken}`;
        resp = await fetch(USAGE_URL, { method: "GET", headers });
      }
    } catch {
      return { lines: [], error: "Token expired. Run `codex` to log in again." };
    }
  }

  if (resp.status === 401 || resp.status === 403) {
    return { lines: [], error: "Token expired. Run `codex` to log in again." };
  }

  if (!resp.ok) {
    return { lines: [], error: `Usage request failed (HTTP ${resp.status}).` };
  }

  let data: UsageResponse;
  try {
    data = (await resp.json()) as UsageResponse;
  } catch {
    return { lines: [], error: "Usage response invalid." };
  }

  const lines: MetricLine[] = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const rateLimit = data.rate_limit;
  const primaryWindow = rateLimit?.primary_window;
  const secondaryWindow = rateLimit?.secondary_window;
  const reviewWindow = data.code_review_rate_limit?.primary_window;

  // Try headers first
  const headerPrimary = readPercent(resp.headers.get("x-codex-primary-used-percent"));
  const headerSecondary = readPercent(resp.headers.get("x-codex-secondary-used-percent"));

  if (headerPrimary !== null) {
    lines.push({
      type: "progress",
      label: "Session",
      used: headerPrimary,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: getResetsAtIso(nowSec, primaryWindow),
      periodDurationMs: PERIOD_SESSION_MS,
    });
  }

  if (headerSecondary !== null) {
    lines.push({
      type: "progress",
      label: "Weekly",
      used: headerSecondary,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: getResetsAtIso(nowSec, secondaryWindow),
      periodDurationMs: PERIOD_WEEKLY_MS,
    });
  }

  // Fallback to response body
  if (lines.length === 0 && rateLimit) {
    if (primaryWindow && typeof primaryWindow.used_percent === "number") {
      lines.push({
        type: "progress",
        label: "Session",
        used: primaryWindow.used_percent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: getResetsAtIso(nowSec, primaryWindow),
        periodDurationMs: PERIOD_SESSION_MS,
      });
    }
    if (secondaryWindow && typeof secondaryWindow.used_percent === "number") {
      lines.push({
        type: "progress",
        label: "Weekly",
        used: secondaryWindow.used_percent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: getResetsAtIso(nowSec, secondaryWindow),
        periodDurationMs: PERIOD_WEEKLY_MS,
      });
    }
  }

  // Code review rate limit
  if (reviewWindow && typeof reviewWindow.used_percent === "number") {
    lines.push({
      type: "progress",
      label: "Reviews",
      used: reviewWindow.used_percent,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: getResetsAtIso(nowSec, reviewWindow),
      periodDurationMs: PERIOD_WEEKLY_MS,
    });
  }

  // Credits — only show if user actually has some
  const creditsBalance = readNumber(resp.headers.get("x-codex-credits-balance"));
  const creditsData = data.credits ? readNumber(data.credits.balance) : null;
  const creditsRemaining = creditsBalance ?? creditsData;
  if (creditsRemaining !== null && creditsRemaining > 0) {
    lines.push({
      type: "text",
      label: "Credits",
      value: `${Math.round(creditsRemaining)} remaining`,
    });
  }

  let plan: string | undefined;
  if (data.plan_type) {
    plan = formatPlanLabel(data.plan_type);
  }

  if (lines.length === 0) {
    lines.push({ type: "badge", label: "Status", text: "No usage data", color: "#a3a3a3" });
  }

  return { plan, lines };
}

export const codex: Provider = {
  id: "codex",
  name: "Codex",
  icon: "codex.svg",
  brandColor: "#10A37F",
  probe,
};
