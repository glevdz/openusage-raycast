import { getSessionMetrics } from "./velocity";

export type TaskType = "greenfield" | "refactoring" | "integration" | "architecture" | "documentation" | "testing";
export type ModelType = "opus" | "sonnet" | "haiku";

const DEFAULT_TASK_MULTIPLIERS: Record<TaskType, number> = {
  greenfield: 6,
  refactoring: 4,
  integration: 5,
  architecture: 3,
  documentation: 5,
  testing: 4,
};

const MODEL_SPEED: Record<ModelType, number> = {
  haiku: 10,
  sonnet: 1,
  opus: 0.7,
};

function getSubAgentMultiplier(count: number): number {
  if (count <= 1) return 1;
  if (count <= 3) return 1.8;
  if (count <= 6) return 2.5;
  return 2.8;
}

function getConfidenceBuffer(confidence: "high" | "medium" | "low"): number {
  switch (confidence) {
    case "high":
      return 1.2;
    case "medium":
      return 1.5;
    case "low":
      return 2.0;
  }
}

export interface EstimateResult {
  estimatedMinutes: number;
  speedupFactor: number;
  confidence: "high" | "medium" | "low";
  basedOnNSessions: number;
  avgTokensPerMin: number | null;
}

export async function estimateProject(
  humanHours: number,
  taskType: TaskType,
  model: ModelType,
  subAgents: number,
  confidence: "high" | "medium" | "low",
): Promise<EstimateResult> {
  const sessions = await getSessionMetrics();

  // Derive data-driven adjustment from real sessions
  let avgTokensPerMin: number | null = null;
  if (sessions.length >= 3) {
    const totalTokens = sessions.reduce((s, m) => s + m.totalOutputTokens, 0);
    const totalMin = sessions.reduce((s, m) => s + m.durationMin, 0);
    if (totalMin > 0) {
      avgTokensPerMin = Math.round(totalTokens / totalMin);
    }
  }

  // Use default multipliers (no task-type matching since sessions don't have taskType)
  const baseSpeedup = DEFAULT_TASK_MULTIPLIERS[taskType];
  const basedOnN = sessions.length;

  // Adjust for model speed relative to sonnet baseline
  const modelAdjustment = MODEL_SPEED[model];

  // Adjust for sub-agents
  const subAgentMult = getSubAgentMultiplier(subAgents);

  // Combined speedup
  const speedupFactor = Math.round(baseSpeedup * modelAdjustment * subAgentMult * 10) / 10;

  // Estimated time with confidence buffer
  const buffer = getConfidenceBuffer(confidence);
  const humanMinutes = humanHours * 60;
  const rawEstimate = humanMinutes / speedupFactor;
  const estimatedMinutes = Math.round(rawEstimate * buffer);

  return {
    estimatedMinutes,
    speedupFactor,
    confidence,
    basedOnNSessions: basedOnN,
    avgTokensPerMin,
  };
}
