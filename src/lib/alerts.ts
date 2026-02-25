import { LocalStorage, showHUD } from "@raycast/api";

const ALERT_KEY_PREFIX = "openusage:alerts:";
const THRESHOLDS = [50, 75, 90] as const;

function alertKey(
  providerId: string,
  lineLabel: string,
  resetsAt: string,
): string {
  return `${ALERT_KEY_PREFIX}${providerId}:${lineLabel}:${resetsAt}`;
}

interface FiredAlerts {
  thresholds: number[];
}

/**
 * Check usage against thresholds and fire HUD notifications for newly crossed ones.
 * Thresholds auto-reset when resetsAt changes (new billing window).
 */
export async function checkAndFireAlerts(
  providerId: string,
  lineLabel: string,
  percent: number,
  resetsAt?: string,
): Promise<void> {
  if (!resetsAt) return; // Can't track without a reset window

  const key = alertKey(providerId, lineLabel, resetsAt);
  let fired: FiredAlerts = { thresholds: [] };

  const raw = await LocalStorage.getItem<string>(key);
  if (raw) {
    try {
      fired = JSON.parse(raw) as FiredAlerts;
    } catch {
      fired = { thresholds: [] };
    }
  }

  let changed = false;
  for (const threshold of THRESHOLDS) {
    if (percent >= threshold && !fired.thresholds.includes(threshold)) {
      fired.thresholds.push(threshold);
      changed = true;
      try {
        await showHUD(`${lineLabel} usage hit ${threshold}%`);
      } catch {
        // showHUD may not work in all contexts — silently ignore
      }
    }
  }

  if (changed) {
    await LocalStorage.setItem(key, JSON.stringify(fired));
    await pruneExpiredAlerts();
  }
}

/**
 * Remove alert entries for expired reset windows.
 */
async function pruneExpiredAlerts(): Promise<void> {
  const allItems = await LocalStorage.allItems();
  const now = Date.now();

  for (const key of Object.keys(allItems)) {
    if (!key.startsWith(ALERT_KEY_PREFIX)) continue;

    // Extract resetsAt from key: prefix:providerId:lineLabel:resetsAt
    const parts = key.slice(ALERT_KEY_PREFIX.length).split(":");
    const resetsAt = parts[parts.length - 1];
    if (!resetsAt) continue;

    try {
      const resetTime = new Date(resetsAt).getTime();
      if (!isNaN(resetTime) && resetTime < now) {
        await LocalStorage.removeItem(key);
      }
    } catch {
      // Skip unparseable entries
    }
  }
}
