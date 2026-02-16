import type { Provider, ProbeResult, MetricLine } from "./types";
import {
  readJsonFile,
  writeJsonFile,
  readKeyringPassword,
  writeKeyringPassword,
} from "../lib/credentials";
import { refreshTokenForm } from "../lib/oauth";

const CRED_PATH = "~/.kimi/credentials/kimi-code.json";
const KEYRING_SERVICE = "kimi-code";
const KEYRING_ACCOUNT = "oauth/kimi-code";
const USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const REFRESH_URL = "https://auth.kimi.com/api/oauth/token";
const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const REFRESH_BUFFER_SEC = 5 * 60;

interface KimiCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  token_type?: string;
  [key: string]: unknown;
}

interface LimitWindow {
  duration?: number;
  timeUnit?: string;
  time_unit?: string;
}

interface LimitDetail {
  used?: number;
  limit?: number;
  remaining?: number;
  resetTime?: number;
  reset_at?: number;
  resetAt?: number;
  reset_time?: number;
}

interface LimitItem {
  detail?: LimitDetail;
  window?: LimitWindow;
  used?: number;
  limit?: number;
  remaining?: number;
  resetTime?: number;
  reset_at?: number;
  resetAt?: number;
  reset_time?: number;
}

interface UsageResponse {
  limits?: LimitItem[];
  usage?: {
    used?: number;
    limit?: number;
    remaining?: number;
    resetTime?: number;
    reset_at?: number;
  };
  user?: {
    membership?: {
      level?: string;
    };
  };
}

interface Candidate {
  quota: { used: number; limit: number; resetsAt?: string };
  periodMs: number | null;
}

function readNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function titleCaseWords(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function parsePlanLabel(data: UsageResponse): string | undefined {
  const level = data.user?.membership?.level;
  if (!level) return undefined;
  const cleaned = level.replace(/^LEVEL_/, "").replace(/_/g, " ");
  return titleCaseWords(cleaned) || undefined;
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

function parseWindowPeriodMs(window?: LimitWindow): number | null {
  if (!window) return null;
  const duration = readNumber(window.duration);
  if (duration === null || duration <= 0) return null;

  const unit = String(window.timeUnit || window.time_unit || "").toUpperCase();
  if (unit.includes("MINUTE")) return duration * 60 * 1000;
  if (unit.includes("HOUR")) return duration * 60 * 60 * 1000;
  if (unit.includes("DAY")) return duration * 24 * 60 * 60 * 1000;
  if (unit.includes("SECOND")) return duration * 1000;
  return null;
}

function parseQuota(
  row: LimitDetail | LimitItem | undefined,
): { used: number; limit: number; resetsAt?: string } | null {
  if (!row) return null;

  const limit = readNumber(row.limit);
  if (limit === null || limit <= 0) return null;

  let used = readNumber(row.used);
  if (used === null) {
    const remaining = readNumber(row.remaining);
    if (remaining !== null) {
      used = limit - remaining;
    }
  }
  if (used === null) return null;

  return {
    used,
    limit,
    resetsAt: toIso(
      row.resetTime ??
        (row as LimitDetail).reset_at ??
        (row as LimitDetail).resetAt ??
        (row as LimitDetail).reset_time,
    ),
  };
}

function toPercentUsage(quota: {
  used: number;
  limit: number;
  resetsAt?: string;
}): { used: number; limit: number; resetsAt?: string } | null {
  if (quota.limit <= 0) return null;
  const usedPercent = (quota.used / quota.limit) * 100;
  if (!Number.isFinite(usedPercent)) return null;
  return {
    used: Math.round(Math.max(0, usedPercent) * 10) / 10,
    limit: 100,
    resetsAt: quota.resetsAt,
  };
}

function collectCandidates(data: UsageResponse): Candidate[] {
  const limits = Array.isArray(data.limits) ? data.limits : [];
  const out: Candidate[] = [];

  for (const item of limits) {
    const detail = item.detail ?? item;
    const quota = parseQuota(detail as LimitDetail);
    if (!quota) continue;
    const periodMs = parseWindowPeriodMs(item.window);
    out.push({ quota, periodMs });
  }

  return out;
}

function pickSessionCandidate(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const aKnown = typeof a.periodMs === "number";
    const bKnown = typeof b.periodMs === "number";
    if (aKnown && bKnown)
      return (a.periodMs as number) - (b.periodMs as number);
    if (aKnown) return -1;
    if (bKnown) return 1;
    return 0;
  });
  return sorted[0];
}

function pickLargestByPeriod(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const cur = candidates[i];
    const curMs = typeof cur.periodMs === "number" ? cur.periodMs : -1;
    const bestMs = typeof best.periodMs === "number" ? best.periodMs : -1;
    if (curMs > bestMs) best = cur;
  }
  return best;
}

function sameQuota(a: Candidate | null, b: Candidate | null): boolean {
  if (!a || !b) return false;
  return (
    a.quota.used === b.quota.used &&
    a.quota.limit === b.quota.limit &&
    (a.quota.resetsAt || null) === (b.quota.resetsAt || null)
  );
}

function needsRefresh(creds: KimiCredentials): boolean {
  if (!creds.access_token) return true;
  const expiresAt = readNumber(creds.expires_at);
  if (expiresAt === null) return true;
  const nowSec = Date.now() / 1000;
  return nowSec + REFRESH_BUFFER_SEC >= expiresAt;
}

/** Where did we load credentials from? Determines where to persist after refresh. */
type CredSource = "file" | "keyring";

async function doRefresh(
  creds: KimiCredentials,
  source: CredSource,
): Promise<string | null> {
  if (!creds.refresh_token) return null;

  const result = await refreshTokenForm({
    url: REFRESH_URL,
    clientId: CLIENT_ID,
    refreshToken: creds.refresh_token,
  });

  if (!result) return null;

  creds.access_token = result.accessToken;
  if (result.refreshToken) creds.refresh_token = result.refreshToken;
  if (typeof result.expiresIn === "number") {
    creds.expires_at = Date.now() / 1000 + result.expiresIn;
  }

  // Persist back to the same source
  if (source === "keyring") {
    writeKeyringPassword(
      KEYRING_SERVICE,
      KEYRING_ACCOUNT,
      JSON.stringify(creds),
    );
  } else {
    writeJsonFile(CRED_PATH, creds);
  }
  return creds.access_token;
}

/**
 * Load credentials. Tries JSON file first, then OS keyring.
 */
function loadCredentials(): {
  creds: KimiCredentials;
  source: CredSource;
} | null {
  // 1. Try JSON file
  const fileCreds = readJsonFile<KimiCredentials>(CRED_PATH);
  if (fileCreds && (fileCreds.access_token || fileCreds.refresh_token)) {
    return { creds: fileCreds, source: "file" };
  }

  // 2. Try OS keyring (Kimi CLI uses storage = "keyring" with key = "oauth/kimi-code")
  const keyringJson = readKeyringPassword(KEYRING_SERVICE, KEYRING_ACCOUNT);
  if (keyringJson) {
    try {
      const parsed = JSON.parse(keyringJson) as KimiCredentials;
      if (parsed && (parsed.access_token || parsed.refresh_token)) {
        return { creds: parsed, source: "keyring" };
      }
    } catch {
      // Invalid JSON in keyring
    }
  }

  return null;
}

async function probe(): Promise<ProbeResult> {
  const loaded = loadCredentials();
  if (!loaded) {
    return {
      lines: [],
      error: "Not logged in. Run `kimi login` to authenticate.",
    };
  }

  const { creds, source } = loaded;
  let accessToken = creds.access_token || "";

  // Proactively refresh if needed
  if (needsRefresh(creds)) {
    try {
      const refreshed = await doRefresh(creds, source);
      if (refreshed) {
        accessToken = refreshed;
      } else if (!accessToken) {
        return {
          lines: [],
          error: "Token refresh failed and no access token available.",
        };
      }
    } catch (e) {
      if (!accessToken) {
        return {
          lines: [],
          error: `Token refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
  }

  // Fetch usage
  let resp: Response;
  try {
    resp = await fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "OpenUsage-Raycast",
      },
    });
  } catch (e) {
    return {
      lines: [],
      error: `Network error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Retry once on 401
  if (resp.status === 401 && creds.refresh_token) {
    try {
      const refreshed = await doRefresh(creds, source);
      if (refreshed) {
        accessToken = refreshed;
        resp = await fetch(USAGE_URL, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "User-Agent": "OpenUsage-Raycast",
          },
        });
      }
    } catch (e) {
      return {
        lines: [],
        error: `Token refresh failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  if (resp.status === 401 || resp.status === 403) {
    return {
      lines: [],
      error: `Auth failed (HTTP ${resp.status}). Token may be expired.`,
    };
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
  const candidates = collectCandidates(data);
  const sessionCandidate = pickSessionCandidate(candidates);

  let weeklyCandidate: Candidate | null = null;
  const usageQuota = data.usage
    ? parseQuota(data.usage as unknown as LimitDetail)
    : null;
  if (usageQuota) {
    weeklyCandidate = { quota: usageQuota, periodMs: null };
  } else {
    const withoutSession = candidates.filter((c) => c !== sessionCandidate);
    weeklyCandidate = pickLargestByPeriod(withoutSession);
  }

  if (sessionCandidate) {
    const sessionPercent = toPercentUsage(sessionCandidate.quota);
    if (sessionPercent) {
      lines.push({
        type: "progress",
        label: "Session",
        used: sessionPercent.used,
        limit: sessionPercent.limit,
        format: { kind: "percent" },
        resetsAt: sessionPercent.resetsAt,
        periodDurationMs:
          typeof sessionCandidate.periodMs === "number"
            ? sessionCandidate.periodMs
            : undefined,
      });
    }
  }

  if (weeklyCandidate && !sameQuota(weeklyCandidate, sessionCandidate)) {
    const weeklyPercent = toPercentUsage(weeklyCandidate.quota);
    if (weeklyPercent) {
      lines.push({
        type: "progress",
        label: "Weekly",
        used: weeklyPercent.used,
        limit: weeklyPercent.limit,
        format: { kind: "percent" },
        resetsAt: weeklyPercent.resetsAt,
        periodDurationMs:
          typeof weeklyCandidate.periodMs === "number"
            ? weeklyCandidate.periodMs
            : undefined,
      });
    }
  }

  if (lines.length === 0) {
    lines.push({
      type: "badge",
      label: "Status",
      text: "No usage data",
      color: "#a3a3a3",
    });
  }

  return {
    plan: parsePlanLabel(data),
    lines,
  };
}

export const kimi: Provider = {
  id: "kimi",
  name: "Kimi",
  icon: "kimi.svg",
  brandColor: "#6366F1",
  probe,
};
