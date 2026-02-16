import React from "react";
import { Icon, launchCommand, LaunchType, MenuBarExtra } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { probeAll, type ProviderWithResult } from "./providers";
import { setCachedResult } from "./lib/cache";
import { formatBurnRate, formatLineValue, formatTimeToLimit, getHighestUsage, getPaceIcon, getUsageColor, getUsagePercent } from "./lib/formatting";
import { addSnapshot, getSnapshots } from "./lib/history";
import { calculatePrediction, type Prediction } from "./lib/prediction";
import { checkAndFireAlerts } from "./lib/alerts";

type PredictionKey = string;
type PredictionMap = Map<PredictionKey, Prediction>;

function predKey(providerId: string, lineLabel: string): PredictionKey {
  return `${providerId}:${lineLabel}`;
}

function getMenuBarTitle(results: ProviderWithResult[]): string {
  const validResults = results
    .filter((r) => !r.result.error)
    .map((r) => r.result);

  const highest = getHighestUsage(validResults);
  if (highest) {
    return highest.label;
  }
  return "—";
}

function getMenuBarIcon(results: ProviderWithResult[]): Icon {
  const validResults = results.filter((r) => !r.result.error).map((r) => r.result);
  const highest = getHighestUsage(validResults);

  if (!highest) return Icon.BarChart;
  if (highest.percent >= 90) return Icon.ExclamationMark;
  if (highest.percent >= 70) return Icon.Warning;
  return Icon.BarChart;
}

export default function MenuBar() {
  const { data, isLoading, revalidate } = useCachedPromise(
    async () => {
      const results = await probeAll();
      const predictions: PredictionMap = new Map();

      for (const { provider, result } of results) {
        setCachedResult(provider.id, result);

        // Record snapshots and fire alerts for progress lines
        for (const line of result.lines) {
          if (line.type !== "progress" || line.format.kind !== "percent") continue;

          const percent = getUsagePercent(line);

          // Record snapshot (dedup guard inside)
          await addSnapshot(provider.id, line.label, percent, line.resetsAt);

          // Fire threshold alerts
          await checkAndFireAlerts(provider.id, line.label, percent, line.resetsAt);

          // Calculate prediction
          const snapshots = await getSnapshots(provider.id, line.label);
          const pred = calculatePrediction(snapshots, percent, line.periodDurationMs);
          if (pred) {
            predictions.set(predKey(provider.id, line.label), pred);
          }
        }
      }

      return { results, predictions };
    },
    [],
    {
      initialData: undefined,
      keepPreviousData: true,
    }
  );

  const results: ProviderWithResult[] = data?.results ?? [];
  const predictions: PredictionMap = data?.predictions ?? new Map();

  const title = results.length > 0 ? getMenuBarTitle(results) : undefined;
  const icon = results.length > 0 ? getMenuBarIcon(results) : Icon.BarChart;

  return (
    <MenuBarExtra icon={icon} title={title} isLoading={isLoading} tooltip="OpenUsage — AI Usage Tracker">
      {results.map(({ provider, result }) => (
        <MenuBarExtra.Section
          key={provider.id}
          title={result.plan ? `${provider.name} — ${result.plan}` : provider.name}
        >
          {result.error ? (
            <MenuBarExtra.Item
              icon={Icon.ExclamationMark}
              title={result.error}
            />
          ) : (
            result.lines.map((line, idx) => {
              const key = `${provider.id}-${idx}`;
              const pred = line.type === "progress" && line.format.kind === "percent"
                ? predictions.get(predKey(provider.id, line.label))
                : undefined;

              return (
                <React.Fragment key={key}>
                  <MenuBarExtra.Item
                    title={line.label}
                    subtitle={formatLineValue(line)}
                    icon={
                      line.type === "progress"
                        ? { source: Icon.Circle, tintColor: getUsageColor(line.used, line.limit) }
                        : undefined
                    }
                  />
                  {pred && (
                    <MenuBarExtra.Item
                      title={`  ${pred.paceLabel}${pred.timeToLimitMs !== null ? ` — ${formatTimeToLimit(pred.timeToLimitMs)}` : ""}`}
                      subtitle={formatBurnRate(pred.burnRate)}
                      icon={getPaceIcon(pred.paceLabel)}
                    />
                  )}
                </React.Fragment>
              );
            })
          )}
        </MenuBarExtra.Section>
      ))}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="View Details"
          icon={Icon.Eye}
          shortcut={{ modifiers: ["cmd"], key: "d" }}
          onAction={async () => {
            try {
              await launchCommand({ name: "show-usage", type: LaunchType.UserInitiated });
            } catch {
              // Command may not be available
            }
          }}
        />
        <MenuBarExtra.Item
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={{ modifiers: ["cmd"], key: "r" }}
          onAction={() => revalidate()}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
