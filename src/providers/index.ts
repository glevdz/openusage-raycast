import { claude } from "./claude";
import { codex } from "./codex";
import { kimi } from "./kimi";
import type { Provider, ProbeResult } from "./types";

export const providers: Provider[] = [claude, codex, kimi];

export interface ProviderWithResult {
  provider: Provider;
  result: ProbeResult;
}

/**
 * Probe all providers in parallel. Each provider is independent —
 * if one fails, others still return results.
 */
export async function probeAll(): Promise<ProviderWithResult[]> {
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      try {
        const result = await provider.probe();
        return { provider, result };
      } catch (e) {
        return {
          provider,
          result: {
            lines: [],
            error: e instanceof Error ? e.message : String(e),
          } as ProbeResult,
        };
      }
    })
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<ProviderWithResult> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);
}

export type { Provider, ProbeResult, MetricLine } from "./types";
