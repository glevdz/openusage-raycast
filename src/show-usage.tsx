import React from "react";
import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { probeAll, type ProviderWithResult } from "./providers";
import { setCachedResult } from "./lib/cache";
import {
  formatLineValue,
  formatResetTime,
  getUsageColor,
  getUsagePercent,
} from "./lib/formatting";
import type { MetricLine, ProgressLine } from "./providers/types";

function getProviderUrl(providerId: string): string | undefined {
  switch (providerId) {
    case "claude":
      return "https://console.anthropic.com";
    case "codex":
      return "https://chatgpt.com";
    case "kimi":
      return "https://kimi.com";
    default:
      return undefined;
  }
}

function getPrimaryUsage(lines: MetricLine[]): ProgressLine | null {
  // Session (first percent-based progress line) is the primary metric
  const percentLines = lines.filter(
    (l): l is ProgressLine => l.type === "progress" && l.format.kind === "percent"
  );
  return percentLines.length > 0 ? percentLines[0] : null;
}

function getStatusTag(lines: MetricLine[]): { value: string; color: Color } {
  const primary = getPrimaryUsage(lines);
  if (!primary) return { value: "N/A", color: Color.SecondaryText };

  const pct = getUsagePercent(primary);
  const label = `${Math.round(pct)}%`;

  if (pct >= 90) return { value: label, color: Color.Red };
  if (pct >= 70) return { value: label, color: Color.Orange };
  if (pct >= 50) return { value: label, color: Color.Yellow };
  return { value: label, color: Color.Green };
}

function ProviderDetail({ result }: { result: ProviderWithResult }) {
  const { result: probeResult } = result;

  if (probeResult.error) {
    return (
      <List.Item.Detail
        metadata={
          <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label title="Error" text={probeResult.error} />
          </List.Item.Detail.Metadata>
        }
      />
    );
  }

  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          {probeResult.plan && (
            <>
              <List.Item.Detail.Metadata.Label title="Plan" text={probeResult.plan} />
              <List.Item.Detail.Metadata.Separator />
            </>
          )}

          {probeResult.lines.map((line, idx) => {
            switch (line.type) {
              case "progress": {
                const pct = getUsagePercent(line);
                const color = getUsageColor(line.used, line.limit);
                return (
                  <React.Fragment key={idx}>
                    <List.Item.Detail.Metadata.Label
                      title={line.label}
                      text={formatLineValue(line)}
                    />
                    {line.resetsAt && (
                      <List.Item.Detail.Metadata.Label
                        title="Resets"
                        text={formatResetTime(line.resetsAt)}
                      />
                    )}
                    <List.Item.Detail.Metadata.TagList title="Status">
                      <List.Item.Detail.Metadata.TagList.Item
                        text={pct >= 90 ? "High Usage" : pct >= 70 ? "Moderate" : "On Track"}
                        color={color}
                      />
                    </List.Item.Detail.Metadata.TagList>
                    {idx < probeResult.lines.length - 1 && (
                      <List.Item.Detail.Metadata.Separator />
                    )}
                  </React.Fragment>
                );
              }
              case "text":
                return (
                  <List.Item.Detail.Metadata.Label
                    key={idx}
                    title={line.label}
                    text={line.value}
                  />
                );
              case "badge":
                return (
                  <List.Item.Detail.Metadata.TagList key={idx} title={line.label}>
                    <List.Item.Detail.Metadata.TagList.Item
                      text={line.text}
                      color={Color.SecondaryText}
                    />
                  </List.Item.Detail.Metadata.TagList>
                );
            }
          })}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function ShowUsage() {
  const { data, isLoading, revalidate } = useCachedPromise(
    async () => {
      const results = await probeAll();

      // Update cache
      for (const { provider, result } of results) {
        setCachedResult(provider.id, result);
      }

      return results;
    },
    [],
    {
      keepPreviousData: true,
    }
  );

  const results: ProviderWithResult[] = data ?? [];

  return (
    <List isShowingDetail isLoading={isLoading}>
      <List.Section title="Providers">
        {results.map(({ provider, result: probeResult }) => {
          const tag = probeResult.error
            ? { value: "Error", color: Color.Red }
            : getStatusTag(probeResult.lines);

          const subtitle = probeResult.plan || undefined;
          const providerUrl = getProviderUrl(provider.id);

          return (
            <List.Item
              key={provider.id}
              title={provider.name}
              subtitle={subtitle}
              icon={{ source: provider.icon }}
              accessories={[{ tag }]}
              detail={<ProviderDetail result={{ provider, result: probeResult }} />}
              actions={
                <ActionPanel>
                  <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
                  {providerUrl && (
                    <Action.OpenInBrowser title={`Open ${provider.name}`} url={providerUrl} />
                  )}
                  <Action.CopyToClipboard
                    title="Copy Usage Summary"
                    content={probeResult.lines.map((l) => `${l.label}: ${formatLineValue(l)}`).join("\n")}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
