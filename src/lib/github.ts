import { LocalStorage } from "@raycast/api";
import { execSync } from "child_process";
import type { ProjectStats } from "./velocity";

// ── Data Model ───────────────────────────────────────────────────────

export interface RepoMetric {
  name: string;
  owner: string;
  url: string;
  primaryLanguage: string;
  languages: Record<string, number>; // language → bytes
  sizeKB: number;
  openIssues: number;
  createdAt: string;
  pushedAt: string;
  commitCount: number; // last 90 days
  commitVelocity: number; // commits per week
}

export interface EnrichedRepo extends RepoMetric {
  matchedProject: ProjectStats | null;
}

export interface RepoEstimate {
  complexityScore: number; // 0-1
  estimatedSessionsRemaining: number;
  estimatedMinutesRemaining: number;
  basedOnSessions: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

const CACHE_KEY = "github:repos";
const CACHE_TS_KEY = "github:lastScanned";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ── Helpers ──────────────────────────────────────────────────────────

function execGh(args: string): string | null {
  try {
    return execSync(`gh ${args}`, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

interface GhRepoListItem {
  name: string;
  owner: { login: string };
  url: string;
  primaryLanguage?: { name: string } | null;
  languages?: Array<{ node: { name: string }; size: number }>;
  diskUsage: number;
  pushedAt: string;
  createdAt: string;
}

function getCommitCount(owner: string, name: string): number {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // Use search API to get commit count efficiently
  const raw = execGh(
    `api "repos/${owner}/${name}/commits?per_page=1&since=${since}" --include 2>&1`,
  );
  if (!raw) return 0;

  // Parse Link header for last page number to get total count
  const linkMatch = raw.match(/page=(\d+)>; rel="last"/);
  if (linkMatch) return parseInt(linkMatch[1], 10);

  // If no Link header, check if there's at least one result
  // (single page means count <= per_page)
  try {
    const body = raw.split("\n\n").pop() || raw;
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Scan GitHub repos via `gh` CLI.
 * Caches in LocalStorage, re-scans every 30 min max.
 */
export async function scanRepos(): Promise<RepoMetric[]> {
  // Check cache
  const cachedRaw = await LocalStorage.getItem<string>(CACHE_KEY);
  const lastScanned = await LocalStorage.getItem<string>(CACHE_TS_KEY);
  const lastScanTs = lastScanned ? parseInt(lastScanned, 10) : 0;

  if (cachedRaw && Date.now() - lastScanTs < CACHE_TTL_MS) {
    try {
      return JSON.parse(cachedRaw) as RepoMetric[];
    } catch {
      // fall through to re-scan
    }
  }

  // Fetch repo list
  const raw = execGh(
    "repo list --limit 50 --json name,owner,url,primaryLanguage,languages,diskUsage,pushedAt,createdAt",
  );
  if (!raw) return cachedRaw ? (JSON.parse(cachedRaw) as RepoMetric[]) : [];

  let items: GhRepoListItem[];
  try {
    items = JSON.parse(raw) as GhRepoListItem[];
  } catch {
    return [];
  }

  const repos: RepoMetric[] = items.map((item) => {
    const languages: Record<string, number> = {};
    if (item.languages) {
      for (const lang of item.languages) {
        languages[lang.node.name] = lang.size;
      }
    }

    const commitCount = getCommitCount(item.owner.login, item.name);
    const commitVelocity = Math.round((commitCount / 13) * 10) / 10; // 90 days ~ 13 weeks

    return {
      name: item.name,
      owner: item.owner.login,
      url: item.url,
      primaryLanguage: item.primaryLanguage?.name ?? "Unknown",
      languages,
      sizeKB: item.diskUsage,
      openIssues: 0, // not available in list, would need per-repo call
      createdAt: item.createdAt,
      pushedAt: item.pushedAt,
      commitCount,
      commitVelocity,
    };
  });

  // Sort by most recently pushed
  repos.sort(
    (a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
  );

  // Cache
  await LocalStorage.setItem(CACHE_KEY, JSON.stringify(repos));
  await LocalStorage.setItem(CACHE_TS_KEY, String(Date.now()));

  return repos;
}

/**
 * Match repos to session projects using heuristic name matching.
 */
export function matchReposToSessions(
  repos: RepoMetric[],
  projects: ProjectStats[],
): EnrichedRepo[] {
  return repos.map((repo) => {
    const repoLower = repo.name.toLowerCase();
    const matched = projects.find((p) => {
      const projLower = p.projectName.toLowerCase();
      return (
        projLower === repoLower ||
        projLower.includes(repoLower) ||
        repoLower.includes(projLower)
      );
    });
    return { ...repo, matchedProject: matched ?? null };
  });
}

/**
 * Generate a complexity-based estimate for a repo.
 */
export function getRepoEstimate(repo: EnrichedRepo): RepoEstimate {
  // Complexity score: 0-1 based on size, languages, and activity
  const langCount = Object.keys(repo.languages).length;
  const sizeScore = Math.min(repo.sizeKB / 100_000, 1); // 100MB = 1.0
  const langScore = Math.min(langCount / 10, 1); // 10 languages = 1.0
  const activityScore = Math.min(repo.commitVelocity / 20, 1); // 20 commits/week = 1.0
  const complexityScore =
    Math.round(
      (sizeScore * 0.4 + langScore * 0.3 + activityScore * 0.3) * 100,
    ) / 100;

  if (repo.matchedProject) {
    // Use actual session data
    const avgSessionMin =
      repo.matchedProject.totalDurationMin / repo.matchedProject.sessions;
    const estimatedSessionsRemaining = Math.max(
      1,
      Math.ceil(complexityScore * 10),
    );
    return {
      complexityScore,
      estimatedSessionsRemaining,
      estimatedMinutesRemaining: Math.round(
        avgSessionMin * estimatedSessionsRemaining,
      ),
      basedOnSessions: true,
    };
  }

  // Default estimate based on complexity
  const baseSessionsEstimate = Math.ceil(complexityScore * 20) + 2;
  const defaultAvgSessionMin = 45; // 45 min default
  return {
    complexityScore,
    estimatedSessionsRemaining: baseSessionsEstimate,
    estimatedMinutesRemaining: baseSessionsEstimate * defaultAvgSessionMin,
    basedOnSessions: false,
  };
}

/**
 * Clear the GitHub repo cache.
 */
export async function clearGithubCache(): Promise<void> {
  await LocalStorage.removeItem(CACHE_KEY);
  await LocalStorage.removeItem(CACHE_TS_KEY);
}
