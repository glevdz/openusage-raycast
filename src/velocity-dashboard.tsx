import React from "react";
import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import {
  clearVelocityCache,
  getAggregateStats,
  getProjectStats,
  getSessionMetrics,
  type AggregateStats,
  type ProjectStats,
  type SessionMetric,
} from "./lib/velocity";
import {
  scanRepos,
  matchReposToSessions,
  getRepoEstimate,
  clearGithubCache,
  type EnrichedRepo,
} from "./lib/github";
import { probeAll, type ProviderWithResult } from "./providers";
import { setCachedResult } from "./lib/cache";
import {
  formatLineValue,
  formatResetTime,
  formatBurnRate,
  formatTimeToLimit,
  getUsageColor,
  getUsagePercent,
  getPaceIcon,
} from "./lib/formatting";
import { getSnapshots } from "./lib/history";
import { calculatePrediction } from "./lib/prediction";
import type { ProgressLine } from "./providers/types";

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatModelName(model: string): string {
  // "claude-opus-4-6" → "Opus 4.6"
  const match = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (match) {
    return `${match[1].charAt(0).toUpperCase() + match[1].slice(1)} ${match[2]}.${match[3]}`;
  }
  return model;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Detail Components ────────────────────────────────────────────────

function SessionDetail({ session }: { session: SessionMetric }) {
  const topTools = Object.entries(session.toolBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Project"
            text={session.projectName}
          />
          <List.Item.Detail.Metadata.Label
            title="Model"
            text={formatModelName(session.model)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Duration"
            text={formatDuration(session.durationMin)}
          />
          <List.Item.Detail.Metadata.Label
            title="Turns"
            text={String(session.turns)}
          />
          <List.Item.Detail.Metadata.Label
            title="Sub-Agents"
            text={String(session.subAgentsSpawned)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Input Tokens"
            text={formatTokens(session.totalInputTokens)}
          />
          <List.Item.Detail.Metadata.Label
            title="Output Tokens"
            text={formatTokens(session.totalOutputTokens)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Tool Uses"
            text={String(session.toolUses)}
          />
          {topTools.map(([name, count]) => (
            <List.Item.Detail.Metadata.Label
              key={name}
              title={`  ${name}`}
              text={String(count)}
            />
          ))}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Started"
            text={new Date(session.startedAt).toLocaleString()}
          />
          <List.Item.Detail.Metadata.Label
            title="Ended"
            text={new Date(session.endedAt).toLocaleString()}
          />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function OverviewDetail({ stats }: { stats: AggregateStats }) {
  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Total Sessions"
            text={String(stats.totalSessions)}
          />
          <List.Item.Detail.Metadata.Label
            title="Total Coding Hours"
            text={`${stats.totalCodingHours}h`}
          />
          <List.Item.Detail.Metadata.Label
            title="Avg Session"
            text={formatDuration(stats.avgSessionMin)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Input Tokens"
            text={formatTokens(stats.totalInputTokens)}
          />
          <List.Item.Detail.Metadata.Label
            title="Output Tokens"
            text={formatTokens(stats.totalOutputTokens)}
          />
          <List.Item.Detail.Metadata.Label
            title="Sub-Agents Spawned"
            text={String(stats.subAgentTotal)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Model Distribution" />
          {Object.entries(stats.modelDistribution).map(([model, pct]) => (
            <List.Item.Detail.Metadata.Label
              key={model}
              title={`  ${formatModelName(model)}`}
              text={`${pct}%`}
            />
          ))}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Most Active Projects" />
          {stats.mostActiveProjects.map((p) => (
            <List.Item.Detail.Metadata.Label
              key={p.name}
              title={`  ${p.name}`}
              text={`${p.sessions} sessions`}
            />
          ))}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function ProjectDetail({ project }: { project: ProjectStats }) {
  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Project"
            text={project.projectName}
          />
          <List.Item.Detail.Metadata.Label
            title="Path"
            text={project.project}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Sessions"
            text={String(project.sessions)}
          />
          <List.Item.Detail.Metadata.Label
            title="Total Time"
            text={formatDuration(project.totalDurationMin)}
          />
          <List.Item.Detail.Metadata.Label
            title="Most Used Model"
            text={formatModelName(project.mostUsedModel)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Input Tokens"
            text={formatTokens(project.totalInputTokens)}
          />
          <List.Item.Detail.Metadata.Label
            title="Output Tokens"
            text={formatTokens(project.totalOutputTokens)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Last Active"
            text={new Date(project.lastActive).toLocaleString()}
          />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function formatSize(kb: number): string {
  if (kb >= 1_000_000) return `${(kb / 1_000_000).toFixed(1)} GB`;
  if (kb >= 1_000) return `${(kb / 1_000).toFixed(1)} MB`;
  return `${kb} KB`;
}

function RepoDetail({ repo }: { repo: EnrichedRepo }) {
  const topLangs = Object.entries(repo.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const totalBytes = Object.values(repo.languages).reduce((s, b) => s + b, 0);
  const estimate = getRepoEstimate(repo);

  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Repository"
            text={`${repo.owner}/${repo.name}`}
          />
          <List.Item.Detail.Metadata.Label
            title="Primary Language"
            text={repo.primaryLanguage}
          />
          <List.Item.Detail.Metadata.Label
            title="Size"
            text={formatSize(repo.sizeKB)}
          />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Commits (90d)"
            text={String(repo.commitCount)}
          />
          <List.Item.Detail.Metadata.Label
            title="Velocity"
            text={`${repo.commitVelocity} commits/week`}
          />
          <List.Item.Detail.Metadata.Label
            title="Last Push"
            text={new Date(repo.pushedAt).toLocaleString()}
          />
          <List.Item.Detail.Metadata.Separator />
          {topLangs.length > 0 && (
            <>
              <List.Item.Detail.Metadata.Label title="Languages" />
              {topLangs.map(([lang, bytes]) => (
                <List.Item.Detail.Metadata.Label
                  key={lang}
                  title={`  ${lang}`}
                  text={`${Math.round((bytes / totalBytes) * 100)}%`}
                />
              ))}
              <List.Item.Detail.Metadata.Separator />
            </>
          )}
          <List.Item.Detail.Metadata.Label
            title="Complexity"
            text={`${Math.round(estimate.complexityScore * 100)}%`}
          />
          <List.Item.Detail.Metadata.Label
            title="Est. Remaining"
            text={`${estimate.estimatedSessionsRemaining} sessions (~${formatDuration(estimate.estimatedMinutesRemaining)})`}
          />
          <List.Item.Detail.Metadata.Label
            title="Data Source"
            text={
              estimate.basedOnSessions
                ? "Matched sessions"
                : "Default multipliers"
            }
          />
          {repo.matchedProject && (
            <>
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.Label
                title="Matched Project"
                text={repo.matchedProject.projectName}
              />
              <List.Item.Detail.Metadata.Label
                title="Sessions"
                text={String(repo.matchedProject.sessions)}
              />
              <List.Item.Detail.Metadata.Label
                title="Total Time"
                text={formatDuration(repo.matchedProject.totalDurationMin)}
              />
              <List.Item.Detail.Metadata.Label
                title="Tokens Out"
                text={formatTokens(repo.matchedProject.totalOutputTokens)}
              />
            </>
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function LiveUsageDetail({ result }: { result: ProviderWithResult }) {
  const { result: probeResult } = result;

  if (probeResult.error) {
    return (
      <List.Item.Detail
        metadata={
          <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label
              title="Error"
              text={probeResult.error}
            />
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
              <List.Item.Detail.Metadata.Label
                title="Plan"
                text={probeResult.plan}
              />
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
                        text={
                          pct >= 90
                            ? "High Usage"
                            : pct >= 70
                              ? "Moderate"
                              : "On Track"
                        }
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
                  <List.Item.Detail.Metadata.TagList
                    key={idx}
                    title={line.label}
                  >
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

// ── Main Command ─────────────────────────────────────────────────────

export default function VelocityDashboard() {
  const { data, isLoading, revalidate } = useCachedPromise(
    async () => {
      const [sessions, stats, projects, providerResults, repos] =
        await Promise.all([
          getSessionMetrics(),
          getAggregateStats(),
          getProjectStats(),
          probeAll(),
          scanRepos(),
        ]);

      // Update provider cache
      for (const { provider, result } of providerResults) {
        setCachedResult(provider.id, result);
      }

      // Get predictions for providers with percent lines
      const providersWithPredictions = await Promise.all(
        providerResults.map(async ({ provider, result }) => {
          const percentLine = result.lines.find(
            (l): l is ProgressLine =>
              l.type === "progress" && l.format.kind === "percent",
          );
          let prediction = null;
          if (percentLine) {
            const snapshots = await getSnapshots(
              provider.id,
              percentLine.label,
            );
            prediction = calculatePrediction(
              snapshots,
              getUsagePercent(percentLine),
              percentLine.periodDurationMs,
            );
          }
          return { provider, result, prediction };
        }),
      );

      const enrichedRepos = matchReposToSessions(repos, projects);

      return {
        sessions,
        stats,
        projects,
        providers: providersWithPredictions,
        repos: enrichedRepos,
      };
    },
    [],
    { keepPreviousData: true },
  );

  const sessions = data?.sessions ?? [];
  const stats = data?.stats;
  const projects = data?.projects ?? [];
  const providers = data?.providers ?? [];
  const repos = data?.repos ?? [];

  async function handleRefresh() {
    await Promise.all([clearVelocityCache(), clearGithubCache()]);
    await showToast({
      style: Toast.Style.Animated,
      title: "Re-scanning sessions & repos...",
    });
    revalidate();
  }

  function buildSummary(): string {
    if (!stats || stats.totalSessions === 0) return "No sessions scanned yet";
    return [
      `Sessions: ${stats.totalSessions}`,
      `Coding Hours: ${stats.totalCodingHours}h`,
      `Avg Session: ${formatDuration(stats.avgSessionMin)}`,
      `Tokens: ${formatTokens(stats.totalInputTokens)} in / ${formatTokens(stats.totalOutputTokens)} out`,
      `Sub-Agents: ${stats.subAgentTotal}`,
    ].join("\n");
  }

  const defaultActions = (
    <ActionPanel>
      <Action
        title="Refresh"
        icon={Icon.ArrowClockwise}
        onAction={handleRefresh}
      />
      <Action.CopyToClipboard
        title="Copy Summary"
        content={buildSummary()}
        shortcut={{ modifiers: ["cmd"], key: "c" }}
      />
    </ActionPanel>
  );

  return (
    <List isShowingDetail isLoading={isLoading}>
      {/* Section: Live Usage */}
      {providers.length > 0 && (
        <List.Section title="Live Usage">
          {providers.map(({ provider, result, prediction }) => {
            const percentLine = result.lines.find(
              (l): l is ProgressLine =>
                l.type === "progress" && l.format.kind === "percent",
            );
            const pct = percentLine ? getUsagePercent(percentLine) : null;
            const tag = result.error
              ? { value: "Error", color: Color.Red }
              : pct !== null
                ? {
                    value: `${Math.round(pct)}%`,
                    color:
                      pct >= 90
                        ? Color.Red
                        : pct >= 70
                          ? Color.Orange
                          : pct >= 50
                            ? Color.Yellow
                            : Color.Green,
                  }
                : { value: "N/A", color: Color.SecondaryText };

            const subtitle = prediction
              ? `${formatBurnRate(prediction.burnRate)} ${formatTimeToLimit(prediction.timeToLimitMs)}`
              : result.plan || undefined;

            return (
              <List.Item
                key={provider.id}
                title={provider.name}
                subtitle={subtitle}
                icon={{ source: provider.icon }}
                accessories={[
                  ...(prediction
                    ? [
                        {
                          icon: getPaceIcon(prediction.paceLabel),
                          tooltip: prediction.paceLabel,
                        },
                      ]
                    : []),
                  { tag },
                ]}
                detail={<LiveUsageDetail result={{ provider, result }} />}
                actions={defaultActions}
              />
            );
          })}
        </List.Section>
      )}

      {/* Section: Overview */}
      {stats && stats.totalSessions > 0 && (
        <List.Section title="Overview">
          <List.Item
            title="Velocity Stats"
            icon={Icon.Gauge}
            subtitle={`${stats.totalSessions} sessions, ${stats.totalCodingHours}h total`}
            accessories={[
              {
                tag: {
                  value: `${formatDuration(stats.avgSessionMin)} avg`,
                  color: Color.Blue,
                },
              },
            ]}
            detail={<OverviewDetail stats={stats} />}
            actions={defaultActions}
          />
        </List.Section>
      )}

      {/* Section: Projects */}
      {projects.length > 0 && (
        <List.Section title={`Projects (${projects.length})`}>
          {projects.map((p) => (
            <List.Item
              key={p.project}
              title={p.projectName}
              subtitle={`${p.sessions} sessions, ${formatDuration(p.totalDurationMin)}`}
              icon={Icon.Folder}
              accessories={[
                { tag: formatModelName(p.mostUsedModel) },
                { text: timeAgo(p.lastActive) },
              ]}
              detail={<ProjectDetail project={p} />}
              actions={
                <ActionPanel>
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    onAction={handleRefresh}
                  />
                  <Action.CopyToClipboard
                    title="Copy Project Stats"
                    content={`${p.projectName}: ${p.sessions} sessions, ${formatDuration(p.totalDurationMin)}, ${formatTokens(p.totalOutputTokens)} tokens out`}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                  <Action.OpenInBrowser
                    title="Open in Terminal"
                    url={`file://${p.project}`}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {/* Section: GitHub Repos */}
      {repos.length > 0 && (
        <List.Section title={`GitHub Repos (${repos.length})`}>
          {repos.map((repo) => (
            <List.Item
              key={`${repo.owner}/${repo.name}`}
              title={repo.name}
              subtitle={`${repo.primaryLanguage} — ${formatSize(repo.sizeKB)}`}
              icon={Icon.Code}
              accessories={[
                ...(repo.matchedProject
                  ? [
                      {
                        tag: {
                          value: `${repo.matchedProject.sessions} sessions`,
                          color: Color.Purple,
                        },
                      },
                    ]
                  : []),
                { tag: `${repo.commitVelocity}/wk` },
                { text: timeAgo(repo.pushedAt) },
              ]}
              detail={<RepoDetail repo={repo} />}
              actions={
                <ActionPanel>
                  <Action
                    title="Refresh"
                    icon={Icon.ArrowClockwise}
                    onAction={handleRefresh}
                  />
                  <Action.OpenInBrowser title="Open on GitHub" url={repo.url} />
                  <Action.CopyToClipboard
                    title="Copy Repo Stats"
                    content={`${repo.owner}/${repo.name}: ${repo.primaryLanguage}, ${formatSize(repo.sizeKB)}, ${repo.commitVelocity} commits/wk`}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {/* Section: Recent Sessions */}
      <List.Section title={`Recent Sessions (${sessions.length})`}>
        {sessions.length === 0 && (
          <List.Item
            title="No sessions found"
            icon={Icon.MagnifyingGlass}
            subtitle="Claude Code session data will appear here automatically"
          />
        )}
        {sessions.slice(0, 50).map((s) => (
          <List.Item
            key={s.sessionId}
            title={s.projectName}
            subtitle={`${formatDuration(s.durationMin)}, ${s.turns} turns`}
            icon={Icon.Terminal}
            accessories={[
              { tag: formatModelName(s.model) },
              ...(s.subAgentsSpawned > 0
                ? [
                    {
                      tag: {
                        value: `${s.subAgentsSpawned} agents`,
                        color: Color.Purple,
                      },
                    },
                  ]
                : []),
              { text: timeAgo(s.startedAt) },
            ]}
            detail={<SessionDetail session={s} />}
            actions={
              <ActionPanel>
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  onAction={handleRefresh}
                />
                <Action.CopyToClipboard
                  title="Copy Session Info"
                  content={`${s.projectName}: ${formatDuration(s.durationMin)}, ${s.turns} turns, ${formatTokens(s.totalOutputTokens)} tokens out, ${s.toolUses} tool uses`}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
