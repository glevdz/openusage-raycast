import { Icon, launchCommand, LaunchType, MenuBarExtra } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { probeAll, type ProviderWithResult } from "./providers";
import { setCachedResult } from "./lib/cache";
import { formatLineValue, getHighestUsage, getUsageColor } from "./lib/formatting";

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

      // Cache individual results
      for (const { provider, result } of results) {
        setCachedResult(provider.id, result);
      }

      return results;
    },
    [],
    {
      initialData: undefined,
      keepPreviousData: true,
    }
  );

  // Use cached data while loading
  const results: ProviderWithResult[] = data ?? [];

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
            result.lines.map((line, idx) => (
              <MenuBarExtra.Item
                key={`${provider.id}-${idx}`}
                title={line.label}
                subtitle={formatLineValue(line)}
                icon={
                  line.type === "progress"
                    ? { source: Icon.Circle, tintColor: getUsageColor(line.used, line.limit) }
                    : undefined
                }
              />
            ))
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
