import { LocalStorage } from "@raycast/api";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Data Model ───────────────────────────────────────────────────────

export interface SessionMetric {
  sessionId: string;
  project: string; // full path
  projectName: string; // basename
  durationMin: number;
  model: string; // e.g. "claude-opus-4-6"
  totalInputTokens: number;
  totalOutputTokens: number;
  toolUses: number;
  toolBreakdown: Record<string, number>;
  subAgentsSpawned: number;
  turns: number;
  startedAt: string; // ISO 8601
  endedAt: string; // ISO 8601
}

export interface AggregateStats {
  totalSessions: number;
  totalCodingHours: number;
  avgSessionMin: number;
  modelDistribution: Record<string, number>; // model → percentage
  totalInputTokens: number;
  totalOutputTokens: number;
  mostActiveProjects: Array<{ name: string; sessions: number }>;
  subAgentTotal: number;
}

export interface ProjectStats {
  project: string;
  projectName: string;
  sessions: number;
  totalDurationMin: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  mostUsedModel: string;
  lastActive: string; // ISO 8601
}

// ── Constants ────────────────────────────────────────────────────────

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const CACHE_KEY = "velocity:sessions";
const CACHE_TS_KEY = "velocity:lastScanned";

// ── Helpers ──────────────────────────────────────────────────────────

function decodeDirName(dirName: string): string {
  // "-Users-sven-Desktop-MCP-codeusage" → "/Users/sven/Desktop/MCP/codeusage"
  if (dirName === "-") return "/";
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

function readJsonlFile(filePath: string): unknown[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const records: unknown[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return records;
  } catch {
    return [];
  }
}

interface SessionMessage {
  type: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    model?: string;
    role?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: Array<{ type: string; name?: string }>;
  };
}

function parseSession(
  sessionFile: string,
  projectPath: string,
): SessionMetric | null {
  const records = readJsonlFile(sessionFile) as SessionMessage[];
  if (records.length === 0) return null;

  const sessionId = path.basename(sessionFile, ".jsonl");
  const projectName = path.basename(projectPath) || projectPath;

  let model = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolUses = 0;
  const toolBreakdown: Record<string, number> = {};
  let subAgentsSpawned = 0;
  let turns = 0;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  for (const rec of records) {
    if (rec.timestamp) {
      if (!firstTimestamp) firstTimestamp = rec.timestamp;
      lastTimestamp = rec.timestamp;
    }

    if (rec.type === "assistant") {
      turns++;
      const msg = rec.message;
      if (!msg) continue;

      if (msg.model) {
        model = msg.model;
      }

      if (msg.usage) {
        totalInputTokens +=
          (msg.usage.input_tokens ?? 0) +
          (msg.usage.cache_creation_input_tokens ?? 0) +
          (msg.usage.cache_read_input_tokens ?? 0);
        totalOutputTokens += msg.usage.output_tokens ?? 0;
      }

      if (msg.content && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "tool_use" && block.name) {
            toolUses++;
            toolBreakdown[block.name] = (toolBreakdown[block.name] ?? 0) + 1;
            if (block.name === "Task") {
              subAgentsSpawned++;
            }
          }
        }
      }
    }
  }

  if (turns === 0 || !firstTimestamp || !lastTimestamp) return null;

  const startMs = new Date(firstTimestamp).getTime();
  const endMs = new Date(lastTimestamp).getTime();
  const durationMin = Math.max(1, Math.round((endMs - startMs) / 60000));

  return {
    sessionId,
    project: projectPath,
    projectName,
    durationMin,
    model: model || "unknown",
    totalInputTokens,
    totalOutputTokens,
    toolUses,
    toolBreakdown,
    subAgentsSpawned,
    turns,
    startedAt: firstTimestamp,
    endedAt: lastTimestamp,
  };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Scan ~/.claude/projects/ for session data.
 * Caches results in LocalStorage to avoid re-parsing unchanged files.
 */
export async function scanSessions(): Promise<SessionMetric[]> {
  const cachedRaw = await LocalStorage.getItem<string>(CACHE_KEY);
  const lastScanned = await LocalStorage.getItem<string>(CACHE_TS_KEY);
  let cached: SessionMetric[] = [];
  const seenSessionIds = new Set<string>();

  if (cachedRaw) {
    try {
      cached = JSON.parse(cachedRaw) as SessionMetric[];
      for (const s of cached) seenSessionIds.add(s.sessionId);
    } catch {
      cached = [];
    }
  }

  const lastScanTs = lastScanned ? parseInt(lastScanned, 10) : 0;
  const newSessions: SessionMetric[] = [];

  if (!fs.existsSync(PROJECTS_DIR)) return cached;

  let projDirs: string[];
  try {
    projDirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return cached;
  }

  for (const dirName of projDirs) {
    const dirPath = path.join(PROJECTS_DIR, dirName);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const projectPath = decodeDirName(dirName);

    let files: string[];
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const sessionId = file.replace(".jsonl", "");
      if (seenSessionIds.has(sessionId)) continue;

      const filePath = path.join(dirPath, file);
      let fileStat: fs.Stats;
      try {
        fileStat = fs.statSync(filePath);
      } catch {
        continue;
      }

      // Only parse files modified since last scan (or all if first scan)
      if (lastScanTs > 0 && fileStat.mtimeMs < lastScanTs) continue;

      const metric = parseSession(filePath, projectPath);
      if (metric) {
        newSessions.push(metric);
        seenSessionIds.add(sessionId);
      }
    }
  }

  const allSessions = [...cached, ...newSessions];
  allSessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  await LocalStorage.setItem(CACHE_KEY, JSON.stringify(allSessions));
  await LocalStorage.setItem(CACHE_TS_KEY, String(Date.now()));

  return allSessions;
}

/**
 * Get all scanned sessions (from cache or fresh scan).
 */
export async function getSessionMetrics(): Promise<SessionMetric[]> {
  return scanSessions();
}

/**
 * Aggregate stats across all sessions.
 */
export async function getAggregateStats(): Promise<AggregateStats> {
  const sessions = await getSessionMetrics();

  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      totalCodingHours: 0,
      avgSessionMin: 0,
      modelDistribution: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
      mostActiveProjects: [],
      subAgentTotal: 0,
    };
  }

  const totalMin = sessions.reduce((s, m) => s + m.durationMin, 0);
  const totalCodingHours = Math.round((totalMin / 60) * 10) / 10;
  const avgSessionMin = Math.round(totalMin / sessions.length);

  const modelCounts: Record<string, number> = {};
  for (const s of sessions) {
    modelCounts[s.model] = (modelCounts[s.model] ?? 0) + 1;
  }
  const modelDistribution: Record<string, number> = {};
  for (const [model, count] of Object.entries(modelCounts)) {
    modelDistribution[model] = Math.round((count / sessions.length) * 100);
  }

  const totalInputTokens = sessions.reduce((s, m) => s + m.totalInputTokens, 0);
  const totalOutputTokens = sessions.reduce(
    (s, m) => s + m.totalOutputTokens,
    0,
  );

  const projectCounts: Record<string, number> = {};
  for (const s of sessions) {
    projectCounts[s.projectName] = (projectCounts[s.projectName] ?? 0) + 1;
  }
  const mostActiveProjects = Object.entries(projectCounts)
    .map(([name, count]) => ({ name, sessions: count }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5);

  const subAgentTotal = sessions.reduce((s, m) => s + m.subAgentsSpawned, 0);

  return {
    totalSessions: sessions.length,
    totalCodingHours,
    avgSessionMin,
    modelDistribution,
    totalInputTokens,
    totalOutputTokens,
    mostActiveProjects,
    subAgentTotal,
  };
}

/**
 * Group sessions by project with per-project totals.
 */
export async function getProjectStats(): Promise<ProjectStats[]> {
  const sessions = await getSessionMetrics();

  const groups: Record<string, SessionMetric[]> = {};
  for (const s of sessions) {
    if (!groups[s.project]) groups[s.project] = [];
    groups[s.project].push(s);
  }

  const stats: ProjectStats[] = [];
  for (const [project, group] of Object.entries(groups)) {
    const modelCounts: Record<string, number> = {};
    for (const s of group) {
      modelCounts[s.model] = (modelCounts[s.model] ?? 0) + 1;
    }
    const mostUsedModel =
      Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "unknown";
    const lastActive = group
      .map((s) => s.endedAt)
      .sort()
      .reverse()[0];

    stats.push({
      project,
      projectName: group[0].projectName,
      sessions: group.length,
      totalDurationMin: group.reduce((s, m) => s + m.durationMin, 0),
      totalInputTokens: group.reduce((s, m) => s + m.totalInputTokens, 0),
      totalOutputTokens: group.reduce((s, m) => s + m.totalOutputTokens, 0),
      mostUsedModel,
      lastActive,
    });
  }

  stats.sort(
    (a, b) =>
      new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime(),
  );
  return stats;
}

/**
 * Force a full re-scan by clearing the cache.
 */
export async function clearVelocityCache(): Promise<void> {
  await LocalStorage.removeItem(CACHE_KEY);
  await LocalStorage.removeItem(CACHE_TS_KEY);
}
