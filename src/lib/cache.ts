import { Cache } from "@raycast/api";
import type { ProbeResult } from "../providers/types";

const cache = new Cache();

const CACHE_KEY_PREFIX = "openusage:provider:";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  result: ProbeResult;
  timestamp: number;
}

/**
 * Get a cached probe result for a provider.
 */
export function getCachedResult(providerId: string): ProbeResult | null {
  const key = CACHE_KEY_PREFIX + providerId;
  const raw = cache.get(key);
  if (!raw) return null;

  try {
    const entry = JSON.parse(raw) as CacheEntry;
    // Return cached data even if stale (stale-while-revalidate pattern)
    return entry.result;
  } catch {
    return null;
  }
}

/**
 * Check if cache is fresh (within TTL).
 */
export function isCacheFresh(providerId: string): boolean {
  const key = CACHE_KEY_PREFIX + providerId;
  const raw = cache.get(key);
  if (!raw) return false;

  try {
    const entry = JSON.parse(raw) as CacheEntry;
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Store a probe result in the cache.
 */
export function setCachedResult(providerId: string, result: ProbeResult): void {
  const key = CACHE_KEY_PREFIX + providerId;
  const entry: CacheEntry = {
    result,
    timestamp: Date.now(),
  };
  cache.set(key, JSON.stringify(entry));
}

/**
 * Clear all cached results.
 */
export function clearCache(): void {
  cache.clear();
}
