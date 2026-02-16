import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { deleteMetric, getAggregateStats, getMetrics, type ProjectMetric, type TaskType } from "./lib/velocity";

function formatTaskType(t: TaskType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function ProjectDetail({ metric }: { metric: ProjectMetric }) {
  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Project" text={metric.name} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Human Estimate" text={`${metric.humanEstimateHours}h`} />
          <List.Item.Detail.Metadata.Label title="Wall-Clock Time" text={formatDuration(metric.actualWallClockMin)} />
          <List.Item.Detail.Metadata.Label title="Agent Time" text={formatDuration(metric.agentTimeMin)} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.TagList title="Speedup">
            <List.Item.Detail.Metadata.TagList.Item
              text={`${metric.speedupFactor}x`}
              color={metric.speedupFactor >= 5 ? Color.Green : metric.speedupFactor >= 3 ? Color.Yellow : Color.Orange}
            />
          </List.Item.Detail.Metadata.TagList>
          <List.Item.Detail.Metadata.Label title="Model" text={metric.model.charAt(0).toUpperCase() + metric.model.slice(1)} />
          <List.Item.Detail.Metadata.Label title="Sub-Agents" text={String(metric.subAgentsSpawned)} />
          <List.Item.Detail.Metadata.Label title="Task Type" text={formatTaskType(metric.taskType)} />
          {metric.notes && (
            <>
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.Label title="Notes" text={metric.notes} />
            </>
          )}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Logged" text={new Date(metric.createdAt).toLocaleDateString()} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export default function VelocityDashboard() {
  const {
    data,
    isLoading,
    revalidate,
  } = useCachedPromise(async () => {
    const [metrics, stats] = await Promise.all([getMetrics(), getAggregateStats()]);
    return { metrics, stats };
  });

  const metrics = data?.metrics ?? [];
  const stats = data?.stats;

  async function handleDelete(metric: ProjectMetric) {
    if (
      await confirmAlert({
        title: "Delete Project?",
        message: `Remove "${metric.name}" from velocity data?`,
        primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
      })
    ) {
      await deleteMetric(metric.id);
      await showToast({ style: Toast.Style.Success, title: "Deleted" });
      revalidate();
    }
  }

  function buildSummary(): string {
    if (!stats || stats.totalProjects === 0) return "No projects logged yet";
    const lines = [
      `Avg Speedup: ${stats.avgSpeedup}x`,
      `Projects: ${stats.totalProjects}`,
      `Human-Equiv Hours: ${stats.totalHumanEquivHours}h`,
    ];
    for (const [type, data] of Object.entries(stats.byTaskType)) {
      lines.push(`${formatTaskType(type as TaskType)}: ${data.avgSpeedup}x (n=${data.count})`);
    }
    return lines.join("\n");
  }

  return (
    <List isShowingDetail isLoading={isLoading}>
      {stats && stats.totalProjects > 0 && (
        <List.Section title="Stats">
          <List.Item
            title="Average Speedup"
            icon={Icon.Gauge}
            accessories={[{ tag: { value: `${stats.avgSpeedup}x`, color: Color.Blue } }]}
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Avg Speedup" text={`${stats.avgSpeedup}x`} />
                    <List.Item.Detail.Metadata.Label title="Total Projects" text={String(stats.totalProjects)} />
                    <List.Item.Detail.Metadata.Label title="Human-Equiv Hours" text={`${stats.totalHumanEquivHours}h`} />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label title="Model Distribution" />
                    <List.Item.Detail.Metadata.Label title="Opus" text={`${stats.modelDistribution.opus}%`} />
                    <List.Item.Detail.Metadata.Label title="Sonnet" text={`${stats.modelDistribution.sonnet}%`} />
                    <List.Item.Detail.Metadata.Label title="Haiku" text={`${stats.modelDistribution.haiku}%`} />
                    <List.Item.Detail.Metadata.Separator />
                    <List.Item.Detail.Metadata.Label title="Per-Type Multipliers" />
                    {Object.entries(stats.byTaskType).map(([type, d]) => (
                      <List.Item.Detail.Metadata.Label
                        key={type}
                        title={formatTaskType(type as TaskType)}
                        text={`${d.avgSpeedup}x (n=${d.count})`}
                      />
                    ))}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Summary" content={buildSummary()} />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      <List.Section title={`History (${metrics.length})`}>
        {metrics.length === 0 && (
          <List.Item title="No projects logged yet" icon={Icon.Plus} subtitle="Use 'Log Project Metrics' to add one" />
        )}
        {[...metrics].reverse().map((m) => (
          <List.Item
            key={m.id}
            title={m.name}
            subtitle={formatTaskType(m.taskType)}
            icon={Icon.Document}
            accessories={[
              { tag: { value: `${m.speedupFactor}x`, color: m.speedupFactor >= 5 ? Color.Green : Color.Yellow } },
              { tag: m.model },
            ]}
            detail={<ProjectDetail metric={m} />}
            actions={
              <ActionPanel>
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
                <Action
                  title="Delete Project"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => handleDelete(m)}
                  shortcut={{ modifiers: ["ctrl"], key: "x" }}
                />
                <Action.CopyToClipboard
                  title="Copy Summary"
                  content={`${m.name}: ${m.speedupFactor}x speedup (${m.humanEstimateHours}h → ${formatDuration(m.actualWallClockMin)})`}
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
