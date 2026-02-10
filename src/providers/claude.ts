import type { Provider, ProbeResult, MetricLine } from "./types";
import { readJsonFile, writeJsonFile } from "../lib/credentials";
import { refreshTokenJson } from "../lib/oauth";
import { formatPlanLabel } from "../lib/formatting";

const CRED_FILE = "~/.claude/.credentials.json";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiration

interface ClaudeOAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
}

interface ClaudeCredentials {
  claudeAiOauth: ClaudeOAuth;
  [key: string]: unknown;
}

interface UsageWindow {
  utilization: number;
  resets_at?: number;
}

interface ExtraUsage {
  is_enabled?: boolean;
  used_credits?: number;
  monthly_limit?: number;
}

interface UsageResponse {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_sonnet?: UsageWindow;
  extra_usage?: ExtraUsage;
  account_balance?: number;
  [key: string]: unknown; // Catch any additional balance/credit fields
}

function loadCredentials(): { oauth: ClaudeOAuth; fullData: ClaudeCredentials } | null {
  const parsed = readJsonFile<ClaudeCredentials>(CRED_FILE);
  if (!parsed) return null;

  const oauth = parsed.claudeAiOauth;
  if (!oauth?.accessToken) return null;

  return { oauth, fullData: parsed };
}

function needsRefresh(oauth: ClaudeOAuth): boolean {
  if (!oauth.expiresAt) return false;
  return Date.now() + REFRESH_BUFFER_MS >= oauth.expiresAt;
}

async function doRefresh(
  oauth: ClaudeOAuth,
  fullData: ClaudeCredentials
): Promise<string | null> {
  if (!oauth.refreshToken) return null;

  const result = await refreshTokenJson({
    url: REFRESH_URL,
    clientId: CLIENT_ID,
    refreshToken: oauth.refreshToken,
    scope: SCOPES,
  });

  if (!result) return null;

  oauth.accessToken = result.accessToken;
  if (result.refreshToken) oauth.refreshToken = result.refreshToken;
  if (typeof result.expiresIn === "number") {
    oauth.expiresAt = Date.now() + result.expiresIn * 1000;
  }

  fullData.claudeAiOauth = oauth;
  writeJsonFile(CRED_FILE, fullData);

  return result.accessToken;
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "number") {
    // Unix seconds
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

interface ProfileResponse {
  account?: {
    has_claude_max?: boolean;
    has_claude_pro?: boolean;
    [key: string]: unknown;
  };
  organization?: {
    organization_type?: string;
    rate_limit_tier?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function formatDollars(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fetch the actual plan label from the profile API.
 * Falls back to credentials file subscriptionType if profile fetch fails.
 */
async function fetchPlanLabel(accessToken: string, fallback?: string): Promise<string | undefined> {
  try {
    const resp = await fetch(PROFILE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "OpenUsage-Raycast",
      },
    });
    if (!resp.ok) {
      return fallback ? formatPlanLabel(fallback) : undefined;
    }
    const profile = (await resp.json()) as ProfileResponse;

    // Determine plan from organization_type (most reliable)
    const orgType = profile.organization?.organization_type;
    if (orgType) {
      // e.g. "claude_max" → "Max", "claude_pro" → "Pro"
      const cleaned = orgType.replace(/^claude_/, "");
      return formatPlanLabel(cleaned);
    }

    // Fallback: check account flags
    if (profile.account?.has_claude_max) return "Max";
    if (profile.account?.has_claude_pro) return "Pro";

    return fallback ? formatPlanLabel(fallback) : undefined;
  } catch {
    return fallback ? formatPlanLabel(fallback) : undefined;
  }
}

async function probe(): Promise<ProbeResult> {
  const creds = loadCredentials();
  if (!creds) {
    return { lines: [], error: "Not logged in. Run `claude` to authenticate." };
  }

  const { oauth, fullData } = creds;
  let accessToken = oauth.accessToken;

  // Proactively refresh if needed
  if (needsRefresh(oauth)) {
    try {
      const refreshed = await doRefresh(oauth, fullData);
      if (refreshed) accessToken = refreshed;
    } catch {
      // Try with existing token
    }
  }

  // Fetch usage
  let resp: Response;
  try {
    resp = await fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "OpenUsage-Raycast",
      },
    });
  } catch (e) {
    return { lines: [], error: "Usage request failed. Check your connection." };
  }

  // Retry once on 401
  if (resp.status === 401 && oauth.refreshToken) {
    try {
      const refreshed = await doRefresh(oauth, fullData);
      if (refreshed) {
        accessToken = refreshed;
        resp = await fetch(USAGE_URL, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken.trim()}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "OpenUsage-Raycast",
          },
        });
      }
    } catch {
      return { lines: [], error: "Token expired. Run `claude` to log in again." };
    }
  }

  if (resp.status === 401 || resp.status === 403) {
    return { lines: [], error: "Token expired. Run `claude` to log in again." };
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

  // Fetch plan from profile API (runs concurrently with usage parsing)
  const plan = await fetchPlanLabel(accessToken, oauth.subscriptionType);

  if (data.five_hour && typeof data.five_hour.utilization === "number") {
    lines.push({
      type: "progress",
      label: "Session",
      used: data.five_hour.utilization,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: toIso(data.five_hour.resets_at),
      periodDurationMs: 5 * 60 * 60 * 1000,
    });
  }

  if (data.seven_day && typeof data.seven_day.utilization === "number") {
    lines.push({
      type: "progress",
      label: "Weekly",
      used: data.seven_day.utilization,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: toIso(data.seven_day.resets_at),
      periodDurationMs: 7 * 24 * 60 * 60 * 1000,
    });
  }

  if (data.seven_day_sonnet && typeof data.seven_day_sonnet.utilization === "number") {
    lines.push({
      type: "progress",
      label: "Sonnet",
      used: data.seven_day_sonnet.utilization,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: toIso(data.seven_day_sonnet.resets_at),
      periodDurationMs: 7 * 24 * 60 * 60 * 1000,
    });
  }

  if (data.extra_usage?.is_enabled) {
    const usedRaw = data.extra_usage.used_credits;
    const limitRaw = data.extra_usage.monthly_limit;
    if (typeof usedRaw === "number" && typeof limitRaw === "number" && limitRaw > 0) {
      // API returns values in cents — convert to dollars
      const usedDollars = usedRaw / 100;
      const limitDollars = limitRaw / 100;
      lines.push({
        type: "progress",
        label: "Extra usage",
        used: formatDollars(usedDollars),
        limit: formatDollars(limitDollars),
        format: { kind: "dollars" },
      });
    } else if (typeof usedRaw === "number" && usedRaw > 0) {
      lines.push({
        type: "text",
        label: "Extra usage",
        value: `$${formatDollars(usedRaw / 100)}`,
      });
    }
  }

  // Show account balance if available
  if (data.account_balance !== undefined && data.account_balance !== null) {
    const balance = typeof data.account_balance === "number"
      ? data.account_balance / 100  // cents to dollars
      : 0;
    lines.push({
      type: "text",
      label: "Account balance",
      value: `$${formatDollars(balance)}`,
    });
  }

  if (lines.length === 0) {
    lines.push({ type: "badge", label: "Status", text: "No usage data", color: "#a3a3a3" });
  }

  return { plan, lines };
}

export const claude: Provider = {
  id: "claude",
  name: "Claude",
  icon: "claude.svg",
  brandColor: "#D97757",
  probe,
};
