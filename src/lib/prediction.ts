import type { UsageSnapshot } from "./history";

export type PaceLabel = "ahead" | "on track" | "behind" | "idle" | "at limit";

export interface Prediction {
  burnRate: number; // %/hr
  timeToLimitMs: number | null; // ms until 100%, null if idle/decreasing
  paceLabel: PaceLabel;
}

const REGRESSION_WINDOW = 12; // last ~12 snapshots (~1 hour at 5-min intervals)

/**
 * Simple linear regression: returns slope (change per ms) and intercept.
 */
function linearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const n = points.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Calculate prediction from usage snapshots.
 * Returns null if insufficient data (<2 points).
 */
export function calculatePrediction(
  snapshots: UsageSnapshot[],
  currentPercent: number,
  periodDurationMs?: number,
): Prediction | null {
  if (snapshots.length < 2) return null;

  // Use last N snapshots for regression
  const recent = snapshots.slice(-REGRESSION_WINDOW);
  const points = recent.map((s) => ({ x: s.timestamp, y: s.percent }));

  const { slope } = linearRegression(points);

  // slope is %/ms → convert to %/hr
  const burnRate = slope * 3600000;

  // Already at limit
  if (currentPercent >= 99) {
    return { burnRate, timeToLimitMs: null, paceLabel: "at limit" };
  }

  // Time to limit
  let timeToLimitMs: number | null = null;
  if (burnRate > 0.01) {
    // meaningful positive rate
    timeToLimitMs = ((100 - currentPercent) / burnRate) * 3600000;
  }

  // Pace label: compare burn rate to sustainable rate
  let paceLabel: PaceLabel;
  if (Math.abs(burnRate) < 0.1) {
    paceLabel = "idle";
  } else if (periodDurationMs) {
    const periodHours = periodDurationMs / 3600000;
    const sustainableRate = 100 / periodHours;
    const ratio = burnRate / sustainableRate;
    if (ratio >= 1.5) {
      paceLabel = "ahead";
    } else if (ratio >= 0.5) {
      paceLabel = "on track";
    } else {
      paceLabel = "behind";
    }
  } else {
    // No period info — just use rate magnitude
    paceLabel = burnRate > 5 ? "ahead" : burnRate > 0.5 ? "on track" : "behind";
  }

  return { burnRate, timeToLimitMs, paceLabel };
}
