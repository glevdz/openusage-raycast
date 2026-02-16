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
}

// ── Constants ────────────────────────────────────────────────────────

const API_URL = "https://greenai.info/v1/estimate";
const CACHE_KEY = "carbon:summary";
const CACHE_TS_KEY = "carbon:lastFetched";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
        return JSON.parse(cached) as CarbonSummary;
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

  const avgPerSessionG = estimate.emissionsG / sessions.length;

  const summary: CarbonSummary = {
    totalEmissionsG: estimate.emissionsG,
    totalEmissionsKg: estimate.emissionsKg,
    totalEnergyKwh: estimate.energyKwh,
    avgPerSessionG,
    equivalents: {
      treeHours: estimate.emissionsG / 21,
      smartphoneCharges: estimate.emissionsG / 8,
      drivingMeters: estimate.emissionsG * 5,
    },
    sessionCount: sessions.length,
  };

  // Cache result
  await LocalStorage.setItem(CACHE_KEY, JSON.stringify(summary));
  await LocalStorage.setItem(CACHE_TS_KEY, String(Date.now()));

  return summary;
}

// ── Cache Management ─────────────────────────────────────────────────

export async function clearCarbonCache(): Promise<void> {
  await LocalStorage.removeItem(CACHE_KEY);
  await LocalStorage.removeItem(CACHE_TS_KEY);
}
