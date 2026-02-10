import { Color } from "@raycast/api";
import type { MetricLine, ProgressLine } from "../providers/types";

/**
 * Format a usage percentage for display.
 */
export function formatPercent(used: number, limit: number): string {
  if (limit === 0) return "0%";
  const pct = (used / limit) * 100;
  return `${Math.round(pct)}%`;
}

/**
 * Format a dollar amount.
 */
export function formatDollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Format a count with suffix.
 */
export function formatCount(used: number, limit: number, suffix: string): string {
  return `${Math.round(used)}/${Math.round(limit)} ${suffix}`;
}

/**
 * Format a metric line's value for display.
 */
export function formatLineValue(line: MetricLine): string {
  switch (line.type) {
    case "progress": {
      if (line.format.kind === "percent") {
        return formatPercent(line.used, line.limit);
      }
      if (line.format.kind === "dollars") {
        return `${formatDollars(line.used)} / ${formatDollars(line.limit)}`;
      }
      if (line.format.kind === "count") {
        return formatCount(line.used, line.limit, line.format.suffix);
      }
      return `${line.used}/${line.limit}`;
    }
    case "text":
      return line.value;
    case "badge":
      return line.text;
  }
}

/**
 * Format a reset time as a human-readable string.
 */
export function formatResetTime(isoString: string): string {
  const resetDate = new Date(isoString);
  const now = Date.now();
  const diffMs = resetDate.getTime() - now;

  if (diffMs <= 0) return "now";

  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffDays > 0) {
    const remainHr = diffHr % 24;
    return remainHr > 0 ? `in ${diffDays}d ${remainHr}h` : `in ${diffDays}d`;
  }
  if (diffHr > 0) {
    const remainMin = diffMin % 60;
    return remainMin > 0 ? `in ${diffHr}h ${remainMin}m` : `in ${diffHr}h`;
  }
  return `in ${diffMin}m`;
}

/**
 * Get a Raycast Color based on usage percentage.
 */
export function getUsageColor(used: number, limit: number): Color {
  if (limit === 0) return Color.SecondaryText;
  const pct = (used / limit) * 100;
  if (pct >= 90) return Color.Red;
  if (pct >= 70) return Color.Orange;
  if (pct >= 50) return Color.Yellow;
  return Color.Green;
}

/**
 * Get a usage percentage from a progress line (0-100).
 */
export function getUsagePercent(line: ProgressLine): number {
  if (line.limit === 0) return 0;
  return (line.used / line.limit) * 100;
}

/**
 * Get the highest usage percentage from all provider results.
 */
export function getHighestUsage(
  results: Array<{ lines: MetricLine[] }>
): { percent: number; label: string } | null {
  let highest: { percent: number; label: string } | null = null;

  for (const result of results) {
    for (const line of result.lines) {
      if (line.type === "progress" && line.format.kind === "percent") {
        const pct = getUsagePercent(line);
        if (!highest || pct > highest.percent) {
          highest = { percent: pct, label: `${Math.round(pct)}%` };
        }
      }
    }
  }

  return highest;
}

/**
 * Title-case a string (for plan labels).
 */
export function titleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Format a plan label from raw API values.
 */
export function formatPlanLabel(raw: string): string {
  // Common patterns: "pro", "plus", "max_plus", "LEVEL_PREMIUM"
  const cleaned = raw
    .replace(/^LEVEL_/, "")
    .replace(/_/g, " ");
  return titleCase(cleaned);
}
