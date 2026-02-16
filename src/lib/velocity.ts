import { LocalStorage } from "@raycast/api";

const STORAGE_KEY = "velocity:projects";

export type ModelType = "opus" | "sonnet" | "haiku";
export type TaskType = "greenfield" | "refactoring" | "integration" | "architecture" | "documentation" | "testing";

export interface ProjectMetric {
  id: string;
  name: string;
  humanEstimateHours: number;
  actualWallClockMin: number;
  agentTimeMin: number;
  model: ModelType;
  subAgentsSpawned: number;
  taskType: TaskType;
  speedupFactor: number;
  notes: string;
  createdAt: string; // ISO 8601
}

function computeSpeedup(humanEstimateHours: number, actualWallClockMin: number): number {
  if (actualWallClockMin <= 0) return 0;
  const humanMinutes = humanEstimateHours * 60;
  return Math.round((humanMinutes / actualWallClockMin) * 10) / 10;
}

export async function getMetrics(): Promise<ProjectMetric[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ProjectMetric[];
  } catch {
    return [];
  }
}

export async function saveMetric(
  data: Omit<ProjectMetric, "id" | "speedupFactor" | "createdAt">
): Promise<ProjectMetric> {
  const metrics = await getMetrics();
  const metric: ProjectMetric = {
    ...data,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    speedupFactor: computeSpeedup(data.humanEstimateHours, data.actualWallClockMin),
    createdAt: new Date().toISOString(),
  };
  metrics.push(metric);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  return metric;
}

export async function deleteMetric(id: string): Promise<void> {
  const metrics = await getMetrics();
  const filtered = metrics.filter((m) => m.id !== id);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export interface AggregateStats {
  totalProjects: number;
  avgSpeedup: number;
  totalHumanEquivHours: number;
  byTaskType: Record<TaskType, { avgSpeedup: number; count: number }>;
  modelDistribution: Record<ModelType, number>; // percentage
}

export async function getAggregateStats(): Promise<AggregateStats> {
  const metrics = await getMetrics();
  const totalProjects = metrics.length;

  if (totalProjects === 0) {
    return {
      totalProjects: 0,
      avgSpeedup: 0,
      totalHumanEquivHours: 0,
      byTaskType: {} as AggregateStats["byTaskType"],
      modelDistribution: { opus: 0, sonnet: 0, haiku: 0 },
    };
  }

  const avgSpeedup =
    Math.round((metrics.reduce((sum, m) => sum + m.speedupFactor, 0) / totalProjects) * 10) / 10;

  const totalHumanEquivHours =
    Math.round(metrics.reduce((sum, m) => sum + m.humanEstimateHours, 0) * 10) / 10;

  // Per task type
  const taskTypeGroups: Partial<Record<TaskType, ProjectMetric[]>> = {};
  for (const m of metrics) {
    if (!taskTypeGroups[m.taskType]) taskTypeGroups[m.taskType] = [];
    taskTypeGroups[m.taskType]!.push(m);
  }

  const byTaskType = {} as AggregateStats["byTaskType"];
  for (const [type, group] of Object.entries(taskTypeGroups)) {
    const avg = Math.round((group!.reduce((s, m) => s + m.speedupFactor, 0) / group!.length) * 10) / 10;
    byTaskType[type as TaskType] = { avgSpeedup: avg, count: group!.length };
  }

  // Model distribution
  const modelCounts: Record<ModelType, number> = { opus: 0, sonnet: 0, haiku: 0 };
  for (const m of metrics) {
    modelCounts[m.model]++;
  }
  const modelDistribution: Record<ModelType, number> = {
    opus: Math.round((modelCounts.opus / totalProjects) * 100),
    sonnet: Math.round((modelCounts.sonnet / totalProjects) * 100),
    haiku: Math.round((modelCounts.haiku / totalProjects) * 100),
  };

  return { totalProjects, avgSpeedup, totalHumanEquivHours, byTaskType, modelDistribution };
}
