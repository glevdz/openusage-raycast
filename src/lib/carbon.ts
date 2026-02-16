import { LocalStorage } from "@raycast/api";
import type { SessionMetric } from "./velocity";

// ── Types ────────────────────────────────────────────────────────────

export interface CarbonEstimate {
  emissionsG: number;
  emissionsKg: number;
  energyKwh: number;
  gridIntensity: number;
  confidence: number;
  timestamp: string;
}

export interface CarbonByProject {
  projectName: string;
  project: string;
  emissionsG: number;
  sessions: number;
  durationMin: number;
  gPerSession: number;
}

export interface CarbonByModel {
  model: string;
  emissionsG: number;
  sessions: number;
  durationMin: number;
  gPerMinute: number;
}

export interface CarbonTrend {
  period: string;
  emissionsG: number;
  sessions: number;
}

export interface CarbonBudget {
  monthlyBudgetG: number;
  currentMonthG: number;
  remainingG: number;
  percentUsed: number;
  onTrack: boolean;
  projectedMonthG: number;
}

export interface CarbonSummary {
  totalEmissionsG: number;
  totalEmissionsKg: number;
  totalEnergyKwh: number;
  avgPerSessionG: number;
  equivalents: {
    treeHours: number;
    smartphoneCharges: number;
    drivingMeters: number;
  };
  sessionCount: number;
  byProject: CarbonByProject[];
  byModel: CarbonByModel[];
  dailyTrend: CarbonTrend[];
  weeklyTrend: CarbonTrend[];
  gPer1kTokens: number;
}

// ── Constants ────────────────────────────────────────────────────────

const API_URL = "https://greenai.info/v1/estimate";
const CACHE_KEY = "carbon:summary";
const CACHE_TS_KEY = "carbon:lastFetched";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const BUDGET_KEY = "carbon:monthlyBudgetG";

// ── API Client ───────────────────────────────────────────────────────

export async function estimateSessionCarbon(
  durationMin: number,
): Promise<CarbonEstimate | null> {
  try {
    const latencyMs = Math.round(durationMin * 60000);
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "anthropic",
        region: "us-west-2",
        latency_ms: latencyMs,
        power_watts: 400,
        pue: 1.2,
      }),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      emissions_g: number;
      emissions_kg: number;
      energy_kwh: number;
      grid_intensity_g_kwh: number;
      confidence: number;
      timestamp: string;
    };

    return {
      emissionsG: data.emissions_g,
      emissionsKg: data.emissions_kg,
      energyKwh: data.energy_kwh,
      gridIntensity: data.grid_intensity_g_kwh,
      confidence: data.confidence,
      timestamp: data.timestamp,
    };
  } catch {
    return null;
  }
}

// ── Proportional Breakdown ──────────────────────────────────────────

function buildByProject(
  sessions: SessionMetric[],
  totalDurationMin: number,
  totalEmissionsG: number,
): CarbonByProject[] {
  const groups: Record<
    string,
    {
      projectName: string;
      project: string;
      sessions: number;
      durationMin: number;
    }
  > = {};

  for (const s of sessions) {
    if (!groups[s.project]) {
      groups[s.project] = {
        projectName: s.projectName,
        project: s.project,
        sessions: 0,
        durationMin: 0,
      };
    }
    groups[s.project].sessions++;
    groups[s.project].durationMin += s.durationMin;
  }

  return Object.values(groups)
    .map((g) => {
      const emissionsG =
        totalDurationMin > 0
          ? (g.durationMin / totalDurationMin) * totalEmissionsG
          : 0;
      return {
        ...g,
        emissionsG,
        gPerSession: g.sessions > 0 ? emissionsG / g.sessions : 0,
      };
    })
    .sort((a, b) => b.emissionsG - a.emissionsG);
}

function buildByModel(
  sessions: SessionMetric[],
  totalDurationMin: number,
  totalEmissionsG: number,
): CarbonByModel[] {
  const groups: Record<
    string,
    { model: string; sessions: number; durationMin: number }
  > = {};

  for (const s of sessions) {
    if (!groups[s.model]) {
      groups[s.model] = { model: s.model, sessions: 0, durationMin: 0 };
    }
    groups[s.model].sessions++;
    groups[s.model].durationMin += s.durationMin;
  }

  return Object.values(groups)
    .map((g) => {
      const emissionsG =
        totalDurationMin > 0
          ? (g.durationMin / totalDurationMin) * totalEmissionsG
          : 0;
      return {
        ...g,
        emissionsG,
        gPerMinute: g.durationMin > 0 ? emissionsG / g.durationMin : 0,
      };
    })
    .sort((a, b) => a.gPerMinute - b.gPerMinute); // most efficient first
}

function buildDailyTrend(
  sessions: SessionMetric[],
  totalDurationMin: number,
  totalEmissionsG: number,
): CarbonTrend[] {
  const now = new Date();
  const days: CarbonTrend[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);

    const daySessions = sessions.filter(
      (s) => s.startedAt.slice(0, 10) === dateStr,
    );
    const dayDuration = daySessions.reduce((sum, s) => sum + s.durationMin, 0);
    const dayEmissions =
      totalDurationMin > 0
        ? (dayDuration / totalDurationMin) * totalEmissionsG
        : 0;

    days.push({
      period: dateStr,
      emissionsG: dayEmissions,
      sessions: daySessions.length,
    });
  }

  return days;
}

function buildWeeklyTrend(
  sessions: SessionMetric[],
  totalDurationMin: number,
  totalEmissionsG: number,
): CarbonTrend[] {
  const now = new Date();
  const weeks: CarbonTrend[] = [];

  for (let i = 3; i >= 0; i--) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - i * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);

    const startStr = weekStart.toISOString().slice(0, 10);
    const endStr = weekEnd.toISOString().slice(0, 10);

    const weekSessions = sessions.filter((s) => {
      const d = s.startedAt.slice(0, 10);
      return d >= startStr && d <= endStr;
    });
    const weekDuration = weekSessions.reduce(
      (sum, s) => sum + s.durationMin,
      0,
    );
    const weekEmissions =
      totalDurationMin > 0
        ? (weekDuration / totalDurationMin) * totalEmissionsG
        : 0;

    weeks.push({
      period: `${startStr} to ${endStr}`,
      emissionsG: weekEmissions,
      sessions: weekSessions.length,
    });
  }

  return weeks;
}

// ── Summary with Caching ─────────────────────────────────────────────

export async function getCarbonSummary(
  sessions: SessionMetric[],
): Promise<CarbonSummary | null> {
  if (sessions.length === 0) return null;

  // Check cache
  const lastFetched = await LocalStorage.getItem<string>(CACHE_TS_KEY);
  if (lastFetched && Date.now() - parseInt(lastFetched, 10) < CACHE_TTL_MS) {
    const cached = await LocalStorage.getItem<string>(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as CarbonSummary;
        // Validate cache has new fields; discard stale cache
        if (parsed.byProject && parsed.gPer1kTokens !== undefined) {
          return parsed;
        }
      } catch {
        // fall through to fresh fetch
      }
    }
  }

  // Compute total duration across all sessions
  const totalDurationMin = sessions.reduce((s, m) => s + m.durationMin, 0);

  // Single API call with aggregate latency
  const estimate = await estimateSessionCarbon(totalDurationMin);
  if (!estimate) return null;

  const totalEmissionsG = estimate.emissionsG;
  const avgPerSessionG = totalEmissionsG / sessions.length;

  const totalOutputTokens = sessions.reduce(
    (sum, s) => sum + s.totalOutputTokens,
    0,
  );
  const gPer1kTokens =
    totalOutputTokens > 0 ? totalEmissionsG / (totalOutputTokens / 1000) : 0;

  const summary: CarbonSummary = {
    totalEmissionsG,
    totalEmissionsKg: estimate.emissionsKg,
    totalEnergyKwh: estimate.energyKwh,
    avgPerSessionG,
    equivalents: {
      treeHours: totalEmissionsG / 21,
      smartphoneCharges: totalEmissionsG / 8,
      drivingMeters: totalEmissionsG * 5,
    },
    sessionCount: sessions.length,
    byProject: buildByProject(sessions, totalDurationMin, totalEmissionsG),
    byModel: buildByModel(sessions, totalDurationMin, totalEmissionsG),
    dailyTrend: buildDailyTrend(sessions, totalDurationMin, totalEmissionsG),
    weeklyTrend: buildWeeklyTrend(sessions, totalDurationMin, totalEmissionsG),
    gPer1kTokens,
  };

  // Cache result
  await LocalStorage.setItem(CACHE_KEY, JSON.stringify(summary));
  await LocalStorage.setItem(CACHE_TS_KEY, String(Date.now()));

  return summary;
}

// ── Budget ───────────────────────────────────────────────────────────

export async function setCarbonBudget(grams: number): Promise<void> {
  await LocalStorage.setItem(BUDGET_KEY, String(grams));
}

export async function getCarbonBudgetSetting(): Promise<number | null> {
  const raw = await LocalStorage.getItem<string>(BUDGET_KEY);
  if (!raw) return null;
  const val = parseFloat(raw);
  return isNaN(val) ? null : val;
}

export function getCarbonBudget(
  sessions: SessionMetric[],
  totalEmissionsG: number,
  monthlyBudgetG: number,
): CarbonBudget {
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysInMonth = monthEnd.getDate();
  const dayOfMonth = now.getDate();

  // Filter sessions to current month
  const monthStr = now.toISOString().slice(0, 7); // "YYYY-MM"
  const monthSessions = sessions.filter(
    (s) => s.startedAt.slice(0, 7) === monthStr,
  );

  // Total duration for all sessions vs month sessions
  const totalDuration = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  const monthDuration = monthSessions.reduce(
    (sum, s) => sum + s.durationMin,
    0,
  );

  const currentMonthG =
    totalDuration > 0 ? (monthDuration / totalDuration) * totalEmissionsG : 0;

  const remainingG = Math.max(0, monthlyBudgetG - currentMonthG);
  const percentUsed =
    monthlyBudgetG > 0 ? (currentMonthG / monthlyBudgetG) * 100 : 0;

  // Linear projection: if we've used X in Y days, project for full month
  const projectedMonthG =
    dayOfMonth > 0 ? (currentMonthG / dayOfMonth) * daysInMonth : 0;
  const onTrack = projectedMonthG <= monthlyBudgetG;

  return {
    monthlyBudgetG,
    currentMonthG,
    remainingG,
    percentUsed,
    onTrack,
    projectedMonthG,
  };
}

// ── Export ────────────────────────────────────────────────────────────

export function exportCarbonReport(
  summary: CarbonSummary,
  format: "csv" | "markdown",
): string {
  if (format === "csv") {
    const lines = [
      "Category,Name,Emissions (g),Sessions,Duration (min)",
      `Total,,${summary.totalEmissionsG.toFixed(2)},${summary.sessionCount},`,
      `Efficiency,,${summary.gPer1kTokens.toFixed(4)} g/1K tokens,,`,
      "",
      "By Project",
      ...summary.byProject.map(
        (p) =>
          `Project,${p.projectName},${p.emissionsG.toFixed(2)},${p.sessions},${p.durationMin.toFixed(1)}`,
      ),
      "",
      "By Model",
      ...summary.byModel.map(
        (m) =>
          `Model,${m.model},${m.emissionsG.toFixed(2)},${m.sessions},${m.durationMin.toFixed(1)}`,
      ),
      "",
      "Daily Trend (Last 7 Days)",
      ...summary.dailyTrend.map(
        (d) => `Day,${d.period},${d.emissionsG.toFixed(2)},${d.sessions},`,
      ),
    ];
    return lines.join("\n");
  }

  // Markdown format
  const lines = [
    "# Carbon Impact Report",
    "",
    `**Total Emissions:** ${summary.totalEmissionsKg >= 1 ? `${summary.totalEmissionsKg.toFixed(2)} kg` : `${summary.totalEmissionsG.toFixed(1)} g`} CO2`,
    `**Sessions:** ${summary.sessionCount}`,
    `**Efficiency:** ${summary.gPer1kTokens.toFixed(4)} g/1K tokens`,
    `**Avg Per Session:** ${summary.avgPerSessionG.toFixed(2)} g`,
    "",
    "## Equivalents",
    `- Tree absorption: ${summary.equivalents.treeHours.toFixed(1)} hours`,
    `- Smartphone charges: ${summary.equivalents.smartphoneCharges.toFixed(1)}`,
    `- Driving: ${summary.equivalents.drivingMeters >= 1000 ? `${(summary.equivalents.drivingMeters / 1000).toFixed(1)} km` : `${summary.equivalents.drivingMeters.toFixed(0)} m`}`,
    "",
    "## By Project",
    "| Project | Emissions | Sessions | g/session |",
    "|---------|-----------|----------|-----------|",
    ...summary.byProject.map(
      (p) =>
        `| ${p.projectName} | ${p.emissionsG.toFixed(2)} g | ${p.sessions} | ${p.gPerSession.toFixed(2)} |`,
    ),
    "",
    "## By Model",
    "| Model | Emissions | Sessions | g/min |",
    "|-------|-----------|----------|-------|",
    ...summary.byModel.map(
      (m) =>
        `| ${m.model} | ${m.emissionsG.toFixed(2)} g | ${m.sessions} | ${m.gPerMinute.toFixed(4)} |`,
    ),
    "",
    "## Daily Trend (Last 7 Days)",
    "| Date | Emissions | Sessions |",
    "|------|-----------|----------|",
    ...summary.dailyTrend.map(
      (d) => `| ${d.period} | ${d.emissionsG.toFixed(2)} g | ${d.sessions} |`,
    ),
  ];
  return lines.join("\n");
}

// ── Per-Session Carbon ───────────────────────────────────────────────

export function getSessionCarbon(
  session: SessionMetric,
  sessions: SessionMetric[],
  totalEmissionsG: number,
): number {
  const totalDuration = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  if (totalDuration <= 0) return 0;
  return (session.durationMin / totalDuration) * totalEmissionsG;
}

// ── Cache Management ─────────────────────────────────────────────────

export async function clearCarbonCache(): Promise<void> {
  await LocalStorage.removeItem(CACHE_KEY);
  await LocalStorage.removeItem(CACHE_TS_KEY);
}
