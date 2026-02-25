import { LocalStorage } from "@raycast/api";

export interface UsageSnapshot {
  timestamp: number;
  percent: number;
  resetsAt?: string;
}

const KEY_PREFIX = "openusage:history:";
const MAX_ENTRIES = 288; // 24h at 5-min intervals
const DEDUP_MS = 2 * 60 * 1000; // 2-minute dedup guard

function storageKey(providerId: string, lineLabel: string): string {
  return `${KEY_PREFIX}${providerId}:${lineLabel}`;
}

/**
 * Load snapshots for a given provider + metric line.
 */
export async function getSnapshots(
  providerId: string,
  lineLabel: string,
): Promise<UsageSnapshot[]> {
  const raw = await LocalStorage.getItem<string>(
    storageKey(providerId, lineLabel),
  );
  if (!raw) return [];
  try {
    return JSON.parse(raw) as UsageSnapshot[];
  } catch {
    return [];
  }
}

/**
 * Add a snapshot. Auto-clears on new reset window and deduplicates rapid writes.
 */
export async function addSnapshot(
  providerId: string,
  lineLabel: string,
  percent: number,
  resetsAt?: string,
): Promise<void> {
  const key = storageKey(providerId, lineLabel);
  let snapshots = await getSnapshots(providerId, lineLabel);

  // If resetsAt changed, the billing window rolled over — clear history
  if (
    resetsAt &&
    snapshots.length > 0 &&
    snapshots[0].resetsAt &&
    snapshots[0].resetsAt !== resetsAt
  ) {
    snapshots = [];
  }

  // Dedup guard: skip if last snapshot was < 2 minutes ago
  if (snapshots.length > 0) {
    const last = snapshots[snapshots.length - 1];
    if (Date.now() - last.timestamp < DEDUP_MS) {
      return;
    }
  }

  snapshots.push({ timestamp: Date.now(), percent, resetsAt });

  // Trim to rolling window
  if (snapshots.length > MAX_ENTRIES) {
    snapshots = snapshots.slice(snapshots.length - MAX_ENTRIES);
  }

  await LocalStorage.setItem(key, JSON.stringify(snapshots));
}
